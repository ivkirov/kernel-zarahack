#!/usr/bin/env bash
# Deploy the canonical working tree to a given commit and restart all three
# tiers (frontend :7001, ML :8000, backend :8080) as detached processes.
# Usage: deploy.sh <sha>     (sha defaults to origin/master HEAD)
#
# Invoked by .github/workflows/deploy.yml from the runner's checkout, but it
# operates on $DEPLOY_DIR (/home/user/project) so services run from the stable
# location the proxy expects. Build everything first; only restart if all
# builds succeed; stamp last so the reported commit only advances on success.
set -Eeuo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/user/project}"
# shellcheck source=lib.sh
source "$DEPLOY_DIR/scripts/lib.sh"

SHA="${1:-}"

sync_tree() {
  git -C "$DEPLOY_DIR" fetch --no-tags origin "$BRANCH"
  [[ -z "$SHA" ]] && SHA="$(git -C "$DEPLOY_DIR" rev-parse "origin/$BRANCH")"
  # --force preserves untracked/ignored files (.env, venv, dist/output.css,
  # model caches); only tracked files are reset to the target commit.
  git -C "$DEPLOY_DIR" checkout --force "$SHA"
  log "synced $DEPLOY_DIR -> $(git -C "$DEPLOY_DIR" rev-parse --short HEAD)"
}

build_frontend() { ( cd "$DEPLOY_DIR/frontend" && npm run build:css ); }
build_backend()  { mvn -f "$DEPLOY_DIR/backend-api" -q -DskipTests clean package; }
check_ml()       { [[ -x "$DEPLOY_DIR/ml-service/venv/bin/uvicorn" ]] || die "ml-service/venv/bin/uvicorn missing"; }

restart_all() {
  export DEPLOY_STAMP_PATH="$STAMP"

  stop_service frontend; free_port 7001
  start_service frontend "$DEPLOY_DIR/frontend" \
    "$DEPLOY_DIR/frontend/node_modules/.bin/live-server" --host=0.0.0.0 --port=7001 --no-browser

  stop_service ml; free_port 8000
  start_service ml "$DEPLOY_DIR/ml-service" \
    "$DEPLOY_DIR/ml-service/venv/bin/uvicorn" app:app --host 0.0.0.0 --port 8000

  local jar
  jar="$(ls -1 "$DEPLOY_DIR"/backend-api/target/timepoverty-*.jar 2>/dev/null | head -1)"
  [[ -n "$jar" ]] || die "backend jar not found after build"
  stop_service backend; free_port 8080
  start_service backend "$DEPLOY_DIR/backend-api" "$JAVA_HOME/bin/java" -jar "$jar"
}

health_all() {
  health frontend "http://127.0.0.1:7001/index.html"        10 1
  health ml       "http://127.0.0.1:8000/api/ml/version"    20 1
  health backend  "http://127.0.0.1:8080/api/v1/version"    40 1
}

main() {
  setup_toolchain
  sync_tree
  load_env
  log "building (fail-fast before any restart)…"
  build_frontend
  build_backend
  check_ml
  log "restarting services…"
  restart_all
  health_all
  write_stamp
  log "DEPLOY OK $(git -C "$DEPLOY_DIR" rev-parse --short HEAD)"
}

main "$@"
