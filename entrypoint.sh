#!/bin/sh
# Version Tracker: entrypoint.sh (GAP-Flow v1.0.4)
set -e

echo "[GAP-Flow] Prüfe Systemumgebung..."

# 1. Git installieren falls noch nicht vorhanden
if ! command -v git >/dev/null 2>&1; then
  echo "[GAP-Flow] Installiere Git..."
  apk add --no-cache git
fi

git config --global --add safe.directory '*' || true

# 2. Repository aktualisieren
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[GAP-Flow] Ziehe neuesten Stand von GitHub..."
  git pull origin main || echo "[GAP-Flow] Git Pull fehlgeschlagen. Starte vorhandenen Stand..."
fi

# 3. npm v12 Sicherstellung & Konfiguration für native Module (sqlite3)
echo "[GAP-Flow] Konfiguriere npm v12..."
npm install -g npm@12 >/dev/null 2>&1 || true
npm config set ignore-scripts false

# 4. Abhängigkeiten installieren & Frontend bauen
echo "[GAP-Flow] Installiere Abhängigkeiten (Node 22)..."
npm install --ignore-scripts=false

# 5. Anwendung starten
echo "[GAP-Flow] Starte GAP-Flow..."
exec npm start