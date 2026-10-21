#!/bin/sh
# One container, two processes: FastAPI on 127.0.0.1:8000 (private) and the Next server on 0.0.0.0:$PORT (public).
# If either dies, exit non-zero so Liara restarts the whole container (never serve a half-dead app).
APP_DIR=${APP_DIR:-/app}
API_PORT=${API_PORT:-8000}
uvicorn app.main:app --app-dir "$APP_DIR/backend" --host 127.0.0.1 --port "$API_PORT" --workers 1 &
API=$!
(cd "$APP_DIR/frontend" && exec node server.js) &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' TERM INT
# wait -n is a bashism; poll instead so this works with dash
while kill -0 $API 2>/dev/null && kill -0 $WEB 2>/dev/null; do sleep 2; done
echo "a process exited (api=$(kill -0 $API 2>/dev/null && echo up || echo down) web=$(kill -0 $WEB 2>/dev/null && echo up || echo down)); restarting container" >&2
kill $API $WEB 2>/dev/null
exit 1
