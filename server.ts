// Version Tracker: server.ts (GAP-Flow v1.1.85)

import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

import { SystemState, Station, SubStation, Group, LogEntry } from './lib/types';
import * as dbModule from './lib/db';
import * as allocatorModule from './lib/allocator';
import * as socketsModule from './lib/sockets';
import * as fileProcessor from './lib/file_processor';
import * as adminController from './lib/admin_controller';
import * as adminGroupsController from './lib/admin_groups_controller';
import * as adminStationsController from './lib/admin_stations_controller';
import * as stateFilters from './lib/state_filters';

/**
 * Erweitertes Express Request-Interface für authentifizierte Prüfer-Anfragen.
 */
export interface AuthenticatedExaminerRequest extends Request {
  subStation?: SubStation;
  masterStation?: Station;
}

// Low-Level HTTP Header-Patching: Bereinigt Socket.io/Engine.io Polling-Header & veraltete Direktiven für WebHint
const originalSetHeader = http.ServerResponse.prototype.setHeader;
http.ServerResponse.prototype.setHeader = function (name: string, value: unknown) {
  if (typeof name === 'string') {
    const lowerName = name.toLowerCase();

    // 1. Verhindere das Setzen veralteter Header (X-Frame-Options, Expires)
    if (lowerName === 'x-frame-options' || lowerName === 'expires') {
      return this;
    }

    // 2. Bereinige Cache-Control von IE-Direktiven (post-check=0, pre-check=0), no-store, private und must-revalidate
    if (lowerName === 'cache-control' && typeof value === 'string') {
      let cleanCache = value
        .replace(/post-check=\d+/gi, '')
        .replace(/pre-check=\d+/gi, '')
        .replace(/no-store/gi, '')
        .replace(/must-revalidate/gi, '')
        .replace(/private/gi, '')
        .replace(/max-age=0/gi, '')
        .replace(/,\s*,/g, ',')
        .replace(/^,\s*|\s*,\s*$/g, '')
        .trim();
      if (!cleanCache || cleanCache === 'no-cache') cleanCache = 'no-cache';
      return originalSetHeader.call(this, name, cleanCache);
    }

    // 3. Garantiere X-Content-Type-Options & charset=utf-8 bei text/*
    if (lowerName === 'content-type' && typeof value === 'string') {
      originalSetHeader.call(this, 'X-Content-Type-Options', 'nosniff');
      if (value.startsWith('text/') && !value.toLowerCase().includes('charset')) {
        return originalSetHeader.call(this, name, `${value}; charset=utf-8`);
      }
    }
  }
  return originalSetHeader.call(this, name, value as any);
};

const originalWriteHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (this: http.ServerResponse, statusCode: number, ...args: unknown[]) {
  this.removeHeader('X-Frame-Options');
  this.removeHeader('Expires');
  this.setHeader('X-Content-Type-Options', 'nosniff');

  args.forEach((arg) => {
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
      const headerObj = arg as Record<string, unknown>;
      Object.keys(headerObj).forEach((key) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'x-frame-options' || lowerKey === 'expires') {
          delete headerObj[key];
        } else if (lowerKey === 'cache-control' && typeof headerObj[key] === 'string') {
          let cleanCache = (headerObj[key] as string)
            .replace(/post-check=\d+/gi, '')
            .replace(/pre-check=\d+/gi, '')
            .replace(/no-store/gi, 'no-cache')
            .replace(/must-revalidate/gi, '')
            .replace(/,\s*,/g, ',')
            .replace(/^,\s*|\s*,\s*$/g, '')
            .trim();
          if (!cleanCache) cleanCache = 'no-cache';
          headerObj[key] = cleanCache;
        } else if (lowerKey === 'content-type' && typeof headerObj[key] === 'string') {
          const val = headerObj[key] as string;
          if (val.startsWith('text/') && !val.toLowerCase().includes('charset')) {
            headerObj[key] = `${val}; charset=utf-8`;
          }
        }
      });
    }
  });

  return (originalWriteHead as Function).apply(this, [statusCode, ...args]);
};

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'exam_system.db');
const JSON_BACKUP_PATH = path.join(DB_DIR, 'state_backup.json');
const BACKUP_DIR = path.join(__dirname, '..', 'Backup');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Zentraler, synchroner In-Memory-Zustand des Systems (systemState).
 */
const systemState: SystemState = {
  anwaerter: {},
  groups: {},
  stations: {},
  logs: [],
  autoAllocationActive: false,
  firstAssignmentTime: null,
  isCleared: false,
  pendingLogCancellations: [],
};

let parsedPassword = (process.env.ADMIN_PASSWORD || '').trim();
if (!parsedPassword || parsedPassword === '""' || parsedPassword === "''" || parsedPassword === 'admin123') {
  console.warn('================================================------------------');
  console.warn('⚠️ SECURITY WARNING: ADMIN_PASSWORD ist auf dem Standardwert ("admin123")!');
  console.warn('Bitte setzen Sie ADMIN_PASSWORD in Ihren Umgebungsvariablen vor dem Produktiveinsatz.');
  console.warn('================================================------------------');
  parsedPassword = 'admin123';
}
const ADMIN_PASSWORD = parsedPassword;

/**
 * Generiert einen formatierten Datums-String des lokalen Server-Tages (YYYY-MM-DD).
 * @returns {string} Lokales Datum.
 */
export function getLocalDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generiert ein stabiles, eintägig gültiges SHA-256-Sitzungstoken.
 * @returns {string} Aktuelles Sitzungstoken.
 */
export function getAdminSessionToken(): string {
  return crypto.createHash('sha256')
    .update(`${ADMIN_PASSWORD}GAP_FLOW_SALT_${getLocalDateString()}`)
    .digest('hex');
}

let lastGlobalTimestamp = 0;

/**
 * Generiert einen eindeutigen, aufsteigenden Zeitstempel.
 * @returns {number} Eindeutiger Millisekunden-Zeitstempel.
 */
export function getUniqueTimestamp(): number {
  let now = Date.now();
  if (now <= lastGlobalTimestamp) {
    now = lastGlobalTimestamp + 1;
  }
  lastGlobalTimestamp = now;
  return now;
}

/**
 * Bereinigt und beschränkt Zeichenketten zum Schutz vor Injektionen.
 * @param {string} str - Die zu bereinigende Zeichenkette.
 * @param {number} maxLength - Die maximale zulässige Länge.
 * @returns {string} Bereinigte Zeichenkette.
 */
export function sanitizeName(str: string, maxLength: number): string {
  if (typeof str !== 'string') return '';
  let cleaned = str.trim().substring(0, maxLength);
  cleaned = cleaned.replace(/[^a-zA-Z0-9\s\-.,äöüÄÖÜßéèàáíóúÉÈÀÁÍÓÚ/()]/g, '');
  return cleaned.trim();
}

/**
 * Validiert, ob das übergebene Examiner-Token einer registrierten Unterstation zugewiesen ist.
 * @param {string} token - Das zu validierende Zugriffstoken.
 * @returns {boolean} True, wenn das Token gültig ist.
 */
export function isValidExaminerToken(token: string): boolean {
  const { subStation } = stateFilters.findSubStationAndMasterByToken(systemState, token);
  return !!subStation;
}

/**
 * Express-Middleware zur Verifizierung des Examiner-Tokens.
 * @param {AuthenticatedExaminerRequest} req - Express Request.
 * @param {Response} res - Express Response.
 * @param {NextFunction} next - Middleware Callback.
 * @returns {void}
 */
export const authenticateExaminer = (
  req: AuthenticatedExaminerRequest,
  res: Response,
  next: NextFunction
): void => {
  const tokenHeader = req.headers.authorization;
  const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  const { subStation, masterStation } = stateFilters.findSubStationAndMasterByToken(systemState, token || null);
  if (!subStation || subStation.active === false || !masterStation) {
    res.status(401).json({ error: 'Unterstation deaktiviert oder ungültiges Token' });
    return;
  }
  req.subStation = subStation;
  req.masterStation = masterStation;
  next();
};

/**
 * Erstellt einen neuen Log-Eintrag im synchronen In-Memory-Systemzustand.
 * @param {string} groupName - Name der betroffenen Gruppe.
 * @param {string} stationId - ID der Station oder Unterstation.
 * @param {number} durationMinutes - Dauer in Minuten oder Steuercode.
 * @param {string} examiner - Name des verantwortlichen Prüfers.
 * @param {Record<string, unknown>} [extraProps={}] - Zusätzliche Eigenschaften.
 * @returns {LogEntry} Der erstellte Log-Eintrag.
 */
export function writeSystemLog(
  groupName: string,
  stationId: string,
  durationMinutes: number,
  examiner: string,
  extraProps: Record<string, unknown> = {}
): LogEntry {
  const logEntry: LogEntry = {
    ...extraProps,
    timestamp: getUniqueTimestamp(),
    groupName: groupName || '',
    stationId: stationId || '',
    durationMinutes,
    examiner: examiner || 'System',
  };
  systemState.logs.push(logEntry);
  return logEntry;
}

/**
 * Bestätigt Zustandsänderungen, speichert asynchron und sendet Sockets.
 * @param {Response} res - Express Response.
 * @param {Record<string, unknown>} [data={ success: true }] - JSON-Daten.
 * @param {boolean} [runAllocator=true] - Steuert Zuteilungslauf.
 * @returns {void}
 */
export function commitAndRespond(
  res: Response,
  data: Record<string, unknown> = { success: true },
  runAllocator = true
): void {
  if (runAllocator) allocatorCheck();
  dbScheduleSave();
  ioBroadcast();
  res.json(data);
}

/**
 * Berechnet serverseitig die Durchschnittszeiten und Belegungsdaten für alle Hauptstationen.
 * @returns {void}
 */
export function calculateStationsStats(): void {
  Object.keys(systemState.stations || {}).forEach((id) => {
    const st = systemState.stations[id];
    const stationLogs = systemState.logs.filter(
      (log) => !log.cancelled && log.durationMinutes >= 0 && stateFilters.isLogForStation(log, st)
    );

    let avgDuration = 15.0;
    let hasLogs = false;
    if (stationLogs.length > 0) {
      avgDuration = stationLogs.reduce((acc, log) => acc + log.durationMinutes, 0) / stationLogs.length;
      hasLogs = true;
    }

    const remainingGroups = Object.values(systemState.groups || {}).filter(
      (g) => g.active !== false && !(g.completedStations || []).includes(st.id)
    );
    st.stats = {
      avgDuration: parseFloat(avgDuration.toFixed(1)),
      hasLogs,
      g_rem: remainingGroups.length,
      n_subs: Object.values(st.subStations || {}).filter((sub) => !sub.paused || !!sub.currentGroupId).length || 1,
    };
  });
}

/**
 * Prüft, ob eine Gruppe alle aktiven Stationen absolviert hat.
 * @param {Group} group - Die Gruppe.
 * @returns {void}
 */
export function checkAndLogGroupCompletion(group: Group): void {
  if (!group) return;
  const activeMasterIds = allocatorModule.getActiveMasterIds(systemState);
  const completed = group.completedStations || [];
  const isGroupFinished = activeMasterIds.length > 0 && activeMasterIds.every((id) => completed.includes(id));
  const alreadyLogged = systemState.logs.some((l) => l.groupName === group.name && l.durationMinutes === -6 && !l.cancelled);
  if (isGroupFinished && !alreadyLogged) {
    writeSystemLog(group.name, '', -6, 'System-Daemon');
  }
}

/**
 * Macht den Abschluss einer Hauptstation für eine Gruppe rückgängig.
 * @param {Group} group - Die betroffene Gruppe.
 * @param {Station} station - Die freizugebende Hauptstation.
 * @param {string} [originalSubStationId] - ID der Unterstation.
 * @param {string} [examinerName] - Name des Administrators.
 * @returns {boolean} True bei Erfolg.
 */
export function executeRevertCompletion(
  group: Group,
  station: Station,
  originalSubStationId?: string,
  examinerName?: string
): boolean {
  if (!group || !station) return false;
  group.completedStations = (group.completedStations || []).filter((id) => id !== station.id);
  group.lastStatusChange = getUniqueTimestamp();

  const milestoneLog = systemState.logs.find((l) => l.groupName === group.name && l.durationMinutes === -6 && !l.cancelled);
  if (milestoneLog) {
    milestoneLog.cancelled = true;
    if (!systemState.pendingLogCancellations) systemState.pendingLogCancellations = [];
    systemState.pendingLogCancellations.push(milestoneLog.timestamp);
  }
  writeSystemLog(group.name, originalSubStationId || `${station.id}.1`, -7, examinerName || 'Leitstand', { cancelled: false });
  return true;
}

/**
 * Schließt die Prüfung an einer Unterstation ab.
 * @param {Station} master - Die Hauptstation.
 * @param {SubStation} sub - Die Unterstation.
 * @returns {boolean} True bei Erfolg.
 */
export function executeSubStationCompletion(master: Station, sub: SubStation): boolean {
  if (!sub || !sub.currentGroupId) return false;
  const group = systemState.groups[sub.currentGroupId];
  if (!group) return false;

  const duration = sub.startTime ? parseFloat(((Date.now() - sub.startTime) / 60000).toFixed(1)) : 0;

  writeSystemLog(group.name, sub.id, duration, sub.examiner || 'Prüfer');

  if (!group.completedStations) {
    group.completedStations = [];
  }
  if (!group.completedStations.includes(master.id)) {
    group.completedStations.push(master.id);
  }
  group.currentStation = null;
  group.lastStatusChange = getUniqueTimestamp();

  Object.keys(master.subStations).forEach((sId) => {
    if (master.subStations[sId].reservedGroupId === group.id) {
      master.subStations[sId].reservedGroupId = null;
    }
  });
  checkAndLogGroupCompletion(group);

  if (group.paused) {
    group.status = 'paused';
    writeSystemLog(group.name, '', -1, 'System-Daemon');
  } else {
    group.status = 'waiting';
  }

  sub.currentGroupId = null;
  sub.startTime = null;
  if (sub.paused) {
    writeSystemLog('System', sub.id, -3, sub.examiner || 'Prüfer');
  }
  return true;
}

export const dbScheduleSave = (): void => dbModule.scheduleStateSave(DB_PATH, JSON_BACKUP_PATH, systemState, getUniqueTimestamp);

export const dbImmediateSave = async (): Promise<void> => {
  dbModule.clearSaveTimeout();
  try {
    await dbModule.saveStateToStoragePromise(DB_PATH, JSON_BACKUP_PATH, systemState);
    console.log('[System-IO] Physikalischer Speicherzustand nach Reset erzwungen.');
  } catch (e) {
    const error = e as Error;
    console.error('[System-IO] Fehler beim Erzwingen des sofortigen Speicherns:', error.message);
  }
};

export const getBeamerState = (): Record<string, unknown> => stateFilters.getBeamerState(systemState);
export const getFlatExaminerState = (token: string, clientDeviceToken?: string | null) => stateFilters.getFlatExaminerState(systemState, token, clientDeviceToken);
export const getAdminDashboardState = (): Record<string, unknown> => stateFilters.getAdminDashboardState(systemState);
export const getAdminGroupsState = (): Record<string, unknown> => stateFilters.getAdminGroupsState(systemState);
export const getAdminStationsState = (): Record<string, unknown> => stateFilters.getAdminStationsState(systemState);

export const ioBroadcast = (): void => {
  calculateStationsStats();
  socketsModule.broadcastState(
    systemState,
    getBeamerState,
    getFlatExaminerState,
    getAdminDashboardState,
    getAdminGroupsState,
    getAdminStationsState
  );
};

export const allocatorCheck = (): boolean => allocatorModule.checkAndAssignIdleStations(
  systemState,
  getUniqueTimestamp,
  dbScheduleSave,
  ioBroadcast
);

const waitForIoAndExit = (): void => {
  if (dbModule.getIsSaving()) {
    setTimeout(waitForIoAndExit, 100);
  } else {
    dbModule.setSaving(true);
    dbModule.saveStateToStoragePromise(DB_PATH, JSON_BACKUP_PATH, systemState)
      .then(() => { process.exit(0); })
      .catch(() => { process.exit(1); });
  }
};

export const shutdown = (): void => {
  dbModule.clearSaveTimeout();
  waitForIoAndExit();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

socketsModule.init(
  server,
  systemState,
  ADMIN_PASSWORD,
  getAdminSessionToken,
  isValidExaminerToken,
  getBeamerState,
  getFlatExaminerState,
  getAdminDashboardState,
  getAdminGroupsState,
  getAdminStationsState
);
allocatorModule.init({ writeSystemLog });
allocatorModule.startAutoUnpauseDaemon(systemState, getUniqueTimestamp, dbScheduleSave, ioBroadcast);

fileProcessor.init({ systemState, dbDir: DB_DIR, backupDir: BACKUP_DIR, appDir: __dirname, shutdown });

adminController.init({
  systemState,
  getUniqueTimestamp,
  checkAndLogGroupCompletion,
  executeRevertCompletion,
  isLogForStation: stateFilters.isLogForStation,
  commitAndRespond,
  ADMIN_PASSWORD,
  getAdminSessionToken,
  writeSystemLog,
});

adminGroupsController.init({
  systemState,
  getUniqueTimestamp,
  sanitizeName,
  dbImmediateSave,
  ioBroadcast,
  commitAndRespond,
  writeSystemLog,
});

adminStationsController.init({
  systemState,
  getUniqueTimestamp,
  sanitizeName,
  executeSubStationCompletion,
  dbImmediateSave,
  dbScheduleSave,
  ioBroadcast,
  commitAndRespond,
  writeSystemLog,
});

app.use((req: Request, res: Response, next: NextFunction) => {
  res.removeHeader('X-Powered-By');
  res.removeHeader('Content-Security-Policy-Report-Only');
  res.removeHeader('X-Frame-Options');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const reqPath = req.path;
  const isApi = reqPath.startsWith('/api/');
  const isSocket = reqPath.startsWith('/socket.io/');

  // Statische Assets (Bilder, Favicons, Styles, Scripts) anhand der Dateiendung identifizieren
  const isStaticAsset = /\.(png|jpg|jpeg|gif|ico|svg|css|js|json|woff2?|ttf|map|zip|csv|txt)$/i.test(reqPath);

  const isHtml =
    !isStaticAsset &&
    !isApi &&
    !isSocket &&
    (reqPath.endsWith('.html') ||
      reqPath === '/' ||
      (!!req.headers.accept && req.headers.accept.includes('text/html')));

  if (isApi) {
    res.removeHeader('Expires');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
  } else if (isHtml) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com; connect-src 'self' ws: wss: http: https:; img-src 'self' data: blob:;"
    );
  } else {
    // Entferne CSP explizit für alle Bilder, Favicons und Nicht-HTML-Assets
    res.removeHeader('Content-Security-Policy');
  }

  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res: Response, filePath: string) => {
    res.removeHeader('X-Powered-By');
    res.removeHeader('Content-Security-Policy-Report-Only');
    res.removeHeader('X-Frame-Options');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (filePath.toLowerCase().endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      // 1 Jahr Caching & immutable für alle statischen JS-, CSS- & Bild-Assets mit Cache-Busting
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.removeHeader('Content-Security-Policy');
    }
  },
}));

app.use(express.json());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Sicherheits-Sperre: Zu viele API-Anfragen.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', globalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Fehlversuche: IP für 15 Minuten gesperrt.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const adminAuth = (req: Request, res: Response, next: NextFunction): void => {
  const rawAuth = req.headers.authorization;
  const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (authHeader && (authHeader.trim() === ADMIN_PASSWORD || authHeader.trim() === getAdminSessionToken())) {
    next();
  } else {
    res.status(401).json({ error: 'Nicht autorisiert' });
  }
};

app.get('/api/ping', (_req: Request, res: Response) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ status: 'ok' });
});

app.post('/api/examiner/register', authenticateExaminer, (req: AuthenticatedExaminerRequest, res: Response) => {
  const { firstName, lastName } = req.body || {};
  const sub = req.subStation!;

  if (sub.deviceToken) {
    res.status(400).json({ error: 'Station bereits belegt' });
    return;
  }

  const cleanFirst = sanitizeName(firstName, 16);
  const cleanLast = sanitizeName(lastName, 16);
  if (!cleanFirst || !cleanLast) {
    res.status(400).json({ error: 'Name ungültig' });
    return;
  }

  const examinerName = `${cleanLast}, ${cleanFirst}`;
  const deviceToken = crypto.randomBytes(16).toString('hex');

  sub.examiner = examinerName;
  sub.deviceToken = deviceToken;

  writeSystemLog('System', sub.id, -13, examinerName);

  commitAndRespond(res, { success: true, deviceToken, examiner: examinerName });
});

app.post('/api/examiner/deregister', authenticateExaminer, (req: AuthenticatedExaminerRequest, res: Response) => {
  const clientDeviceToken = req.headers['x-device-token'];
  const sub = req.subStation!;

  if (!sub.examiner || sub.deviceToken !== clientDeviceToken) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  sub.examiner = '';
  sub.deviceToken = null;

  writeSystemLog('System', sub.id, -13, 'Abgemeldet');

  commitAndRespond(res);
});

app.get('/api/examiner/status', authenticateExaminer, (req: AuthenticatedExaminerRequest, res: Response) => {
  const clientDeviceToken = req.headers['x-device-token'] as string | undefined;

  const flatState = getFlatExaminerState((req.headers.authorization as string) || '', clientDeviceToken);
  if (!flatState) {
    res.status(500).json({ error: 'Zustands-Fehler' });
    return;
  }

  res.json(flatState);
});

app.post('/api/examiner/complete', authenticateExaminer, (req: AuthenticatedExaminerRequest, res: Response) => {
  const sub = req.subStation!;
  if (!sub.currentGroupId) {
    res.status(400).json({ error: 'Keine Gruppe aktiv' });
    return;
  }
  executeSubStationCompletion(req.masterStation!, sub);
  commitAndRespond(res);
});

app.post('/api/examiner/pause', authenticateExaminer, (req: AuthenticatedExaminerRequest, res: Response) => {
  const { paused } = req.body || {};
  const sub = req.subStation!;
  sub.paused = !!paused;
  if (!sub.currentGroupId) {
    writeSystemLog('System', sub.id, paused ? -3 : -4, sub.examiner || 'Prüfer');
  }
  commitAndRespond(res);
});

app.post('/api/examiner/pause_immediate', authenticateExaminer, (req: AuthenticatedExaminerRequest, res: Response) => {
  const sub = req.subStation!;
  sub.paused = true;
  if (sub.currentGroupId) {
    allocatorModule.releaseGroupFromStation(sub.currentGroupId, systemState, getUniqueTimestamp);
  } else {
    writeSystemLog('System', sub.id, -3, sub.examiner || 'Prüfer');
  }
  commitAndRespond(res);
});

app.post('/api/admin/verify', loginLimiter, adminController.verify);
app.post('/api/admin/verify_token', adminController.verifyToken);

app.post('/api/admin/logs/revert', adminAuth, adminController.revertLog);

app.post('/api/admin/anwaerter/clear', adminAuth, adminGroupsController.clearAnwaerter);
app.post('/api/admin/anwaerter', adminAuth, adminGroupsController.addAnwaerter);
app.post('/api/admin/anwaerter/batch', adminAuth, adminGroupsController.batchAnwaerter);
app.put('/api/admin/anwaerter/:id/toggle_active', adminAuth, adminGroupsController.toggleAnwaerterActive);

app.post('/api/admin/groups', adminAuth, adminGroupsController.createGroup);
app.put('/api/admin/groups/pause_all', adminAuth, adminGroupsController.pauseAllGroups);
app.put('/api/admin/groups/:id/pause', adminAuth, adminGroupsController.pauseGroup);
app.put('/api/admin/groups/:id/toggle_active', adminAuth, adminGroupsController.toggleGroupActive);
app.post('/api/admin/groups/:id/dissolve', adminAuth, adminGroupsController.dissolveGroup);

app.put('/api/admin/toggle_auto_allocation', adminAuth, adminController.toggleAutoAllocation);

app.put('/api/admin/stations/:id/sub_complete', adminAuth, adminStationsController.subComplete);
app.post('/api/admin/corrections/complete', adminAuth, adminController.correctionsComplete);
app.post('/api/admin/corrections/revert', adminAuth, adminController.correctionsRevert);
app.put('/api/admin/stations/:id/sub_release', adminAuth, adminStationsController.subRelease);
app.put('/api/admin/stations/:id/sub_assign', adminAuth, adminStationsController.subAssign);

app.post('/api/admin/stations/clear', adminAuth, adminStationsController.clearStations);
app.post('/api/admin/stations', adminAuth, adminStationsController.createStation);
app.put('/api/admin/stations/:id/sub_config', adminAuth, adminStationsController.subConfig);
app.put('/api/admin/stations/:id', adminAuth, adminStationsController.updateStation);
app.post('/api/admin/stations/batch', adminAuth, adminStationsController.batchStations);

app.get('/api/admin/update/download', adminAuth, fileProcessor.downloadCode);
app.post('/api/admin/update/upload', adminAuth, express.raw({ type: 'application/zip', limit: '50mb' }), fileProcessor.uploadCode);
app.post('/api/admin/restart', adminAuth, (_req: Request, res: Response) => { res.json({ success: true }); setTimeout(() => { shutdown(); }, 1000); });
app.get('/api/admin/export', adminAuth, fileProcessor.exportCsv);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unerwarteter Express-Fehler:', err.stack || err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Interner Server-Fehler' });
  }
});

dbModule.initializeSystem(DB_PATH, JSON_BACKUP_PATH, systemState, getUniqueTimestamp).then(() => {
  calculateStationsStats();
  server.listen(PORT, () => {
    console.log(`Prüfungs-Management-System läuft aktiv auf Port ${PORT}`);
  });
});