#!/bin/sh
set -e

echo "[Docker] Prüfe auf Updates von GitHub..."
git pull origin main || echo "[Docker] Git pull fehlgeschlagen, starte bestehende Version..."

echo "[Docker] Starte Anwendung..."
exec npm start