<!-- Version Tracker: README.md (GAP-Flow v1.0.1) -->
# 🌊 GAP-Flow (PMS)

> **Echtzeit Prüfungs-Management-System mit automatisierter Gruppenzuteilung**  
> Speziell entwickelt für praktische Grundausbildungs-Prüfungen des Technischen Hilfswerks (THW) im weitläufigen Gelände.

![Node.js](https://img.shields.io/badge/Node.js-26-green?style=flat-square&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue?style=flat-square&logo=typescript)
![ESLint](https://img.shields.io/badge/ESLint-10_Flat--Config-4B32C3?style=flat-square&logo=eslint)
![Docker](https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker)
![License](https://img.shields.io/badge/License-MIT-orange?style=flat-square)

---

## 🎯 Problemstellung & Lösung

### Problem im Feld:
Manuelle Zuteilungen von Prüfungsteams zu Stationen (z. B. Erste Hilfe, Knotenkunde, Holzbearbeitung) führen auf weitläufigen Prüfungsgeländen regelmäßig zu Staus (Bottlenecks) an einzelnen Stationen, während andere Prüfer im Leerlauf warten. Die Prüfungsleitung verliert ohne digitale Hilfsmittel schnell den Überblick über Restlaufzeiten und den Gesamtablauf.

### Die Lösung durch GAP-Flow:
1. **🤖 Automatische Zuteilung (Allocator Engine):** Freie Unterstationen erhalten im Leerlauf sofort das am besten geeignete Team aus dem Sammelraum zugewiesen. Die Priorisierung erfolgt automatisch nach Rückstand und Wartezeit.
2. **📺 Beamer-Monitor (Echtzeit):** Wartende Teams sehen auf einer zentralen Großbildleinwand sekundenaktuell ihren Status, absolvierte Stationen und direkte Zuweisungen.
3. **📱 Mobiles Prüfer-Panel (PWA):** Prüfer steuern den Ablauf am Smartphone mit minimalem Aufwand (Start, Pause, Abschluss), nutzen Direktwahl-Buttons für Leitstelle/Prüfungsleitung und koppeln ihr Gerät fälschungssicher per QR-Code.
4. **🎛️ Zentraler Leitstand (Admin-Panel):** Die Prüfungsleitung überwacht Restlaufzeit-Prognosen (via Chart.js), nimmt manuelle Zuweisungen vor und verwaltet die Anwärterdatenbank.

---

## ✨ Hauptmerkmale

* **🔒 Datenschutz & DSGVO-Konformität:**
  * Der Beamer-Monitor überträgt **keinerlei Personennamen**.
  * Prüfer sehen **ausschließlich** die Namen der aktuell an ihrer Station befindlichen Gruppe.
* **📞 PWA-Direktwahl & Telefonkontakte:** Schnellwahl-Buttons im Prüfer-Funktionsmenü zur direkten Kontaktaufnahme mit Leitstelle und Prüfungsleitung über Anruf.
* **🔐 TOFU-Sicherheit (Trust on First Use):** Prüfer koppeln ihr Smartphone einmalig per QR-Code an eine Unterstation. Ein fälschungssicheres `deviceToken` sperrt Fremdzugriffe.
* **⏳ 7-Sekunden Gnadenfrist (Grace Period):** Verhindert Versehens-Klicks beim Prüfungsabschluss und bietet die Möglichkeit zur Rücknahme oder vorgemerkten Stationpause.
* **📦 Automatisches Boot-Backup:** Erstellt bei jedem erfolgreichen Serverstart ein zeitsynchrones ZIP-Backup der Codebasis und Datenbanken im `/Backup`-Ordner mit automatischer Altdaten-Bereinigung.
* **📂 CSV-Massenimport & Export:** Einfacher Import von Anwärtern und Stations-Setups aus Excel/CSV sowie fälschungssicherer Protokoll-Export (RFC-konform).
* **📲 PWA & Offline-Resilienz:** Das Prüfer-Panel ist als Progressive Web App installierbar und durch Network-First Caching auch bei Funklöchern auf dem Prüfungsgelände ausfallsicher.
* **💾 Ausfallsichere Persistenz:** ACID-Transaktionsschutz via SQLite3 (N-API) mit automatischem In-Memory- und JSON-Fallback.
* **⚡ Höchste Performance & Nativität:** Blitzschneller Container-Boot (unter 2 Sekunden) auf Basis von Node.js 26, TypeScript 7 und nativem ESLint 10.
* **⚡ Echtzeit-Synchronisation:** Nahtlose Bidirektionale Updates über Socket.io 4.8 WebSockets.

---

## 🛠️ Technologie-Stack

* **Backend / Runtime:** Node.js 26 (`node:26-alpine`), Express 5.2, Socket.io 4.8, SQLite3 v6 (N-API), Execution via `tsx`
* **Frontend:** Browser-TypeScript 7 (`public/js/*.ts`), Alpine.js v3.14, Tailwind CSS, Web Audio API Synthesizer
* **Linter & Quality:** ESLint 10 Native Flat Config (`eslint.config.js`)
* **Container:** Docker, Docker Compose

---

## 🚀 Schnellstart

### Variante A: Mit Docker Compose (Empfohlen)

Erstelle eine `docker-compose.yml` auf deinem Server:

```yaml
version: '3.8'

services:
  gap-flow:
    image: node:26-alpine
    container_name: gap_flow
    working_dir: /app/GAP-Flow
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - TZ=Europe/Berlin
      - PORT=3000
      - NODE_ENV=production
      - ADMIN_PASSWORD=admin123 # Ändere hier das Passwort für den Leitstand
    volumes:
      - '/dein/lokaler/pfad/gapruefung:/app'
    entrypoint: /bin/sh /app/GAP-Flow/entrypoint.sh
```
Starte den Container:
```Bash
docker compose up -d
```

### Variante B: Manuelle Installation (Lokale Entwicklung)

Repository klonen, installieren & starten:
```Bash
git clone https://github.com/mafa286/GAP_Flow.git
cd GAP_Flow
npm install
npm start
```
Die Anwendung ist anschließend unter http://localhost:3000 erreichbar.

---

## ⚙️ Umgebungsvariablen
| Variable	| Beschreibung |	Standardwert |
| :--- | :--- | :--- |
| PORT	| Der HTTP-Port, auf dem der GAP-Flow Server lauscht.	| 3000 |
| ADMIN_PASSWORD	| Das Passwort für die Anmeldung am Admin-Leitstand.	| admin123 |
| TZ	| Die Server-Zeitzone für korrekte Uhrzeiten im Protokoll.	| Europe/Berlin |
| NODE_ENV	| Produktionsmodus für optimierte V8-Performance.	| production |

---

## 📖 Benutzung im Prüfungseinsatz
* **Admin-Leitstand öffnen:** (http://deine-domain.de:3000/admin_dashboard.html) Mit dem konfigurierten ADMIN_PASSWORD einloggen.
* **Teilnehmer & Gruppen anlegen:** (http://deine-domain.de:3000/admin_groups.html) Anwärter manuell registrieren oder per CSV-Datei importieren und zu statischen Teams zusammenstellen.
* **Stationen konfigurieren:** (http://deine-domain.de:3000/admin_stations.html) Prüfungsstationen anlegen und den Unterstationen zugewiesene Prüfer eintragen (oder per CSV importieren).
* **Telefonkontakte hinterlegen:** (http://deine-domain.de:3000/admin_settings.html) Namen und Telefonnummern für Leitstelle und Prüfungsleitung eintragen.
* **Prüfer-Kopplung:** Prüfer scannen den QR-Code ihrer Station mit dem Smartphone oder rufen den Link (http://deine-domain.de:3000/pruefer.html?token=1.1) auf und tragen ihren Namen ein.
* **Startschuss:** Auf der Seite Stationen & Skalierung (http://deine-domain.de:3000/admin_stations.html) im Top-Grid den Schalter auf ⚡ ZUTEILUNG: AKTIV umlegen. Das System übernimmt die Steuerung vollautomatisch!

---

## 📄 Lizenz
Dieses Projekt steht unter der MIT-Lizenz.
