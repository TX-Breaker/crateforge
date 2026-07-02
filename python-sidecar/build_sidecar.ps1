# Build del sidecar per Windows con PyInstaller.
# --onedir e NON --onefile: i binari onefile hanno molti piu' falsi positivi
# antivirus (Windows Defender) e avvii piu' lenti.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path .venv)) {
  python -m venv .venv
}
& .\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
# --prefer-binary: wheel prebuilt dove esistono; le sdist pure-Python
# (es. blowfish, dipendenza di pyrekordbox) sono ok, niente compilatori C.
python -m pip install --prefer-binary -r requirements.txt

pyinstaller --noconfirm --clean --onedir `
  --name crateforge-sidecar `
  --collect-all pyrekordbox `
  sidecar.py

Write-Host ""
Write-Host "Sidecar pronto in: $PSScriptRoot\dist\crateforge-sidecar\"
Write-Host "Nota falsi positivi AV: se Defender segnala il binario, e' un falso positivo tipico di PyInstaller. Vedi README."
