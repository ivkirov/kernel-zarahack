# CI + Self-Hosted Deploy with "deployed commit" visibility

## Context

The app runs manually on this VM as three detached processes (frontend live-server :7001,
ML uvicorn :8000, Spring Boot :8080) behind the OpenKBS vs2 proxy. There is **no CI and no
way to tell which commit is live**. We want: push to `master` → the VM automatically rebuilds
and restarts all three tiers → every tier reports the exact commit it's serving.

Because there's no cloud pipeline that can reach this VM, we use a **GitHub Actions self-hosted
runner on the VM itself**. The runner triggers a deploy script that syncs the canonical working
tree to the pushed commit, rebuilds, restarts services (fully detached so they survive the CI
job ending), and writes a **deploy stamp** that all three tiers + the browser read back.

### Environment constraints (verified)
- **No systemd** (PID 1 isn't init; `systemctl` offline) → no service units; process mgmt is
  `setsid nohup … </dev/null >log 2>&1 & disown` + PID files. Passwordless sudo available.
- **Cron daemon not running** + no init → reboot auto-start isn't reliable. We ship `boot.sh`
  for manual/relaunch instead of relying on `@reboot`.
- JDK 25 via sdkman at `~/.sdkman/candidates/java/25.0.3-tem`; system `mvn` needs `JAVA_HOME`
  set explicitly. `node`/`npm` at /usr/local/bin. `uvicorn` only inside `ml-service/venv`.
- `AuthFilter` never rejects (endpoints opt into auth via `CurrentUser.require()`), so a
  `/version` endpoint that omits that call is **public by construction** — no security config.
- CORS already allows `*.vs2.openkbs.com` + localhost:7001 on both Java and ML tiers.
- `.gitignore` `.*` rule already ignores `.env`, venvs, `frontend/dist/output.css`, and any
  dot-dir like `.run/`. The deploy stamps are non-dotfiles and need explicit ignore entries.

## Deploy stamp (single source of truth)

`scripts/deploy.sh` generates JSON via `python3 json.dump` (safe against quotes in commit
subjects) with keys: `sha, shortSha, subject, committedAt, deployedAt, branch, repoUrl`.
Written to two places after a fully successful deploy:
- `/home/user/project/deploy-stamp.json` — canonical; backend + ML read it via `DEPLOY_STAMP_PATH`.
- `/home/user/project/frontend/version.json` — copy, served same-origin to the browser.

## Files

### New
- **`scripts/lib.sh`** — shared bash: `setup_toolchain` (JDK 25, fail if not 25), `load_env`
  (source `.env`), `stop_service`/`free_port` (PID-file kill + `ss`-by-port fallback, guarded
  `!= $$ && != $PPID` so it can never kill the caller — replaces the old `pkill -f` that
  SIGTERM'd our own shell), `start_service` (detached `setsid nohup … & disown`, service binary
  is the exec'd PID, writes `.run/<name>.pid`), `health` (curl 127.0.0.1 directly, real app
  paths — proxy intercepts `/health`), `write_stamp`.
- **`scripts/deploy.sh`** — `set -Eeuo pipefail`; arg `<sha>`. Order:
  1. `setup_toolchain`
  2. `sync_tree`: `git -C $DEPLOY_DIR fetch --no-tags origin master && git checkout --force <sha>`
     (operates on canonical `/home/user/project`; preserves untracked/ignored `.env`/venv/css).
  3. `load_env`
  4. **Build all first (fail-fast, no restarts yet):** `npm run build:css`; `mvn -f backend-api
     -q -DskipTests clean package`; verify `ml-service/venv/bin/uvicorn` exists.
  5. **Restart each** (stop by PID file → free port → start detached) with
     `DEPLOY_STAMP_PATH` exported: frontend `node_modules/.bin/live-server --host=0.0.0.0
     --port=7001 --no-browser`; ML `venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000`;
     backend `$JAVA_HOME/bin/java -jar backend-api/target/*.jar`.
  6. **Health-check** all three (curl localhost; backend ~40×1s, ML ~20×1s, frontend ~10×1s).
  7. `write_stamp` **last** — stamp only advances on full success.
- **`scripts/boot.sh`** — sources lib, restart-only (no build) bring-up of all three; the
  documented manual relaunch after a reboot or runner death.
- **`.github/workflows/deploy.yml`**:
  ```yaml
  name: deploy
  on: { push: { branches: [master] } }
  concurrency: { group: deploy-master, cancel-in-progress: false }
  jobs:
    deploy:
      runs-on: [self-hosted, linux]
      steps:
        - uses: actions/checkout@v4
        - run: bash "$GITHUB_WORKSPACE/scripts/deploy.sh" "$GITHUB_SHA"
          shell: bash
  ```
  Script is invoked **from the runner checkout** but operates on the canonical dir, so
  `checkout --force` can't swap the running script. `cancel-in-progress: false` avoids killing
  a deploy mid-restart.
- **`backend-api/.../controller/VersionController.java`** — `@RestController
  @RequestMapping("/api/v1/version")`, `@GetMapping` returns the parsed stamp (Jackson →
  `Map`). `@Value("${app.deploy-stamp-path:}")`; blank/missing file → `{"status":"unknown"}`,
  never 500. No `CurrentUser.require()` → public.

### Modified
- **`backend-api/src/main/resources/application.yml`** — add under `app:`:
  `deploy-stamp-path: ${DEPLOY_STAMP_PATH:}`.
- **`ml-service/app.py`** — add `GET /api/ml/version` reading `DEPLOY_STAMP_PATH` env (fallback
  `Path(__file__).parent.parent / "deploy-stamp.json"`); missing → `{"status":"unknown"}`.
- **`frontend/index.html`** — add a small `<div id="version-badge">` near the footer.
- **`frontend/src/app.js`** (or new `src/version.js` loaded after config.js) — `fetch
  ('./version.json')`, render short SHA + subject, link to `${repoUrl}/commit/${sha}`, title =
  `deployedAt`. Vanilla DOM, localized label via existing `window.I18n`.
- **`frontend/src/config.js`** — add `VERSION_URL: "./version.json"`.
- **`.gitignore`** — append `/deploy-stamp.json`, `/frontend/version.json`, `/.run/`.

## Manual one-time setup (requires you)
1. **Runner registration token** (ephemeral ~1h) from repo Settings → Actions → Runners → New
   self-hosted runner. I'll then: download the runner into `~/actions-runner`, `./config.sh
   --url https://github.com/ivkirov/kernel-zarahack --token <TOKEN> --labels self-hosted,linux
   --unattended --replace`, and launch detached `setsid nohup ./run.sh </dev/null
   >runner.log 2>&1 & disown`.
2. Commit + push `scripts/`, workflow, and the per-tier changes so the runner can execute them.

## Reboot / runner-death note
No init system → services and runner do **not** auto-start on reboot. Recovery is documented and
one-line: `bash scripts/boot.sh` (services) + the `setsid nohup ./run.sh` incantation (runner).

## Verification
1. Manual dry-run: `bash scripts/deploy.sh $(git -C /home/user/project rev-parse HEAD)` → "DEPLOY OK".
2. Trigger via CI (push a trivial commit). After the **job ends**, from an independent shell:
   - `curl -fsS localhost:7001/index.html` → 200
   - `curl -fsS localhost:8000/api/ml/version` and `localhost:8080/api/v1/version` → JSON stamps
   - All stamps + `frontend/version.json` show the **same `sha`** as the pushed commit.
3. **Detachment survived**: `ps -o pid,ppid,sid,cmd -p $(cat .run/backend.pid)` → `PPID=1`
   (reparented to init). If PPID is the runner → apply fallback (run the whole `deploy.sh` under
   `setsid`).
4. Browser: open the proxied URL → version badge shows the short SHA, links to the GitHub commit.
5. Idempotency: run `deploy.sh` twice back-to-back → clean stop/restart, no orphan procs, caller
   shell unharmed.
