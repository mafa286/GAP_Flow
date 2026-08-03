import { Response } from 'express';
import crypto from 'crypto';
import { SystemState, LogEntry, Station } from './types';
import { AuthenticatedExaminerRequest } from '../server';
import * as dbModule from './db';
import * as socketsModule from './sockets';
import * as stateFilters from './state_filters';

/**
 * Konfigurationsobjekt zur Initialisierung des Examiner-Controllers.
 */
export interface ExaminerControllerOptions {
  systemState: SystemState;
  getUniqueTimestamp: () => number;
  sanitizeName: (str: string, maxLength: number) => string;
  executeSubStationCompletion: (master: Station, sub: any) => boolean;
  commitAndRespond: (res: Response, data?: Record<string, unknown>, runAllocator?: boolean) => void;
  writeSystemLog: (
    groupName: string,
    stationId: string,
    durationMinutes: number,
    examiner: string,
    extraProps?: Record<string, unknown>
  ) => LogEntry | null;
  sendWebPushNotification: (roleTarget: string, payload: any, targetSubId?: string) => Promise<void>;
}

let systemState: SystemState;
let sanitizeName: (str: string, maxLength: number) => string = (str) => str;
let executeSubStationCompletion: (master: Station, sub: any) => boolean = () => false;
let commitAndRespond: (res: Response, data?: Record<string, unknown>, runAllocator?: boolean) => void = (
  res,
  data = { success: true }
) => res.json(data);
let writeSystemLog: (
  groupName: string,
  stationId: string,
  durationMinutes: number,
  examiner: string,
  extraProps?: Record<string, unknown>
) => LogEntry | null = () => null;
let sendWebPushNotification: (roleTarget: string, payload: any, targetSubId?: string) => Promise<void> = async () => {};

/**
 * Initialisiert den Examiner-Controller mit den benötigten Abhängigkeiten.
 * @param {ExaminerControllerOptions} options - Konfigurationsobjekt.
 * @returns {void}
 */
export function init(options: ExaminerControllerOptions): void {
  systemState = options.systemState;
  sanitizeName = options.sanitizeName;
  executeSubStationCompletion = options.executeSubStationCompletion;
  commitAndRespond = options.commitAndRespond;
  writeSystemLog = options.writeSystemLog;
  sendWebPushNotification = options.sendWebPushNotification;
}

/**
 * Speichert eine Web-Push Subscription des Prüfer-Smartphones.
 * @param {AuthenticatedExaminerRequest} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function pushSubscription(req: AuthenticatedExaminerRequest, res: Response): void {
  const { subscription, role, targetId, os } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    res.status(400).json({ error: 'Ungültige Subscription' });
    return;
  }

  const db = dbModule.getDb();
  if (db && !dbModule.getUseJsonFallback()) {
    const id = crypto.createHash('sha256').update(subscription.endpoint).digest('hex').substring(0, 16);
    const subTargetId = targetId || req.subStation?.id || '';

    const doInsert = () => {
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
    };

    if (subTargetId) {
      db.run('DELETE FROM push_subscriptions WHERE targetId = ?', [subTargetId], (err) => {
        if (err) {
          console.error('[Push DB Fehler beim Löschen alter Subscriptions]', err.message);
        }
        doInsert();
      });
    } else {
      doInsert();
    }
    if (req.subStation) {
      req.subStation.hasPushSub = true;
    }
  } else {
    res.json({ success: true });
  }
}

/**
 * Registriert einen neuen Prüfer an einer Unterstation und verknüpft ein fälschungssicheres Geräte-Token.
 * @param {AuthenticatedExaminerRequest} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function registerExaminer(req: AuthenticatedExaminerRequest, res: Response): void {
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
}

/**
 * Meldet den aktuellen Prüfer von der Unterstation ab und gibt die Station frei.
 * @param {AuthenticatedExaminerRequest} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function deregisterExaminer(req: AuthenticatedExaminerRequest, res: Response): void {
  const clientDeviceToken = req.headers['x-device-token'];
  const sub = req.subStation!;

  if (!sub.examiner || sub.deviceToken !== clientDeviceToken) {
    res.status(403).json({ error: 'Nicht autorisiert' });
    return;
  }

  const db = dbModule.getDb();
  if (db && !dbModule.getUseJsonFallback()) {
    db.run('DELETE FROM push_subscriptions WHERE targetId = ?', [sub.id], (err) => {
      if (err) {
        console.error('[Push DB Fehler beim Löschen abgemeldeter Subscription]', err.message);
      }
    });
  }

  sub.examiner = '';
  sub.deviceToken = null;
  sub.paused = true;
  sub.hasPushSub = false;

  writeSystemLog('System', sub.id, -13, 'Abgemeldet');

  commitAndRespond(res);
}

/**
 * Abfrage des aktuellen Stationsstatus für das Prüfer-Panel.
 * @param {AuthenticatedExaminerRequest} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function getStatus(req: AuthenticatedExaminerRequest, res: Response): void {
  const clientDeviceToken = req.headers['x-device-token'] as string | undefined;

  const flatState = stateFilters.getFlatExaminerState(systemState, (req.headers.authorization as string) || '', clientDeviceToken);
  if (!flatState) {
    res.status(500).json({ error: 'Zustands-Fehler' });
    return;
  }

  res.json(flatState);
}

/**
 * Sendet eine Test-Benachrichtigung per Web Push an das Gerät des Prüfers.
 * @param {AuthenticatedExaminerRequest} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {Promise<void>}
 */
export async function testPush(req: AuthenticatedExaminerRequest, res: Response): Promise<void> {
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
}

/**
 * Empfängt die Empfangsbestätigung (ACK) des Service Workers und benachrichtigt den Leitstand.
 * @param {AuthenticatedExaminerRequest} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function pushAck(req: AuthenticatedExaminerRequest, res: Response): void {
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
    ioInstance
      .to(['room_admin_dashboard', 'room_admin_stations', 'room_admin_groups', 'room_admin_settings'])
      .emit('pushAckReceived', ackData);
  }

  res.json({ success: true });
}

/**
 * Schließt die aktuelle Prüfung an einer Unterstation ab.
 * @param {AuthenticatedExaminerRequest} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function completeExam(req: AuthenticatedExaminerRequest, res: Response): void {
  const sub = req.subStation!;
  if (!sub.currentGroupId) {
    res.status(400).json({ error: 'Keine Gruppe aktiv' });
    return;
  }
  executeSubStationCompletion(req.masterStation!, sub);
  commitAndRespond(res);
}

/**
 * Schaltet den Pausenmodus einer Unterstation um.
 * @param {AuthenticatedExaminerRequest} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function pauseStation(req: AuthenticatedExaminerRequest, res: Response): void {
  const { paused } = req.body || {};
  const sub = req.subStation!;
  sub.paused = !!paused;
  if (sub.paused) {
    sub.pausedAt = Date.now();
  } else {
    sub.pausedAt = undefined;
    sub.pauseDurationMinutes = undefined;
  }
  if (!sub.currentGroupId) {
    writeSystemLog('System', sub.id, paused ? -3 : -4, sub.examiner || 'Prüfer');
  }
  commitAndRespond(res);
}
