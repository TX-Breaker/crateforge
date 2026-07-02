#!/usr/bin/env bash
# Build del sidecar per macOS/Linux con PyInstaller.
# --onedir e NON --onefile: i binari onefile hanno molti più falsi positivi
# antivirus su Windows e avvii più lenti (unpack in temp a ogni run).
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-python3}

if [ ! -d .venv ]; then
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

pip install --upgrade pip
# --prefer-binary: wheel prebuilt dove esistono (sqlcipher3, numpy…);
# le sdist pure-Python (es. blowfish, dipendenza di pyrekordbox) sono ok
# perché non richiedono compilatori.
pip install --prefer-binary -r requirements.txt

pyinstaller --noconfirm --clean --onedir \
  --name crateforge-sidecar \
  --collect-all pyrekordbox \
  sidecar.py

echo
echo "Sidecar pronto in: $(pwd)/dist/crateforge-sidecar/"
echo "electron-builder lo impacchetta da python-sidecar/dist/crateforge-sidecar (vedi electron-builder.yml)."
