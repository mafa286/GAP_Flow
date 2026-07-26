# 🌊 GAP-Flow (PMS)

> **Echtzeit Prüfungs-Management-System mit automatisierter Gruppenzuteilung**  
> Speziell entwickelt für die praktische Grundausbildungs-Prüfungen im Technischen Hilfswerk (THW), im weitläufigen Gelände.

![Node.js](https://img.shields.io/badge/Node.js-20_LTS-green?style=flat-square&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square&logo=typescript)
![Docker](https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker)
![License](https://img.shields.io/badge/License-MIT-orange?style=flat-square)

---

## 🎯 Problemstellung & Lösung

### Problem im Feld:
Manuelle Zuteilungen von Prüfungsteams zu Stationen (z. B. Erste Hilfe, Knotenkunde, Holzbearbeitung) führen auf weitläufigen Prüfungsgeländen regelmäßig zu Staus (Bottlenecks) an einzelnen Stationen, während andere Prüfer im Leerlauf warten. Die Prüfungsleitung verliert ohne digitale Hilfsmittel schnell den Überblick über Restlaufzeiten und den Gesamtablauf.

### Die Lösung durch GAP-Flow:
1. **🤖 Automatische Zuteilung (Allocator Engine):** Freie Unterstationen erhalten im Leerlauf sofort das am besten geeignete Team aus dem Sammelraum zugewiesen. Die Priorisierung erfolgt automatisch nach Rückstand und Wartezeit.
2. **📺 Beamer-Monitor (Echtzeit):** Wartende Teams sehen auf einer zentralen Großbildleinwand sekundenaktuell ihren Status, absolvierte Stationen und direkte Zuweisungen.
3. **📱 Mobiles Prüfer-Panel (PWA):** Prüfer steuern den Ablauf am Smartphone mit minimalem Aufwand (Start, Pause, Abschluss) und koppeln ihr Gerät fälschungssicher per QR-Code.
4. **🎛️ Zentraler Leitstand (Admin-Panel):** Die Prüfungsleitung überwacht Restlaufzeit-Prognosen (via Chart.js), nimmt manuelle Zuweisungen vor und verwaltet die Anwärterdatenbank.

---

## ✨ Hauptmerkmale

* **⚡ Echtzeit-Synchronisation:** Nahtlose Bidirektionale Updates über Socket.io WebSockets.
* **🔒 Datenschutz & DSGVO-Konformität:**
  * Der Beamer-Monitor überträgt **keinerlei Personennamen**.
  * Prüfer sehen **ausschließlich** die Namen der aktuell an ihrer Station befindlichen Gruppe.
* **📲 PWA & Offline-Resilienz:** Das Prüfer-Panel ist als Progressive Web App installierbar und durch Network-First Caching auch bei transienten Funklöchern auf dem Prüfungsgelände stabil.
* **🔐 TOFU-Sicherheit (Trust on First Use):** Prüfer koppeln ihr Smartphone einmalig per QR-Code an eine Unterstation. Ein fälschungssicheres `deviceToken` sperrt Fremdzugriffe.
* **⏳ 7-Sekunden Gnadenfrist (Grace Period):** Verhindert Versehens-Klicks beim Prüfungsabschluss und bietet die Möglichkeit zur Rücknahme oder vorgemerkten Stationpause.
* **📂 CSV-Massenimport & Export:** Einfacher Import von Anwärtern und Stations-Setups aus Excel/CSV sowie fälschungssicherer Protokoll-Export (RFC-konform).
* **💾 Ausfallsichere Persistenz:** ACID-Transaktionsschutz via SQLite3 mit automatischem In-Memory- und JSON-Fallback.

---

## 🛠️ Technologie-Stack

* **Backend / Runtime:** Node.js (v20+ LTS), Express 5, Socket.io, SQLite3, Execution via `tsx`
* **Frontend:** Browser-TypeScript (`public/js/*.ts`), Alpine.js v3.14, Tailwind CSS, Web Audio API Synthesizer
* **Container:** Docker, Docker Compose

---

## 🚀 Schnellstart

### Variante A: Mit Docker Compose (Empfohlen)

Erstelle eine `docker-compose.yml` auf deinem Server:

```yaml
version: '3.8'

services:
  gap-flow:
    image: node:20-alpine
    container_name: gap_flow
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - TZ=Europe/Berlin
      - PORT=3000
      - ADMIN_PASSWORD=admin123 # Ändere hier das Passwort für den Leitstand
    entrypoint: >
      sh -c "
      apk add --no-cache git &&
      npm install -g npm@latest &&
      git config --global --add safe.directory '*' &&
      if ! git -C /app/GAP-Flow rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo '[Docker] Klone Repository von GitHub...' &&
        mkdir -p /app/GAP-Flow &&
        git clone https://github.com/mafa286/GAP_Flow.git /app/GAP-Flow;
      else
        echo '[Docker] Ziehe neusten Stand von GitHub...' &&
        cd /app/GAP-Flow && git pull origin main;
      fi &&
      cd /app/GAP-Flow &&
      mkdir -p ../node_modules &&
      rm -rf node_modules &&
      ln -sf ../node_modules node_modules &&
      npm install &&
      npm start
      "
```

Starte den Container:

```Bash
docker compose up -d
```


### Variante B: Manuelle Installation (Lokale Entwicklung)

**Repository klonen, installieren & starten:**

```Bash
git clone https://github.com/mafa286/GAP_Flow.git
cd GAP_Flow
npm install
npm start
```

Die Anwendung ist anschließend unter https://deine-domain.de:3000 erreichbar.

---
## ⚙️ Umgebungsvariablen

| Variable | Beschreibung | Standardwert |
| :--- | :--- | :--- | :--- |
| PORT | Der HTTP-Port, auf dem der GAP-Flow Server lauscht. | 3000 |
| ADMIN_PASSWORD | Das Passwort für die Anmeldung am Admin-Leitstand. | admin123 |
| TZ | Die Server-Zeitzone für korrekte Uhrzeiten im Protokoll. | Europe/Berlin |

---
## 📖 Benutzung im Prüfungseinsatz

1. **Admin-Leitstand öffnen:** (https://deine-domain.de:3000/admin_dashboard.html) Mit dem konfigurierten ADMIN_PASSWORD einloggen.
2. **Teilnehmer & Gruppen anlegen:** (https://deine-domain.de:3000/admin_groups.html) Anwärter manuell registrieren oder per CSV-Datei importieren und zu statischen Teams zusammenstellen.
3. **Stationen konfigurieren:** (https://deine-domain.de:3000/admin_stations.html) Prüfungsstationen anlegen und den Unterstationen zugewiesene Prüfer eintragen (oder per CSV importieren).
4. **Prüfer-Kopplung:** Prüfer scannen den QR-Code ihrer Station mit dem Smartphone oder rufen den Link (https://deine-domain.de:3000/pruefer.html?token=1.1) (1.1 = Nummer der Unterstation) auf und tragen ihren Namen ein.
5. **Startschuss:** In der Kopfzeile des Leitstands den Schalter "Autom. Zuteilung" auf AKTIV stellen. Das System übernimmt die Steuerung vollautomatisch!

---
## 📄 Lizenz

Dieses Projekt steht unter der MIT-Lizenz.