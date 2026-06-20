#!/usr/bin/env bash
# Shared helpers for deploy.sh / boot.sh. Source this; don't execute it.
#
# Process model on this VM: there is no systemd and no running cron daemon, so
# services are long-lived detached processes managed by PID files under .run/.
# Every launch uses `setsid nohup … </dev/null >log 2>&1 & disown` so the child
# is reparented to init and survives the (short-lived) CI job or shell that
# started it.

DEPLOY_DIR="${DEPLOY_DIR:-/home/user/project}"
RUN_DIR="$DEPLOY_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
STAMP="$DEPLOY_DIR/deploy-stamp.json"
BRANCH="${BRANCH:-master}"
REPO_URL="${REPO_URL:-https://github.com/ivkirov/kernel-zarahack.git}"
JAVA_VERSION_ID="25.0.3-tem"

log()  { printf '[deploy %(%H:%M:%S)T] %s\n' -1 "$*"; }
die()  { log "FATAL: $*"; exit 1; }

# JDK 25 via sdkman, set deterministically; system mvn picks up JAVA_HOME.
setup_toolchain() {
  export SDKMAN_DIR="$HOME/.sdkman"
  # sdkman-init.sh references $ZSH_VERSION unguarded, which trips `set -u`;
  # relax nounset just for the source, then restore it.
  set +u
  # shellcheck disable=SC1091
  source "$SDKMAN_DIR/bin/sdkman-init.sh"
  set -u
  export JAVA_HOME="$SDKMAN_DIR/candidates/java/$JAVA_VERSION_ID"
  export PATH="$JAVA_HOME/bin:$PATH"
  java -version 2>&1 | grep -q ' version "25' || die "JDK 25 not active (got: $(java -version 2>&1 | head -1))"
  log "toolchain: $(java -version 2>&1 | head -1)"
}

# Source PG* (and any other) secrets for the backend.
load_env() {
  [[ -f "$DEPLOY_DIR/.env" ]] || die ".env not found at $DEPLOY_DIR/.env"
  set -a; # shellcheck disable=SC1091
  source "$DEPLOY_DIR/.env"; set +a
}

# Stop a service by its PID file (TERM, then KILL after grace). Never pattern-kills.
stop_service() {
  local name="$1" pidfile="$RUN_DIR/$1.pid" pid
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
      kill -9 "$pid" 2>/dev/null || true
      log "stopped $name (pid $pid)"
    fi
    rm -f "$pidfile"
  fi
}

# Free a TCP port by killing its listening owner — but NEVER this shell or its
# parent (guards against the old pkill-by-pattern footgun). Targeted via ss.
free_port() {
  local port="$1" pid
  pid="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
  if [[ -z "$pid" ]]; then
    pid="$(sudo ss -ltnpH "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
  fi
  if [[ -n "$pid" && "$pid" != "$$" && "$pid" != "$PPID" ]]; then
    kill "$pid" 2>/dev/null || sudo kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    kill -9 "$pid" 2>/dev/null || sudo kill -9 "$pid" 2>/dev/null || true
    log "freed port $port (was pid $pid)"
  fi
}

# Launch a service fully detached. The exec'd PID is the service itself, so the
# PID file is accurate for health checks and later stops.
#   start_service <name> <workdir> <cmd> [args...]
start_service() {
  local name="$1" wd="$2"; shift 2
  mkdir -p "$RUN_DIR" "$LOG_DIR"
  ( cd "$wd" && setsid nohup "$@" </dev/null >"$LOG_DIR/$name.log" 2>&1 &
    echo $! >"$RUN_DIR/$name.pid" )
  disown 2>/dev/null || true
  log "started $name (pid $(cat "$RUN_DIR/$name.pid" 2>/dev/null)) -> $LOG_DIR/$name.log"
}

# Poll a localhost URL until it answers (curl direct to 127.0.0.1, bypassing the
# proxy which intercepts /health). Dies on timeout.
#   health <name> <url> <tries> <sleep_secs>
health() {
  local name="$1" url="$2" tries="$3" slp="$4"
  for _ in $(seq 1 "$tries"); do
    curl -fsS -o /dev/null "$url" 2>/dev/null && { log "health ok: $name"; return 0; }
    sleep "$slp"
  done
  log "---- last 20 log lines for $name ----"; tail -20 "$LOG_DIR/$name.log" 2>/dev/null || true
  die "health check failed for $name ($url)"
}

# Write the deploy stamp from the canonical dir's current HEAD. JSON is built by
# python3 so a commit subject with quotes/backslashes can't corrupt it.
write_stamp() {
  local sha short subject cdate deployed
  sha="$(git -C "$DEPLOY_DIR" rev-parse HEAD)"
  short="$(git -C "$DEPLOY_DIR" rev-parse --short HEAD)"
  subject="$(git -C "$DEPLOY_DIR" log -1 --pretty=%s)"
  cdate="$(git -C "$DEPLOY_DIR" log -1 --pretty=%cI)"
  deployed="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  SHA="$sha" SHORT="$short" SUBJECT="$subject" CDATE="$cdate" \
  DEPLOYED="$deployed" BRANCH="$BRANCH" REPO="$REPO_URL" \
  python3 -c 'import os,json,sys
json.dump({
  "sha": os.environ["SHA"],
  "shortSha": os.environ["SHORT"],
  "subject": os.environ["SUBJECT"],
  "committedAt": os.environ["CDATE"],
  "deployedAt": os.environ["DEPLOYED"],
  "branch": os.environ["BRANCH"],
  "repoUrl": os.environ["REPO"],
}, sys.stdout, ensure_ascii=False, indent=2)' > "$STAMP"
  cp "$STAMP" "$DEPLOY_DIR/frontend/version.json"
  log "stamped $short -> deploy-stamp.json + frontend/version.json"
}
