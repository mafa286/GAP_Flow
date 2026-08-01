import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { SystemState, Group, Station, LogEntry } from './types';
import * as dbModule from './db';
import * as allocatorModule from './allocator';

/**
 * Schnittstelle für aggregierte Systemstatistiken.
 */
export interface SystemStats {
  anwaerter: number;
  groups: number;
  stations: number;
  logs: number;
}

/**
 * Konfigurationsobjekt zur Initialisierung des Controllers.
 */
export interface AdminControllerOptions {
  systemState: SystemState;
  checkAndLogGroupCompletion: (group: Group) => void;
  executeRevertCompletion: (
    group: Group,
    station: Station,
    originalSubStationId?: string,
    examinerName?: string
  ) => boolean;
  isLogForStation: (log: LogEntry, station: Station) => boolean;
  commitAndRespond: (res: Response, data?: Record<string, unknown>, runAllocator?: boolean) => void;
  ADMIN_PASSWORD: string;
  getAdminSessionToken: () => string;
  writeSystemLog: (
    groupName: string,
    stationId: string,
    durationMinutes: number,
    examiner: string,
    extraProps?: Record<string, unknown>
  ) => LogEntry | null;
}

let systemState: SystemState;
let checkAndLogGroupCompletion: (group: Group) => void = () => {};
let executeRevertCompletion: (
  group: Group,
  station: Station,
  originalSubStationId?: string,
  examinerName?: string
) => boolean = () => false;
let isLogForStation: (log: LogEntry, station: Station) => boolean = () => false;
let commitAndRespond: (res: Response, data?: Record<string, unknown>, runAllocator?: boolean) => void = (
  res,
  data = { success: true }
) => res.json(data);
let adminPasswordInternal = '';
let getAdminSessionToken: () => string = () => '';
let writeSystemLog: (
  groupName: string,
  stationId: string,
  durationMinutes: number,
  examiner: string,
  extraProps?: Record<string, unknown>
) => LogEntry | null = () => null;

/**
 * Initialisiert den Haupt-Admin-Controller mit den benötigten Abhängigkeiten.
 * @param {AdminControllerOptions} options - Konfigurationsobjekt.
 * @returns {void}
 */
export function init(options: AdminControllerOptions): void {
  systemState = options.systemState;
  checkAndLogGroupCompletion = options.checkAndLogGroupCompletion;
  executeRevertCompletion = options.executeRevertCompletion;
  isLogForStation = options.isLogForStation;
  commitAndRespond = options.commitAndRespond;
  adminPasswordInternal = options.ADMIN_PASSWORD;
  getAdminSessionToken = options.getAdminSessionToken;
  writeSystemLog = options.writeSystemLog;
}

/**
 * Markiert einen Log-Eintrag als storniert und persistiert die Änderung.
 * @param {number} logTimestamp - Der Zeitstempel des stornierten Log-Eintrags.
 * @param {Group} group - Die betroffene Gruppe.
 * @param {Station} station - Die betroffene Hauptstation.
 * @param {string} originalSubStationId - ID der Unterstation.
 * @param {string} examinerName - Name des Administrators.
 * @returns {void}
 */
export function processLogCancellation(
  logTimestamp: number,
  group: Group,
  station: Station,
  originalSubStationId: string,
  examinerName: string
): void {
  const inMemoryLog = systemState.logs.find((l) => l.timestamp === logTimestamp);
  if (inMemoryLog) {
    inMemoryLog.cancelled = true;
  }
  if (!systemState.pendingLogCancellations) {
    systemState.pendingLogCancellations = [];
  }
  systemState.pendingLogCancellations.push(logTimestamp);

  executeRevertCompletion(group, station, originalSubStationId, examinerName);
}

/**
 * Liefert aggregierte Systemstatistiken für Verifizierungszwecke.
 * @returns {SystemStats} Anzahl der Objekte im Speicher.
 */
export function getSystemStats(): SystemStats {
  return {
    anwaerter: Object.keys(systemState.anwaerter || {}).length,
    groups: Object.keys(systemState.groups || {}).length,
    stations: Object.keys(systemState.stations || {}).length,
    logs: (systemState.logs || []).length,
  };
}

/**
 * Hilfsfunktion zum Senden der standardisierten Erfolgsantwort nach Admin-Authentifizierung.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
function sendAdminAuthSuccess(res: Response): void {
  res.json({
    success: true,
    token: getAdminSessionToken(),
    counts: getSystemStats(),
  });
}

/**
 * Validiert die Eingabe des Administrator-Passworts und liefert das Sitzungstoken zurück.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function verify(req: Request, res: Response): void {
  const { password } = req.body || {};
  if (typeof password === 'string' && password.trim() === adminPasswordInternal) {
    sendAdminAuthSuccess(res);
  } else {
    res.status(401).json({ error: 'Falsch' });
  }
}

/**
 * Überprüft die Gültigkeit des übermittelten Administrator-Sitzungstokens.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function verifyToken(req: Request, res: Response): void {
  const { token } = req.body || {};
  if (typeof token === 'string' && token.trim() === getAdminSessionToken()) {
    sendAdminAuthSuccess(res);
  } else {
    res.status(401).json({ error: 'Ungültig' });
  }
}

/**
 * Storniert einen abgeschlossenen Prüfungslauf einer Gruppe anhand des Log-Zeitstempels.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {Promise<void>}
 */
export async function revertLog(req: Request, res: Response): Promise<void> {
  try {
    const { timestamp } = req.body || {};
    let targetLog = systemState.logs.find((l) => l.timestamp === timestamp);

    if (!targetLog && !dbModule.getUseJsonFallback()) {
      targetLog = await new Promise<LogEntry | null>((resolve) => {
        const db = dbModule.getDb();
        if (!db) {
          resolve(null);
          return;
        }
        db.get(
          'SELECT * FROM logs WHERE timestamp = ?',
          [timestamp],
          (err: Error | null, row: LogEntry & { cancelled?: number }) => {
            if (err || !row) {
              resolve(null);
            } else {
              resolve({
                ...row,
                cancelled: row.cancelled === 1,
              });
            }
          }
        );
      });
    }

    if (!targetLog) {
      res.status(404).json({ error: 'Nicht gefunden' });
      return;
    }

    const logToRevert = targetLog;

    if (logToRevert.cancelled) {
      res.status(400).json({ error: 'Bereits storniert' });
      return;
    }
    if (logToRevert.durationMinutes < 0) {
      res.status(400).json({ error: 'Nur Abschlüsse stornierbar' });
      return;
    }

    const station = Object.values(systemState.stations).find((s) => isLogForStation(logToRevert, s));
    if (!station) {
      res.status(404).json({ error: 'Station fehlt' });
      return;
    }

    const group = Object.values(systemState.groups).find((g) => g.name === logToRevert.groupName);
    if (!group) {
      res.status(404).json({ error: 'Gruppe fehlt' });
      return;
    }
    if (!(group.completedStations || []).includes(station.id)) {
      res.status(400).json({ error: 'Nicht abgeschlossen' });
      return;
    }

    processLogCancellation(timestamp, group, station, logToRevert.stationId, 'Leitstand');
    commitAndRespond(res);
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Liefert das aktuelle Server-Boot-Protokoll und Kompilierungsfehler von verworfenen Updates.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function getSystemLogs(req: Request, res: Response): void {
  try {
    const dbDir = path.join(__dirname, '..', 'data');
    const errorLogPath = path.join(dbDir, 'build_error.log');

    let buildErrorLog = '';
    let hasBuildError = false;

    if (fs.existsSync(errorLogPath)) {
      buildErrorLog = fs.readFileSync(errorLogPath, 'utf-8');
      hasBuildError = true;
    }

    res.json({
      success: true,
      hasBuildError,
      buildErrorLog,
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Aktiviert oder deaktiviert den automatischen Zuteilungs-Daemon.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function toggleAutoAllocation(req: Request, res: Response): void {
  try {
    const { active } = req.body || {};
    systemState.autoAllocationActive = !!active;

    commitAndRespond(
      res,
      { success: true, autoAllocationActive: systemState.autoAllocationActive },
      systemState.autoAllocationActive
    );
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Trägt den erfolgreichen Abschluss einer Hauptstation für eine Gruppe manuell nach.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function correctionsComplete(req: Request, res: Response): void {
  try {
    const { groupId, stationId } = req.body || {};
    const group = systemState.groups[groupId];
    const station = systemState.stations[stationId];

    if (!group || !station) {
      res.status(404).json({ error: 'Fehlt' });
      return;
    }
    if (!group.completedStations) {
      group.completedStations = [];
    }
    if (group.completedStations.includes(stationId)) {
      res.status(400).json({ error: 'Bereits beendet' });
      return;
    }

    allocatorModule.fixGroupMembersIfNeeded(group, systemState);

    if (!group.completedStations.includes(stationId)) {
      group.completedStations.push(stationId);
    }
    group.lastStatusChange = getUniqueTimestamp();

    allocatorModule.clearGroupReservation(station, group.id);

    writeSystemLog(group.name, station.name, -11, 'Leitstand (Nachmeldung)', { cancelled: false });
    checkAndLogGroupCompletion(group);
    commitAndRespond(res);
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Storniert den manuellen/automatischen Abschluss einer Station für eine Gruppe.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {Promise<void>}
 */
export async function correctionsRevert(req: Request, res: Response): Promise<void> {
  try {
    const { groupId, stationId } = req.body || {};
    const group = systemState.groups[groupId];
    const station = systemState.stations[stationId];

    if (!group || !station) {
      res.status(404).json({ error: 'Fehlt' });
      return;
    }
    if (!(group.completedStations || []).includes(stationId)) {
      res.status(400).json({ error: 'Nicht beendet' });
      return;
    }

    let originalSubStationId: string | null = null;
    let logToCancelTimestamp: number | null = null;

    systemState.logs.forEach((log) => {
      const matchesStation = isLogForStation(log, station);
      if (
        log.groupName === group.name &&
        matchesStation &&
        !log.cancelled &&
        (log.durationMinutes >= 0 || log.durationMinutes === -11)
      ) {
        logToCancelTimestamp = log.timestamp;
        originalSubStationId = log.stationId;
      }
    });

    if (!logToCancelTimestamp && !dbModule.getUseJsonFallback()) {
      const dbRow = await new Promise<{ timestamp: number; deviceToken?: string; stationId: string } | null>(
        (resolve) => {
          const db = dbModule.getDb();
          if (!db) {
            resolve(null);
            return;
          }
          db.get(
            'SELECT * FROM logs WHERE groupName = ? AND cancelled = 0 AND (durationMinutes >= 0 OR durationMinutes = -11) AND (stationId = ? OR stationId LIKE ?)',
            [group.name, station.name, `${station.id}.%`],
            (err: Error | null, row: unknown) => {
              if (err) resolve(null);
              else resolve(row as { timestamp: number; deviceToken?: string; stationId: string });
            }
          );
        }
      );
      if (dbRow) {
        logToCancelTimestamp = dbRow.timestamp;
        originalSubStationId = dbRow.deviceToken || dbRow.stationId;
      }
    }

    if (logToCancelTimestamp && originalSubStationId) {
      processLogCancellation(
        logToCancelTimestamp,
        group,
        station,
        originalSubStationId,
        'Leitstand (Manuelle Korrektur)'
      );
    }

    commitAndRespond(res);
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}
