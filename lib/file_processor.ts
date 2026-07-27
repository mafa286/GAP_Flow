// Version Tracker: lib/file_processor.ts (GAP-Flow v1.1.64)

import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { exec } from 'child_process';
import { Request, Response } from 'express';
import { SystemState, LogEntry } from './types';
import * as dbModule from './db';

/**
 * Konfigurationsobjekt zur Initialisierung des Dateiverarbeitungs-Moduls.
 */
export interface FileProcessorOptions {
  systemState: SystemState;
  dbDir: string;
  backupDir: string;
  appDir: string;
  shutdown: () => void;
}

let systemState: SystemState;
let dbDir = '';
let backupDir = '';
let appDir = '';
let shutdown: () => void = () => {};

/**
 * Initialisiert das Dateiverarbeitungs-Modul mit den benötigten globalen Abhängigkeiten.
 * @param {FileProcessorOptions} options - Konfigurationsobjekt.
 * @returns {void}
 */
export function init(options: FileProcessorOptions): void {
  systemState = options.systemState;
  dbDir = options.dbDir || '';
  backupDir = options.backupDir || '';
  appDir = options.appDir || '';
  shutdown = options.shutdown;
}

/**
 * Hilfsfunktion zur Formatierung eines Unix-Zeitstempels in ein standardisiertes
 * Datums- und Uhrzeitformat für den CSV-Export.
 * @param {number} timestamp - Der zu formatierende Millisekunden-Zeitstempel.
 * @returns {{ dateStr: string, timeStr: string }} Ein Objekt mit den formatierten Strings.
 */
export function formatDateTime(timestamp: number): { dateStr: string; timeStr: string } {
  const dateObj = new Date(timestamp);
  const pad = (num: number) => num.toString().padStart(2, '0');
  const datumStr = `${pad(dateObj.getDate())}.${pad(dateObj.getMonth() + 1)}.${dateObj.getFullYear()}`;
  const uhrzeitStr = `${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;
  return { dateStr: datumStr, timeStr: uhrzeitStr };
}

/**
 * Erstellt dynamisch ein ZIP-Backup der aktuellen Codebasis und initiiert den Datei-Download.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function downloadCode(req: Request, res: Response): void {
  try {
    const zip = new AdmZip();

    const files = fs.readdirSync(appDir);
    files.forEach((file) => {
      if (file === 'data' || file === 'node_modules' || file === '.git') return;

      const fullPath = path.join(appDir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        zip.addLocalFolder(fullPath, file);
      } else {
        zip.addLocalFile(fullPath);
      }
    });

    const dObj = new Date();
    const dPad = (n: number) => n.toString().padStart(2, '0');
    const timestampStr = `${dObj.getFullYear()}${dPad(dObj.getMonth() + 1)}${dPad(dObj.getDate())}_${dPad(dObj.getHours())}${dPad(dObj.getMinutes())}`;
    const downloadBackupName = `${timestampStr}_download_GAP-Flow.zip`;

    zip.writeZip(path.join(backupDir, downloadBackupName));

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=GAP-Flow.zip');
    res.status(200).send(zipBuffer);
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Verarbeitet hochgeladene Update-Pakete über ein sicheres Blue-Green Staging-Verfahren.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function uploadCode(req: Request, res: Response): void {
  const tempZipPath = path.join(dbDir, 'update_temp.zip');
  const stagingDir = path.join(dbDir, 'update_staging');

  try {
    const zipBuffer = req.body as Buffer;
    if (!zipBuffer || zipBuffer.length === 0) {
      res.status(400).json({ error: 'Fehlt' });
      return;
    }

    fs.writeFileSync(tempZipPath, zipBuffer);

    const zip = new AdmZip(tempZipPath);
    const zipEntries = zip.getEntries();

    const hasServer = zipEntries.some((e) => e.entryName === 'server.js' || e.entryName === 'server.ts');
    const hasPackage = zipEntries.some((e) => e.entryName === 'package.json');

    if (!hasServer || !hasPackage) {
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath);
      }
      res.status(400).json({ error: 'Ungültig: Das Paket muss server.js/server.ts und package.json enthalten.' });
      return;
    }

    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stagingDir, { recursive: true });

    zip.extractAllTo(stagingDir, true);

    const liveNodeModules = path.join(appDir, 'node_modules');
    const stagingNodeModules = path.join(stagingDir, 'node_modules');
    if (fs.existsSync(liveNodeModules)) {
      fs.cpSync(liveNodeModules, stagingNodeModules, { recursive: true });
    }

    const backupZip = new AdmZip();
    const files = fs.readdirSync(appDir);
    files.forEach((file) => {
      if (file === 'data' || file === 'node_modules' || file === '.git') return;
      const fullPath = path.join(appDir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        backupZip.addLocalFolder(fullPath, file);
      } else {
        backupZip.addLocalFile(fullPath);
      }
    });

    const dObj = new Date();
    const dPad = (n: number) => n.toString().padStart(2, '0');
    const timestampStr = `${dObj.getFullYear()}${dPad(dObj.getMonth() + 1)}${dPad(dObj.getDate())}_${dPad(dObj.getHours())}${dPad(dObj.getMinutes())}`;
    const backupFileName = `${timestampStr}_backup_GAP-Flow.zip`;
    const uploadFileName = `${timestampStr}_upload_GAP-Flow.zip`;

    backupZip.writeZip(path.join(backupDir, backupFileName));
    fs.writeFileSync(path.join(backupDir, uploadFileName), zipBuffer);

    exec('npm install', { cwd: stagingDir }, (err) => {
      if (err) {
        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        if (fs.existsSync(tempZipPath)) {
          fs.unlinkSync(tempZipPath);
        }
        res.status(500).json({ error: `Fehler beim Auflösen der NPM-Abhängigkeiten: ${err.message}` });
        return;
      }

      try {
        const stagingNodeModulesPath = path.join(stagingDir, 'node_modules');
        if (fs.existsSync(stagingNodeModulesPath)) {
          fs.rmSync(stagingNodeModulesPath, { recursive: true, force: true });
        }
        const stagingData = path.join(stagingDir, 'data');
        if (fs.existsSync(stagingData)) {
          fs.rmSync(stagingData, { recursive: true, force: true });
        }

        // Saubere Bereinigung: Löscht alle Altdateien im App-Verzeichnis außer "data", "node_modules" & ".git"
        const liveItems = fs.readdirSync(appDir);
        liveItems.forEach((item) => {
          if (item === 'data' || item === 'node_modules' || item === '.git') return;
          const itemPath = path.join(appDir, item);
          fs.rmSync(itemPath, { recursive: true, force: true });
        });

        fs.cpSync(stagingDir, appDir, { recursive: true, force: true });

        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        if (fs.existsSync(tempZipPath)) {
          fs.unlinkSync(tempZipPath);
        }

        exec('npm install', { cwd: appDir }, (installErr) => {
          if (installErr) {
            console.error('[System-Update] Warnung bei Live-npm-install:', installErr.message);
          }

          res.json({ success: true });

          setTimeout(() => {
            shutdown();
          }, 1500);
        });
      } catch (copyErr) {
        const error = copyErr as Error;
        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        if (fs.existsSync(tempZipPath)) {
          fs.unlinkSync(tempZipPath);
        }
        res.status(500).json({ error: `Kopierfehler bei Staging-Übertragung: ${error.message}` });
      }
    });
  } catch (err) {
    const error = err as Error;
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempZipPath)) {
      fs.unlinkSync(tempZipPath);
    }
    res.status(500).json({ error: error.message });
  }
}

/**
 * Erstellt bei jedem erfolgreichen Serverstart ein automatisches ZIP-Backup im Backup-Verzeichnis.
 * Sichert Quellcode und Datenbanken mit Zeitstempel und bereinigt veraltete Backups.
 * @returns {string | null} Der Dateiname des erstellten Backups oder null bei Fehler.
 */
export function createAutoBackupZip(): string | null {
  try {
    if (!backupDir || !fs.existsSync(backupDir)) {
      if (backupDir) {
        fs.mkdirSync(backupDir, { recursive: true });
      } else {
        return null;
      }
    }

    const zip = new AdmZip();

    // 1. Quellcode und Konfigurationsdateien hinzufügen (ohne node_modules & .git)
    const files = fs.readdirSync(appDir);
    files.forEach((file) => {
      if (file === 'node_modules' || file === '.git' || file === 'data') return;

      const fullPath = path.join(appDir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        zip.addLocalFolder(fullPath, file);
      } else {
        zip.addLocalFile(fullPath);
      }
    });

    // 2. Datenbank-Verzeichnis (data/) explizit mit sichern
    if (dbDir && fs.existsSync(dbDir)) {
      zip.addLocalFolder(dbDir, 'data');
    }

    const dObj = new Date();
    const dPad = (n: number) => n.toString().padStart(2, '0');
    const timestampStr = `${dObj.getFullYear()}${dPad(dObj.getMonth() + 1)}${dPad(dObj.getDate())}_${dPad(dObj.getHours())}${dPad(dObj.getMinutes())}${dPad(dObj.getSeconds())}`;
    const backupFileName = `GAP-Flow_AutoBackup_${timestampStr}.zip`;
    const targetPath = path.join(backupDir, backupFileName);

    zip.writeZip(targetPath);
    console.log(`[Auto-Backup] Automatisches System-Backup erfolgreich erstellt: ${backupFileName}`);

    // 3. Veraltete automatische Backups bereinigen (behalte die 10 aktuellsten Backups)
    try {
      const backupFiles = fs.readdirSync(backupDir)
        .filter((f) => f.startsWith('GAP-Flow_AutoBackup_') && f.endsWith('.zip'))
        .map((f) => ({
          name: f,
          path: path.join(backupDir, f),
          mtime: fs.statSync(path.join(backupDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (backupFiles.length > 10) {
        backupFiles.slice(10).forEach((oldFile) => {
          fs.unlinkSync(oldFile.path);
          console.log(`[Auto-Backup] Altes Backup bereinigt: ${oldFile.name}`);
        });
      }
    } catch (cleanupErr) {
      console.warn('[Auto-Backup] Warnung bei Altdaten-Bereinigung:', cleanupErr);
    }

    return backupFileName;
  } catch (err) {
    const error = err as Error;
    console.error('[Auto-Backup] Fehler beim Erstellen des automatischen Backups:', error.message);
    return null;
  }
}

/**
 * Generiert ein RFC-konformes, UTF-8-kodiertes CSV-Dokument mit BOM aus allen Systemprotokollen.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {Promise<void>}
 */
export async function exportCsv(req: Request, res: Response): Promise<void> {
  try {
    let logsToExport: LogEntry[] = [];

    if (dbModule.getUseJsonFallback()) {
      logsToExport = systemState.logs;
    } else {
      logsToExport = await new Promise<LogEntry[]>((resolve) => {
        const db = dbModule.getDb();
        if (!db) {
          resolve(systemState.logs);
          return;
        }
        db.all('SELECT * FROM logs ORDER BY timestamp ASC', (err: Error | null, rows: (LogEntry & { cancelled?: number })[]) => {
          if (err) {
            console.error('[Export] Fehler beim Laden der Logs aus SQLite, weiche auf RAM aus:', err.message);
            resolve(systemState.logs);
          } else {
            resolve((rows || []).map((r) => ({
              ...r,
              cancelled: r.cancelled === 1,
              examiner: r.examiner || '',
            })));
          }
        });
      });
    }

    let csv = 'Datum;Uhrzeit;Gruppe / Akteur;Station / ID;Prüfer;Aktion / Ereignis;Dauer / Details;Revisions-Status\n';

    logsToExport.forEach((l) => {
      const { dateStr: datumStr, timeStr: uhrzeitStr } = formatDateTime(l.timestamp);

      const actor = l.groupName || '';
      const stationId = l.stationId || '';
      const examiner = l.examiner || '';
      let event = '';
      let details = '';
      const status = l.cancelled ? 'Storniert' : 'Gültig';

      let stationDisplay = stationId;
      if (stationId && stationId.includes('.')) {
        const masterId = stationId.split('.')[0];
        const master = systemState.stations[masterId];
        if (master) {
          stationDisplay = `'${stationId} (${master.name})`;
        } else {
          stationDisplay = `'${stationId}`;
        }
      } else if (stationId && systemState.stations[stationId]) {
        stationDisplay = systemState.stations[stationId].name;
      }

      if (l.durationMinutes === -1) {
        event = 'Pause für Gruppe aktiviert';
      } else if (l.durationMinutes === -2) {
        event = 'Pause für Gruppe beendet';
      } else if (l.durationMinutes === -3) {
        event = 'Unterstation wurde pausiert';
      } else if (l.durationMinutes === -4) {
        event = 'Unterstation wurde wieder aktiv geschaltet';
      } else if (l.durationMinutes === -5) {
        event = 'Gruppe automatisch reaktiviert (30 Min. abgelaufen)';
      } else if (l.durationMinutes === -6) {
        event = 'ALLE PRÜFUNGEN ERFOLGREICH BEENDET';
      } else if (l.durationMinutes === -7) {
        event = 'Abschlussmeldung nachträglich storniert (Admin)';
      } else if (l.durationMinutes === -8) {
        event = 'Manuelle Zuweisung durch Leitstand (Start)';
      } else if (l.durationMinutes === -9) {
        event = 'Manuelle Freigabe / Entzug durch Leitstand';
      } else if (l.durationMinutes === -10) {
        event = 'Automatische Zuweisung (Start)';
      } else if (l.durationMinutes === -11) {
        event = 'Manuelle Nachmeldung durch Admin';
        details = 'Als erledigt markiert';
      } else if (l.durationMinutes === -12) {
        event = 'Teilnehmer-Gruppenzuweisung fixiert';
        details = `Anwärter: ${l.examiner}`;
      } else if (l.durationMinutes === -13) {
        event = 'Prüferwechsel an einer Unterstation (Protokoll erfasst neuen Namen)';
      } else {
        event = 'Prüfungslauf absolviert';
        details = `${parseFloat(String(l.durationMinutes)).toFixed(1)} Minuten`;
      }

      const sanitizeFormula = (val: string): string => {
        let clean = val.replace(/"/g, '""').trim();
        if (/^[=+\-@\t\r]/.test(clean)) {
          clean = `'${clean}`;
        }
        return clean;
      };

      const cleanActor = sanitizeFormula(actor);
      const cleanStation = sanitizeFormula(stationDisplay);
      const cleanExaminer = sanitizeFormula(examiner);
      const cleanEvent = sanitizeFormula(event);
      const cleanDetails = sanitizeFormula(details);

      csv += `"${datumStr}";"${uhrzeitStr}";"${cleanActor}";"${cleanStation}";"${cleanExaminer}";"${cleanEvent}";"${cleanDetails}";"${status}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=pruefungs_protokoll.csv');
    res.status(200).send(Buffer.from(`\uFEFF${csv}`, 'utf-8'));
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}
