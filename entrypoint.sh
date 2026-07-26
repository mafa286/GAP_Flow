#!/bin/sh
# Version Tracker: entrypoint.sh (GAP-Flow v1.0.3)
set -e

echo "[Docker] Konfiguriere npm v12 für native Module..."
npm config set ignore-scripts false

echo "[Docker] Prüfe auf Updates von GitHub..."
git pull origin main || echo "[Docker] Git pull fehlgeschlagen, starte bestehende Version..."

echo "[Docker] Starte Anwendung..."
exec npm start