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
      echo "[GAP-Flow] Neues Update gefunden! Teste Kompilierung..."
      
      git merge origin/main --no-edit >/dev/null 2>&1 || true
      
      mkdir -p data
      rm -f data/build_error.log
      
      if npm run build:frontend > data/build_error.log 2>&1; then
        echo "[GAP-Flow] ✅ Staging-Build ERFOLGREICH! Update übernommen."
        rm -f data/build_error.log

        # Automatische Erhöhung der Dev-Zahl (+1) in package.json bei GitHub-Updates
        node -e "
          const fs = require('fs');
          const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
          const parts = (pkg.version || '0.0').split('.');
          const release = parts[0] || '1';
          const dev = parseInt(parts[1] || '0', 10) + 1;
          pkg.version = \`\${release}.\${dev}\`;
          fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
          console.log('[Version] Auto-incremented dev version to v' + pkg.version);
        "
        npm run build:frontend >/dev/null 2>&1 || true
      else
        echo "[GAP-Flow] ❌ FEHLER beim Kompilieren des neuen Standes! Setze zurück auf $OLD_COMMIT..."
        git reset --hard "$OLD_COMMIT" >/dev/null 2>&1 || true
        echo "[GAP-Flow] Alter stabiler Stand wiederhergestellt. Fehlerprotokoll in data/build_error.log gespeichert."
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

echo "[GAP-Flow] Starte GAP-Flow..."
exec npm start
