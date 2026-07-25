# GAP-Flow (PMS)

Echtzeit-Prüfungs-Management-System für Hilfsorganisationen (THW, Feuerwehr, DRK) zur automatisierten Zuteilung von Prüfungsteams im Feld.

## 🛠️ Tech-Stack
- **Backend:** Node.js (v20+), Express 5, Socket.io, SQLite3
- **Frontend:** Vanilla-TypeScript, Alpine.js v3.14, Tailwind CSS
- **Infrastruktur:** Docker Compose

## 🚀 Wichtige Befehle

### Entwicklung (Lokal)
1. Abhängigkeiten installieren: `npm install`
2. Frontend kompilieren & Server starten: `npm start`
*(Führt im Hintergrund `npm run build:frontend && npx tsx server.ts` aus)*

📂 Projektstruktur
/lib - Backend-Logik (Allocator, Sockets, DB-Persistenz)
/public - PWA & Frontend-HTML-Dateien
/public/js - TypeScript-Quelldateien für den Browser

### Deployment (Docker)
Container im Hintergrund starten und neu bauen:
```bash docker compose up -d --build
