#!/usr/bin/env bash
# Bring up all three tiers WITHOUT rebuilding — uses whatever artifacts are
# already on disk (frontend/dist/output.css, backend-api/target/*.jar, venv).
# This is the documented manual relaunch after a reboot or runner death, since
# there is no systemd/cron on this VM to auto-start services.
# Usage: boot.sh
set -Eeuo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/user/project}"
# shellcheck source=lib.sh
source "$DEPLOY_DIR/scripts/lib.sh"

setup_toolchain
load_env
export DEPLOY_STAMP_PATH="$STAMP"

# Ensure the DB schema exists before starting the backend (ddl-auto=validate).
migrate_schema

stop_service frontend; free_port 7001
start_service frontend "$DEPLOY_DIR/frontend" \
  "$DEPLOY_DIR/frontend/node_modules/.bin/live-server" --host=0.0.0.0 --port=7001 --no-browser

stop_service ml; free_port 8000
start_service ml "$DEPLOY_DIR/ml-service" \
  "$DEPLOY_DIR/ml-service/venv/bin/uvicorn" app:app --host 0.0.0.0 --port 8000

jar="$(ls -1 "$DEPLOY_DIR"/backend-api/target/timepoverty-*.jar 2>/dev/null | head -1)"
[[ -n "$jar" ]] || die "backend jar not found — run scripts/deploy.sh first to build it"
stop_service backend; free_port 8080
start_service backend "$DEPLOY_DIR/backend-api" "$JAVA_HOME/bin/java" -jar "$jar"

health frontend "http://127.0.0.1:7001/index.html"     10 1
health ml       "http://127.0.0.1:8000/api/ml/version" 20 1
health backend  "http://127.0.0.1:8080/api/v1/version" 40 1
log "BOOT OK"
