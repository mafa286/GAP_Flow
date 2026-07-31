import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import webpush from 'web-push';

import { SystemState, Station, SubStation, Group, LogEntry } from './lib/types';
import * as dbModule from './lib/db';
import * as allocatorModule from './lib/allocator';
import * as socketsModule from './lib/sockets';
import * as fileProcessor from './lib/file_processor';
import * as adminController from './lib/admin_controller';
import * as adminGroupsController from './lib/admin_groups_controller';
import * as adminStationsController from './lib/admin_stations_controller';
import * as stateFilters from './lib/state_filters';
import * as notificationCore from './lib/notifications/core';

/**
 * Erweitertes Express Request-Interface für authentifizierte Prüfer-Anfragen.
 */
export interface AuthenticatedExaminerRequest extends Request {
  subStation?: SubStation;
  masterStation?: Station;
}

// Standardisierte HTTP Express Middleware (Bypass für Node.js Native Core Response Prototypen)
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
  settings: {
    phoneLeitstelleName: '',
    phoneLeitstelleNumber: '',
    phonePruefungsleitungName: '',
    phonePruefungsleitungNumber: '',
  },
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
 * Bereinigt und validiert Telefonnummern nach striktem Schema (optionales '+' am Anfang, gefolgt von Ziffern).
 * Entfernt alle Leerzeichen, Buchstaben und Sonderzeichen.
 * @param {string} str - Die zu bereinigende Telefonnummer.
 * @param {number} maxLength - Die maximale zulässige Länge.
 * @returns {string} Bereinigte Telefonnummer (z. B. +491701234567 oder 01701234567).
 */
export function sanitizePhoneNumber(str: string, maxLength: number): string {
  if (typeof str !== 'string') return '';
  let cleaned = str.trim().substring(0, maxLength);
  const startsWithPlus = cleaned.startsWith('+');
  cleaned = cleaned.replace(/[^0-9]/g, '');
  return startsWithPlus ? `+${cleaned}` : cleaned;
}

/**
 * Bereinigt Kontakt-Namen und erlaubt ausschließlich namenstypische Zeichen (Buchstaben, Zahlen, Leerzeichen, Komma, Bindestrich, Schrägstrich).
 * @param {string} str - Der zu bereinigende Name.
 * @param {number} maxLength - Die maximale zulässige Länge.
 * @returns {string} Bereinigter Name.
 */
export function sanitizeContactName(str: string, maxLength: number): string {
  if (typeof str !== 'string') return '';
  let cleaned = str.trim().substring(0, maxLength);
  cleaned = cleaned.replace(/[^a-zA-Z0-9\s,\-/äöüÄÖÜßéèàáíóúÉÈÀÁÍÓÚ]/g, '');
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

    let avgDuration = st.targetAvgDuration || 15.0;
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
      n_subs: Object.values(st.subStations || {}).filter((sub) => sub.active !== false).length || 1,
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

  const remainingGroupsForMaster = Object.values(systemState.groups || {}).filter(
    (g) => g.active !== false && !(g.completedStations || []).includes(master.id)
  );

  if (remainingGroupsForMaster.length === 0) {
    sub.paused = true;
  }

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

export const allocatorCheck = (): boolean => {
  const allocationOccurred = allocatorModule.checkAndAssignIdleStations(
    systemState,
    getUniqueTimestamp,
    dbScheduleSave,
    ioBroadcast
  );

  if (allocationOccurred) {
    // Sende Zuteilungs-Push mit Anwärternamen an zugewiesene Stationen via Web Push API
    Object.values(systemState.stations || {}).forEach((master) => {
      if (!master || !master.subStations) return;
      Object.values(master.subStations).forEach((sub) => {
        if (sub.currentGroupId && sub.startTime && (Date.now() - sub.startTime) < 2000) {
          const group = systemState.groups[sub.currentGroupId];
          if (group) {
            const memberNames = allocatorModule.getGroupMemberNames(group.id, systemState);
            const memberListStr = memberNames.length > 0 ? `\n${memberNames.join('\n')}` : '';

            const payload = {
              type: `allocation-${sub.id}`,
              tag: `allocation-${sub.id}`,
              title: '📥 Prüfungsleitstand: Neue Zuteilung!',
              body: `Gruppe ${group.name} wurde der Station ${sub.id} zugewiesen!${memberListStr}`,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              url: '/pruefer.html',
              vibrate: [300, 100, 300, 100, 300],
              timestamp: Date.now(),
            };

            sendWebPushNotification('examiner', payload, sub.id);
          }
        }
      });
    });
  }

  return allocationOccurred;
};

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
allocatorModule.startAutoUnpauseDaemon(systemState, dbScheduleSave, ioBroadcast);

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

// Dynamisches Auslesen der zentralen Version aus package.json
let appVersion = '1.0';
try {
  const pkgPath = path.join(__dirname, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    appVersion = pkg.version || '1.0';
  }
} catch (_) {}

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
    const fileToServe = reqPath === '/' ? 'monitor.html' : reqPath.replace(/^\//, '');
    const fullHtmlPath = path.join(__dirname, 'public', fileToServe);

    if (fs.existsSync(fullHtmlPath) && fs.statSync(fullHtmlPath).isFile()) {
      let html = fs.readFileSync(fullHtmlPath, 'utf8');

      // 1. Injiziere globale GAP_FLOW_VERSION Variable in <head>
      const versionScript = `<script>window.GAP_FLOW_VERSION="${appVersion}";</script>`;
      if (html.includes('</head>')) {
        html = html.replace('</head>', `${versionScript}\n</head>`);
      }

      // 2. Ersetze oder hänge ?v=${appVersion} an alle .js Skripte dynamisch an
      html = html.replace(/src="(\/js\/[^"]+?)(?:\?v=[^"]*)?"/g, `src="$1?v=${appVersion}"`);
      html = html.replace(/href="(\/css\/[^"]+?)(?:\?v=[^"]*)?"/g, `href="$1?v=${appVersion}"`);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com; connect-src 'self' ws: wss: http: https: https://*.googleapis.com https://fcm.googleapis.com; img-src 'self' data: blob:;"
      );
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.send(html);
      return;
    }
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
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com; connect-src 'self' ws: wss: http: https: https://*.googleapis.com https://fcm.googleapis.com; img-src 'self' data: blob:;"
    );

    const lowerPath = filePath.toLowerCase();
    if (lowerPath.endsWith('.html') || lowerPath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      // 1 Jahr Caching & immutable für rein statische Bilder & Schriftarten
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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

/**
 * Delegiert VAPID Key Initialisierung an das Benachrichtigungs-Modul.
 */
function initVapidKeys(): Promise<void> {
  return notificationCore.initVapidKeys();
}

/**
 * Sendet eine W3C Web Push Benachrichtigung über das modulare Notification-Core System.
 */
export async function sendWebPushNotification(
  roleTarget: string,
  payload: any,
  targetSubId?: string
): Promise<void> {
  return notificationCore.sendNotification(roleTarget, payload, targetSubId);
}

app.get('/api/ping', (_req: Request, res: Response) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ status: 'ok' });
});

app.get('/api/push/vapid-public-key', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ publicKey: notificationCore.getVapidPublicKey() });
});

app.post('/api/examiner/push-subscription', authenticateExaminer, (req: AuthenticatedExaminerRequest, res: Response) => {
  const { subscription, role, targetId, os } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    res.status(400).json({ error: 'Ungültige Subscription' });
    return;
  }

  const db = dbModule.getDb();
  if (db && !dbModule.getUseJsonFallback()) {
    const id = crypto.createHash('sha256').update(subscription.endpoint).digest('hex').substring(0, 16);
    const subTargetId = targetId || req.subStation?.id || '';

    // Altdaten-Bereinigung: Veraltete Subscriptions der gleichen Unterstation löschen,
    // um Doppel-Push Kollisionen auf dem Smartphone zu verhindern
    if (subTargetId) {
      db.run('DELETE FROM push_subscriptions WHERE targetId = ?', [subTargetId]);
    }

    db.run(
      'INSERT OR REPLACE INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, role, targetId, os, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        role || 'examiner',
        subTargetId,
        os || 'android',
        Date.now(),
      ],
      (err) => {
        if (err) {
          res.status(500).json({ error: 'Speicherfehler' });
        } else {
          res.json({ success: true });
        }
      }
    );
  } else {
    res.json({ success: true });
  }
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
  sub.paused = true;

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

app.post('/api/examiner/test-push', authenticateExaminer, async (req: AuthenticatedExaminerRequest, res: Response) => {
  const sub = req.subStation!;
  const payload = {
    type: `test-push-${sub.id}`,
    tag: `test-push-${sub.id}`,
    title: '🧪 Server Web Push Test',
    body: `Echter Server Web Push an Station ${sub.id} (${sub.examiner || 'Prüfer'}) via Google API zugestellt!`,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: '/pruefer.html',
    vibrate: [300, 100, 300, 100, 300],
    timestamp: Date.now(),
  };

  await sendWebPushNotification('examiner', payload, sub.id);
  res.json({ success: true });
});

app.post('/api/examiner/push-ack', (req: Request, res: Response) => {
  const { tag, subId, os } = req.body || {};
  console.log(`[WebPush ACK Empfangen] Service Worker auf dem Smartphone (${os || 'Gerät'}) hat Push-Tag "${tag || 'unbekannt'}" an Station ${subId || 'alle'} erfolgreich empfangen!`);

  const ackData = {
    tag: String(tag || ''),
    subId: String(subId || ''),
    os: String(os || 'android'),
    timestamp: Date.now(),
  };

  const ioInstance = socketsModule.getIo();
  if (ioInstance) {
    ioInstance.to('room_admin_dashboard').emit('pushAckReceived', ackData);
    ioInstance.to('room_admin_stations').emit('pushAckReceived', ackData);
    ioInstance.to('room_admin_groups').emit('pushAckReceived', ackData);
    ioInstance.to('room_admin_settings').emit('pushAckReceived', ackData);
  }

  res.json({ success: true });
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

app.get('/api/admin/dashboard/status', adminAuth, (_req: Request, res: Response) => {
  res.json(getAdminDashboardState());
});

app.get('/api/admin/groups/status', adminAuth, (_req: Request, res: Response) => {
  res.json(getAdminGroupsState());
});

app.get('/api/admin/stations/status', adminAuth, (_req: Request, res: Response) => {
  res.json(getAdminStationsState());
});

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

app.post('/api/admin/settings', adminAuth, (req: Request, res: Response) => {
  const { settings } = req.body || {};
  if (settings && typeof settings === 'object') {
    if (!systemState.settings) {
      systemState.settings = {
        phoneLeitstelleName: '',
        phoneLeitstelleNumber: '',
        phonePruefungsleitungName: '',
        phonePruefungsleitungNumber: '',
      };
    }
    systemState.settings.phoneLeitstelleName = sanitizeContactName(settings.phoneLeitstelleName || '', 32);
    systemState.settings.phoneLeitstelleNumber = sanitizePhoneNumber(settings.phoneLeitstelleNumber || '', 24);
    systemState.settings.phonePruefungsleitungName = sanitizeContactName(settings.phonePruefungsleitungName || '', 32);
    systemState.settings.phonePruefungsleitungNumber = sanitizePhoneNumber(settings.phonePruefungsleitungNumber || '', 24);
    commitAndRespond(res, { success: true, settings: systemState.settings });
  } else {
    res.status(400).json({ error: 'Ungültige Einstellungen' });
  }
});

app.get('/api/admin/push-stations', adminAuth, async (_req: Request, res: Response) => {
  const db = dbModule.getDb();
  const registeredStationIds = new Set<string>();

  if (db && !dbModule.getUseJsonFallback()) {
    try {
      const rows = await new Promise<Array<{ targetId: string }>>((resolve) => {
        db.all("SELECT DISTINCT targetId FROM push_subscriptions WHERE targetId IS NOT NULL AND targetId != ''", [], (err, resultRows) => {
          if (err || !resultRows) resolve([]);
          else resolve(resultRows as Array<{ targetId: string }>);
        });
      });
      rows.forEach((r) => {
        if (r.targetId) registeredStationIds.add(r.targetId);
      });
    } catch (_) {}
  }

  const stationList: Array<{ id: string; label: string; examiner: string; hasPushSub: boolean }> = [];

  Object.values(systemState.stations || {}).forEach((master) => {
    if (master && master.subStations) {
      Object.values(master.subStations).forEach((sub) => {
        const hasPush = registeredStationIds.has(sub.id);
        if (!hasPush) return;

        const examinerName = sub.examiner || '';
        let label = `Station ${sub.id}`;
        if (master.name && master.name !== `Station ${sub.parentId}`) {
          label += ` (${master.name})`;
        }
        if (examinerName) {
          label += ` – Prüfer: ${examinerName}`;
        }

        stationList.push({
          id: sub.id,
          label,
          examiner: examinerName,
          hasPushSub: true,
        });
      });
    }
  });

  stationList.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  res.json({ success: true, stations: stationList });
});

app.post('/api/admin/notify', adminAuth, (req: Request, res: Response) => {
  const { type, tag, title, body, vibrate, targetSubId } = req.body || {};
  const cleanTargetSubId = targetSubId && targetSubId !== 'all' ? String(targetSubId).trim() : undefined;

  const notificationPayload = {
    type: type || 'broadcast',
    tag: tag || type || 'broadcast',
    subId: cleanTargetSubId || '',
    title: String(title || 'Mitteilung der Prüfungsleitung').trim().substring(0, 100),
    body: String(body || '').trim().substring(0, 500),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: '/pruefer.html',
    vibrate: Array.isArray(vibrate) ? vibrate : [300, 100, 300],
    timestamp: getUniqueTimestamp(),
    data: {
      subId: cleanTargetSubId || '',
    },
  };

  sendWebPushNotification('all', notificationPayload, cleanTargetSubId);
  res.json({ success: true });
});

app.post('/api/admin/stations/clear', adminAuth, adminStationsController.clearStations);
app.post('/api/admin/stations', adminAuth, adminStationsController.createStation);
app.put('/api/admin/stations/:id/sub_config', adminAuth, adminStationsController.subConfig);
app.put('/api/admin/stations/:id', adminAuth, adminStationsController.updateStation);
app.post('/api/admin/stations/batch', adminAuth, adminStationsController.batchStations);

app.get('/api/admin/system/repomix', adminAuth, fileProcessor.generateAndDownloadRepomix);
app.get('/api/admin/system/logs', adminAuth, adminController.getSystemLogs);

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

/**
 * Automatisierter Hintergrund-Daemon für Inaktivitäts-, Richtzeit- & Prüfungsende-Erinnerungen.
 */
function startNotificationDaemon(): void {
  setInterval(() => {
    if (!systemState) return;

    try {
      // 1. Scanne Inaktivitäten & Richtzeit-Überschreitungen
      const reminders = allocatorModule.scanReminderEvents(systemState);

      // Inaktivitäts-Pushs (30 Min / +10 Min) via Web Push & WebSockets
      reminders.inactives.forEach((inactive) => {
        const payload = {
          type: `inactivity-${inactive.subId}`,
          tag: `inactivity-${inactive.subId}`,
          title: 'Prüfungsleitstand: Inaktivitäts-Erinnerung',
          body: `Station ${inactive.subId} seit ${inactive.pausedMinutes} Min. pausiert. Bist du bereit für die nächste Gruppe?`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          url: '/pruefer.html',
          vibrate: [200, 100, 200],
          actions: [{ action: 'end_pause', title: '▶️ Pause beenden' }],
          timestamp: Date.now(),
        };
        sendWebPushNotification('examiner', payload, inactive.subId);
      });

      // Richtzeit-Überschreitungs-Pushs (+10 Min über Durchschnitt) via Web Push & WebSockets
      reminders.overtimes.forEach((ot) => {
        const payload = {
          type: `overtime-${ot.subId}`,
          tag: `overtime-${ot.subId}`,
          title: '⏱️ Richtzeit-Hinweis',
          body: `Gruppe ${ot.groupName} seit ${ot.overtimeMinutes} Min. über Durchschnitt in der Prüfung!`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          url: '/pruefer.html',
          vibrate: [200, 100, 200],
          actions: [{ action: 'deactivate', title: '⚙ deaktivieren?' }],
          timestamp: Date.now(),
        };
        sendWebPushNotification('examiner', payload, ot.subId);
      });

      // 2. Automatisches Gesamt-Prüfungsende via Web Push & WebSockets
      const activeMasterIds = allocatorModule.getActiveMasterIds(systemState);
      const activeGroups = Object.values(systemState.groups || {}).filter((g) => g.active !== false);

      if (
        activeMasterIds.length > 0 &&
        activeGroups.length > 0 &&
        activeGroups.every((g) => activeMasterIds.every((mId) => (g.completedStations || []).includes(mId)))
      ) {
        if (!systemState.isCleared && !systemState._examFinishedNotificationSent) {
          systemState._examFinishedNotificationSent = true;
          const payload = {
            type: 'exam-finished',
            tag: 'exam-finished',
            title: '🏆 PRÜFUNGEN BEENDET!',
            body: 'Alle Gruppen haben sämtliche Stationen absolviert.',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            url: '/pruefer.html',
            vibrate: [300, 100, 300, 100, 300, 100, 600],
            timestamp: Date.now(),
          };
          sendWebPushNotification('all', payload);
        }
      }
    } catch (err) {
      console.error('[Notification Daemon] Fehler im Erinnerungslauf:', err);
    }
  }, 60000);
}

dbModule.initializeSystem(DB_PATH, JSON_BACKUP_PATH, systemState, getUniqueTimestamp).then(async () => {
  calculateStationsStats();
  startNotificationDaemon();
  await initVapidKeys();
  server.listen(PORT, () => {
    console.log(`Prüfungs-Management-System läuft aktiv auf Port ${PORT}`);
    fileProcessor.createAutoBackupZip();
  });
});
