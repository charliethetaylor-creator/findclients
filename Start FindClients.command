#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
if [[ ! -x .venv/bin/python ]]; then
  python3 -c 'import sys; assert sys.version_info >= (3,11), "Install Python 3.11 or later first"'
  python3 -m venv .venv
  .venv/bin/python -m pip install -e .
fi
.venv/bin/python - <<'PY'
import threading
import webbrowser
from urllib.request import Request, urlopen
from harvey.dashboard import dashboard_url, start_dashboard, token_store
try:
    request = Request('http://127.0.0.1:5555/api/leads/brain', headers={'Authorization': 'Bearer ' + token_store.get()})
    with urlopen(request, timeout=2) as response:
        already_running = response.status == 200
except Exception:
    already_running = False
if already_running:
    webbrowser.open(dashboard_url())
    print('Opened your existing FindClients research dashboard.')
else:
    threading.Timer(1.5, lambda: webbrowser.open(dashboard_url())).start()
    start_dashboard()
PY
