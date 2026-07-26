#!/bin/sh
# Version Tracker: entrypoint.sh (GAP-Flow v1.1.3)
set -e

echo "[GAP-Flow] Prüfe Systemumgebung..."

# 1. Git sicherstellen
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

# 3. Update-Hinweise stummschalten & native Abhängigkeiten blitzschnell installieren
npm config set update-notifier false >/dev/null 2>&1 || true

echo "[GAP-Flow] Installiere Abhängigkeiten (inkl. Dev-Tools)..."
npm install --include=dev --foreground-scripts

echo "[GAP-Flow] Kompiliere native C++ Module (sqlite3)..."
npm rebuild sqlite3

echo "[GAP-Flow] Starte GAP-Flow..."
exec npm start