import { Request, Response } from 'express';
import { SystemState, Station, SubStation, LogEntry, resetSystemState } from './types';
import * as allocatorModule from './allocator';

/**
 * Trefferobjekt bei der Suche nach Station und Unterstation.
 */
export interface StationAndSubMatch {
  station: Station | null;
  subStation: SubStation | null;
}

/**
 * Konfigurationsobjekt zur Initialisierung des Controllers.
 */
export interface AdminStationsControllerOptions {
  systemState: SystemState;
  getUniqueTimestamp: () => number;
  sanitizeName: (str: string, maxLength: number) => string;
  executeSubStationCompletion: (master: Station, sub: SubStation) => boolean;
  dbImmediateSave: () => Promise<void>;
  dbScheduleSave: () => void;
  ioBroadcast: () => void;
  commitAndRespond: (res: Response, data?: Record<string, unknown>, runAllocator?: boolean) => void;
  writeSystemLog: (
    groupName: string,
    stationId: string,
    durationMinutes: number,
    examiner: string,
    extraProps?: Record<string, unknown>
  ) => LogEntry | null;
}

let systemState: SystemState;
let getUniqueTimestamp: () => number = () => Date.now();
let sanitizeName: (str: string, maxLength: number) => string = (str) => str;
let executeSubStationCompletion: (master: Station, sub: SubStation) => boolean = () => false;
let dbImmediateSave: () => Promise<void> = async () => {};
let dbScheduleSave: () => void = () => {};
let ioBroadcast: () => void = () => {};
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

/**
 * Ermittelt eine Hauptstation sowie die zugehörige Unterstation anhand der IDs mit Fehlerprüfung.
 * @param {string} stationId - Die ID der gesuchten Hauptstation (Master-Station).
 * @param {string} subId - Die ID der gesuchten Unterstation.
 * @returns {StationAndSubMatch} Objekt mit Station und Unterstation.
 */
export function getStationAndSubOrNull(stationId: string, subId: string): StationAndSubMatch {
  const station = systemState.stations[stationId];
  if (!station) return { station: null, subStation: null };
  const sub = station.subStations[subId];
  return { station, subStation: sub || null };
}

/**
 * Bereinigt und formatiert den Stationsnamen einheitlich.
 * @param {string} id - Die ID der Station (z.B. "1").
 * @param {string} name - Der einzutragende Name.
 * @returns {string | null} Der standardisierte Name oder null bei ungültigem Inhalt.
 */
export function standardizeStationName(id: string, name: string): string | null {
  const cleanInput = sanitizeName(name, 24);
  if (!cleanInput) return null;
  let displayName = cleanInput;
  if (!displayName.startsWith(`${id} -`)) {
    displayName = `${id} - ${displayName}`;
  }
  return displayName.substring(0, 24);
}

/**
 * Initialisiert den Admin-Stations-Controller mit den benötigten Abhängigkeiten.
 * @param {AdminStationsControllerOptions} options - Konfigurationsobjekt.
 * @returns {void}
 */
export function init(options: AdminStationsControllerOptions): void {
  systemState = options.systemState;
  getUniqueTimestamp = options.getUniqueTimestamp;
  sanitizeName = options.sanitizeName;
  executeSubStationCompletion = options.executeSubStationCompletion;
  dbImmediateSave = options.dbImmediateSave;
  dbScheduleSave = options.dbScheduleSave;
  ioBroadcast = options.ioBroadcast;
  commitAndRespond = options.commitAndRespond;
  writeSystemLog = options.writeSystemLog;
}

/**
 * Löscht alle registrierten Stationen vollständig und erzwingt das sofortige Speichern.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {Promise<void>}
 */
export async function clearStations(req: Request, res: Response): Promise<void> {
  try {
    resetSystemState(systemState);
    systemState.stations = {};

    Object.values(systemState.groups || {}).forEach((group) => {
      group.completedStations = [];
      group.currentStation = null;
      if (group.status !== 'paused') {
        group.status = 'waiting';
      }
      group.lastStatusChange = getUniqueTimestamp();
    });

    await dbImmediateSave();
    ioBroadcast();
    res.json({ success: true });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Erstellt eine neue Hauptstation mit einer initialen, pausierten Standard-Unterstation.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function createStation(req: Request, res: Response): void {
  try {
    const { name } = req.body || {};
    if (!name) {
      res.status(400).json({ error: 'Fehlt' });
      return;
    }

    let maxId = 0;
    Object.keys(systemState.stations || {}).forEach((sId) => {
      const parsed = parseInt(sId, 10);
      if (!Number.isNaN(parsed) && parsed > maxId) {
        maxId = parsed;
      }
    });
    const nextId = (maxId + 1).toString();

    const displayName = standardizeStationName(nextId, name);
    if (!displayName) {
      res.status(400).json({ error: 'Ungültiger oder blockierter Stationsname' });
      return;
    }

    const exists = Object.values(systemState.stations || {}).some(
      (s) => s.name.toLowerCase() === displayName.toLowerCase()
    );
    if (exists) {
      res.status(400).json({ error: 'Eine Station mit diesem Namen existiert bereits.' });
      return;
    }

    const subId = `${nextId}.1`;
    systemState.stations[nextId] = {
      id: nextId,
      name: displayName,
      active: true,
      multiplier: 1,
      subStations: {
        [subId]: {
          id: subId,
          parentId: nextId,
          examiner: `Prüfer ${nextId}.1`,
          paused: true,
          currentGroupId: null,
          token: subId,
          startTime: null,
        },
      },
    };

    dbScheduleSave();
    ioBroadcast();
    res.json({ success: true, station: systemState.stations[nextId] });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Passt die Detailkonfiguration einer spezifischen Unterstation an.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function subConfig(req: Request, res: Response): void {
  const { id } = req.params;
  const { subId, examiner, active, paused, reservedGroupId, deviceToken } = req.body || {};
  const { station, subStation: sub } = getStationAndSubOrNull(id, subId);
  if (!station || !sub) {
    res.status(404).json({ error: 'Fehlt' });
    return;
  }

  if (examiner !== undefined) {
    const cleanExaminer = sanitizeName(examiner, 32);
    if (cleanExaminer !== sub.examiner) {
      sub.examiner = cleanExaminer;
      sub.paused = true;
      if (!cleanExaminer) {
        sub.deviceToken = null;
        if (sub.currentGroupId) {
          allocatorModule.releaseGroupFromStation(sub.currentGroupId, systemState, getUniqueTimestamp);
        }
      }
      writeSystemLog('System', subId, -13, cleanExaminer || 'Prüfer entfernt');
    }
  }

  if (deviceToken !== undefined) {
    sub.deviceToken = deviceToken;
    if (deviceToken === null) {
      sub.paused = true;
    }
  }

  if (active !== undefined) {
    const targetActive = !!active;
    if (sub.active !== targetActive) {
      if (!targetActive) {
        if (!sub.paused || sub.currentGroupId) {
          res.status(400).json({ error: 'Gesperrt' });
          return;
        }
      } else {
        sub.paused = true;
      }
      sub.active = targetActive;
    }
  }

  if (paused !== undefined) {
    sub.paused = !!paused;
  }

  if (reservedGroupId !== undefined) {
    sub.reservedGroupId = reservedGroupId || null;
  }

  commitAndRespond(res, { success: true, subStation: sub });
}

/**
 * Aktualisiert die Gesamtkonfiguration einer Hauptstation (Skalierung der Unterstationen).
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function updateStation(req: Request, res: Response): void {
  const { id } = req.params;
  const { active, multiplier, subExaminers } = req.body || {};
  const station = systemState.stations[id];

  if (!station) {
    res.status(404).json({ error: 'Fehlt' });
    return;
  }

  if (active !== undefined) station.active = active;

  if (multiplier !== undefined && multiplier >= 1 && multiplier <= 5) {
    const currentSubsCount = Object.keys(station.subStations || {}).length;

    if (multiplier > currentSubsCount) {
      station.multiplier = multiplier;
      for (let i = 1; i <= multiplier; i += 1) {
        const subId = `${id}.${i}`;
        if (!station.subStations[subId]) {
          station.subStations[subId] = {
            id: subId,
            parentId: id,
            examiner: `Prüfer ${subId}`,
            paused: true,
            currentGroupId: null,
            token: subId,
            startTime: null,
          };
        }
      }
    }
  }

  if (subExaminers) {
    const entries = Object.entries(subExaminers) as [string, string][];
    entries.forEach(([subId, name]) => {
      if (station.subStations[subId]) {
        const cleanName = sanitizeName(name, 32);
        if (cleanName) {
          station.subStations[subId].examiner = cleanName;
        }
      }
    });
  }

  commitAndRespond(res);
}

/**
 * Importiert eine Liste von Haupt- und Unterstationen im Batch-Verfahren.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {Promise<void>}
 */
export async function batchStations(req: Request, res: Response): Promise<void> {
  const { stations } = req.body || {};
  if (!stations || !Array.isArray(stations)) {
    res.status(400).json({ error: 'Ungültig' });
    return;
  }

  resetSystemState(systemState);
  systemState.stations = {};

  Object.values(systemState.groups || {}).forEach((group) => {
    group.completedStations = [];
    group.currentStation = null;
    if (group.status !== 'paused') {
      group.status = 'waiting';
    }
    group.lastStatusChange = getUniqueTimestamp();
  });

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  let duplicatesIgnored = 0;

  stations.forEach((st: Record<string, unknown>) => {
    if (!st || typeof st !== 'object' || Array.isArray(st)) return;
    if (st.id === undefined || st.id === null || st.name === undefined || st.name === null) return;

    const rawId = sanitizeName(String(st.id), 5);
    if (!rawId || rawId === '__proto__' || rawId === 'constructor' || rawId === 'prototype') return;

    const displayName = standardizeStationName(rawId, String(st.name));
    if (!displayName) return;

    if (seenIds.has(rawId) || seenNames.has(displayName.toLowerCase())) {
      duplicatesIgnored += 1;
      return;
    }
    seenIds.add(rawId);
    seenNames.add(displayName.toLowerCase());

    const rawMultiplier = parseInt(String(st.multiplier), 10);
    const multiplier = (!Number.isNaN(rawMultiplier) && rawMultiplier >= 1 && rawMultiplier <= 5) ? rawMultiplier : 1;

    const rawTargetAvg = parseFloat(String(st.targetAvgDuration || st.avgDuration || 15));
    const targetAvgDuration = (!Number.isNaN(rawTargetAvg) && rawTargetAvg > 0) ? parseFloat(rawTargetAvg.toFixed(1)) : 15.0;

    systemState.stations[rawId] = {
      id: rawId,
      name: displayName,
      active: !!st.active,
      multiplier,
      targetAvgDuration,
      subStations: {},
    };

    if (st.subStations && typeof st.subStations === 'object' && !Array.isArray(st.subStations) && Object.prototype.hasOwnProperty.call(st, 'subStations')) {
      const subMap = st.subStations as Record<string, Record<string, unknown>>;
      const subKeys = Object.keys(subMap);
      subKeys.forEach((subId) => {
        const cleanSubId = String(subId).trim();
        if (!cleanSubId || cleanSubId === '__proto__' || cleanSubId === 'constructor' || cleanSubId === 'prototype') return;

        const sub = subMap[cleanSubId];
        if (!sub || typeof sub !== 'object' || Array.isArray(sub)) return;

        const examiner = sanitizeName(sub.examiner ? String(sub.examiner) : `Prüfer ${cleanSubId}`, 32);
        const token = sub.token ? String(sub.token).trim() : cleanSubId;

        systemState.stations[rawId].subStations[cleanSubId] = {
          id: cleanSubId,
          parentId: rawId,
          examiner,
          paused: true,
          currentGroupId: null,
          token,
          startTime: null,
          active: true,
        };
      });
    }

    if (Object.keys(systemState.stations[rawId].subStations).length === 0) {
      const fallbackSubId = `${rawId}.1`;
      systemState.stations[rawId].subStations[fallbackSubId] = {
        id: fallbackSubId,
        parentId: rawId,
        examiner: `Prüfer ${fallbackSubId}`,
        paused: true,
        currentGroupId: null,
        token: fallbackSubId,
        startTime: null,
        active: true,
      };
      systemState.stations[rawId].multiplier = 1;
    }
  });

  await dbImmediateSave();
  ioBroadcast();
  res.json({ success: true, count: Object.keys(systemState.stations).length, duplicatesIgnored });
}

/**
 * Schließt die Prüfung einer Unterstation administrativ über den Leitstand ab.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function subComplete(req: Request, res: Response): void {
  const { id } = req.params;
  const { subId } = req.body || {};
  const { station, subStation: sub } = getStationAndSubOrNull(id, subId);

  if (!station || !sub) {
    res.status(404).json({ error: 'Fehlt' });
    return;
  }
  if (!sub.currentGroupId) {
    res.status(400).json({ error: 'Keine Gruppe aktiv' });
    return;
  }

  executeSubStationCompletion(station, sub);

  commitAndRespond(res, { success: true, subStation: sub });
}

/**
 * Zieht eine Gruppe manuell von ihrer zugewiesenen Unterstation ab (Freigabe).
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function subRelease(req: Request, res: Response): void {
  const { id } = req.params;
  const { subId } = req.body || {};
  const { station, subStation: sub } = getStationAndSubOrNull(id, subId);

  if (!station || !sub) {
    res.status(404).json({ error: 'Fehlt' });
    return;
  }

  if (sub.currentGroupId) {
    allocatorModule.releaseGroupFromStation(sub.currentGroupId, systemState, getUniqueTimestamp);
  }

  commitAndRespond(res, { success: true, subStation: sub });
}

/**
 * Weist eine Gruppe manuell einer spezifischen Unterstation zu.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function subAssign(req: Request, res: Response): void {
  const { id } = req.params;
  const { subId, groupId } = req.body || {};
  const { station, subStation: sub } = getStationAndSubOrNull(id, subId);

  if (!station || !sub) {
    res.status(404).json({ error: 'Fehlt' });
    return;
  }

  const group = systemState.groups[groupId];
  if (!group) {
    res.status(404).json({ error: 'Fehlt' });
    return;
  }

  if (sub.currentGroupId) {
    allocatorModule.releaseGroupFromStation(sub.currentGroupId, systemState, getUniqueTimestamp);
  }

  if (group.currentStation) {
    allocatorModule.releaseGroupFromStation(group.id, systemState, getUniqueTimestamp);
  }

  allocatorModule.fixGroupMembersIfNeeded(group, systemState);
  allocatorModule.clearGroupReservation(station, group.id);

  const nowTs = getUniqueTimestamp();

  group.status = 'assigned';
  group.currentStation = subId;
  group.lastStatusChange = nowTs;

  sub.currentGroupId = groupId;
  sub.startTime = nowTs;

  writeSystemLog(group.name, subId, -8, sub.examiner || 'Prüfer');

  commitAndRespond(res, { success: true, subStation: sub });
}
