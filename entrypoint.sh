#!/bin/sh
set -e

echo "[GAP-Flow] Prüfe Systemumgebung..."

# 1. Git sicherstellen
if ! command -v git >/dev/null 2>&1; then
  echo "[GAP-Flow] Installiere Git..."
  apk add --no-cache git
fi

git config --global --add safe.directory '*' || true

# 2. Sicheres Update von GitHub mit Staging-Kompilierungstest
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  OLD_COMMIT=$(git rev-parse HEAD || echo "")
  echo "[GAP-Flow] Prüfe auf GitHub-Updates..."
  
  if git fetch origin main >/dev/null 2>&1; then
    NEW_COMMIT=$(git rev-parse origin/main || echo "")
    
    if [ "$OLD_COMMIT" != "$NEW_COMMIT" ] && [ -n "$NEW_COMMIT" ]; then
      echo "[GAP-Flow] Neues Update gefunden! Teste Kompilierung ($OLD_COMMIT -> $NEW_COMMIT)..."
      
      mkdir -p data
      rm -f data/build_error.log

      # Sauberen Git-Arbeitsbereich vor Merge sicherstellen
      git reset --hard HEAD >/dev/null 2>&1 || true
      
      if git merge origin/main --no-edit >/dev/null 2>&1; then
        if npm run build:frontend > data/build_error.log 2>&1; then
          echo "[GAP-Flow] ✅ Staging-Build ERFOLGREICH! Update übernommen."
          rm -f data/build_error.log
        else
          echo "[GAP-Flow] ❌ FEHLER beim Kompilieren des neuen Standes! Setze zurück auf $OLD_COMMIT..."
          echo "------------------- FEHLERPROTOKOLL DES UPDATES -------------------"
          cat data/build_error.log || true
          echo "-------------------------------------------------------------------"
          git reset --hard "$OLD_COMMIT" >/dev/null 2>&1 || true
          UPDATE_BUILD_FAILED=1
          echo "[GAP-Flow] Alter stabiler Stand wiederhergestellt. Fehlerprotokoll in data/build_error.log gespeichert."
        fi
      else
        echo "[GAP-Flow] ❌ Git-Merge fehlgeschlagen! Setze zurück auf $OLD_COMMIT..."
        git merge --abort >/dev/null 2>&1 || true
        git reset --hard "$OLD_COMMIT" >/dev/null 2>&1 || true
      fi
    fi
  fi
fi

# 3. Update-Hinweise stummschalten & native Abhängigkeiten installieren
npm config set update-notifier false >/dev/null 2>&1 || true

echo "[GAP-Flow] Installiere Abhängigkeiten..."
npm install --include=dev --foreground-scripts

echo "[GAP-Flow] Kompiliere native C++ Module (sqlite3)..."
npm rebuild sqlite3

echo "[GAP-Flow] Prüfe & Kompiliere Frontend..."
mkdir -p data
if [ "$UPDATE_BUILD_FAILED" = "1" ]; then
  npm run build:frontend >/dev/null 2>&1 || true
  echo "[GAP-Flow] ✅ Fallback auf vorherigen stabilen Stand abgeschlossen."
else
  if npm run build:frontend > data/build_error.log 2>&1; then
    echo "[GAP-Flow] ✅ Frontend-Kompilierung ERFOLGREICH!"
    rm -f data/build_error.log
  else
    echo "[GAP-Flow] ❌ FEHLER beim Kompilieren des Frontend-Codes! Protokoll in data/build_error.log gespeichert."
  fi
fi

echo "[GAP-Flow] Starte GAP-Flow..."
exec npx tsx server.ts
