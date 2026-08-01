import { Request, Response } from 'express';
import { SystemState, Anwaerter, Group, LogEntry, resetSystemState } from './types';
import * as allocatorModule from './allocator';

/**
 * Konfigurationsobjekt zur Initialisierung des Controllers.
 */
export interface AdminGroupsControllerOptions {
  systemState: SystemState;
  getUniqueTimestamp: () => number;
  sanitizeName: (str: string, maxLength: number) => string;
  dbImmediateSave: () => Promise<void>;
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
let dbImmediateSave: () => Promise<void> = async () => {};
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
 * Initialisiert den Admin-Groups-Controller mit den benötigten Abhängigkeiten.
 * @param {AdminGroupsControllerOptions} options - Konfigurationsobjekt.
 * @returns {void}
 */
export function init(options: AdminGroupsControllerOptions): void {
  systemState = options.systemState;
  getUniqueTimestamp = options.getUniqueTimestamp;
  sanitizeName = options.sanitizeName;
  dbImmediateSave = options.dbImmediateSave;
  ioBroadcast = options.ioBroadcast;
  commitAndRespond = options.commitAndRespond;
  writeSystemLog = options.writeSystemLog;
}

/**
 * Löscht alle Anwärter und Gruppen vollständig und erzwingt das sofortige Speichern.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {Promise<void>}
 */
export async function clearAnwaerter(req: Request, res: Response): Promise<void> {
  try {
    resetSystemState(systemState);

    await dbImmediateSave();
    ioBroadcast();
    res.json({ success: true });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Fügt einen einzelnen Anwärter der Datenbank hinzu (sofern der Name unbenutzt ist).
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function addAnwaerter(req: Request, res: Response): void {
  const { name } = req.body || {};
  if (!name) {
    res.status(400).json({ error: 'Name erforderlich' });
    return;
  }

  const cleanName = sanitizeName(name, 32);
  if (!cleanName) {
    res.status(400).json({ error: 'Ungültiger oder blockierter Name' });
    return;
  }

  const exists = Object.values(systemState.anwaerter || {}).some(
    (a) => a.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (exists) {
    res.status(400).json({ error: 'Ein Anwärter mit diesem Namen existiert bereits.' });
    return;
  }

  const id = `S_${Math.random().toString(36).substring(2, 9)}`;
  const candidate: Anwaerter = { id, name: cleanName, groupId: null, active: true };
  systemState.anwaerter[id] = candidate;

  commitAndRespond(res, { success: true, student: candidate }, false);
}

/**
 * Importiert eine Liste von Anwärtern per Batch. Löscht vorher alle bestehenden Teilnehmer.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {Promise<void>}
 */
export async function batchAnwaerter(req: Request, res: Response): Promise<void> {
  const { names } = req.body || {};
  if (!names || !Array.isArray(names)) {
    res.status(400).json({ error: 'Ungültig' });
    return;
  }

  resetSystemState(systemState);

  const imported: Anwaerter[] = [];
  const seen = new Set<string>();
  let duplicatesIgnored = 0;

  names.forEach((name) => {
    if (typeof name !== 'string') return;
    const cleanName = sanitizeName(name, 32);
    if (cleanName) {
      if (seen.has(cleanName.toLowerCase())) {
        duplicatesIgnored += 1;
        return;
      }
      seen.add(cleanName.toLowerCase());

      const id = `S_${Math.random().toString(36).substring(2, 9)}`;
      const candidate: Anwaerter = { id, name: cleanName, groupId: null, active: true };
      systemState.anwaerter[id] = candidate;
      imported.push(candidate);
    }
  });

  await dbImmediateSave();
  ioBroadcast();
  res.json({ success: true, count: imported.length, duplicatesIgnored });
}

/**
 * Toggelt den Aktivitätsstatus eines Anwärters.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function toggleAnwaerterActive(req: Request, res: Response): void {
  try {
    const { id } = req.params;
    const { active } = req.body || {};
    const candidate = systemState.anwaerter[id];
    if (!candidate) {
      res.status(404).json({ error: 'Fehlt' });
      return;
    }

    candidate.active = !!active;

    if (candidate.groupId) {
      const group = systemState.groups[candidate.groupId];
      const groupAnwaerter = Object.values(systemState.anwaerter).filter((a) => a.groupId === candidate.groupId);
      const allInactive = groupAnwaerter.every((a) => !a.active);

      if (allInactive && group && group.active) {
        group.active = false;
        allocatorModule.releaseGroupFromStation(candidate.groupId, systemState, getUniqueTimestamp);
      } else if (!allInactive && group && !group.active && active) {
        group.active = true;
        group.lastStatusChange = getUniqueTimestamp();
      }
    }

    commitAndRespond(res, { success: true, candidate });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Erstellt eine neue Gruppe und verknüpft die übergebenen Anwärter-IDs fest mit dieser.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function createGroup(req: Request, res: Response): void {
  const { name, anwaerterIds } = req.body || {};
  if (!name || !anwaerterIds || !Array.isArray(anwaerterIds) || anwaerterIds.length === 0) {
    res.status(400).json({ error: 'Ungültig' });
    return;
  }

  const cleanName = sanitizeName(name, 20);
  if (!cleanName) {
    res.status(400).json({ error: 'Ungültiger oder blockierter Gruppenname' });
    return;
  }

  const exists = Object.values(systemState.groups || {}).some(
    (g) => g.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (exists) {
    res.status(400).json({ error: 'Eine Gruppe mit diesem Namen existiert bereits.' });
    return;
  }

  const id = `G_${Math.random().toString(36).substring(2, 9)}`;
  const memberNames: string[] = [];

  anwaerterIds.forEach((sId: string) => {
    const candidate = systemState.anwaerter[sId];
    if (candidate && !candidate.groupId) {
      candidate.groupId = id;
      memberNames.push(candidate.name);
    }
  });

  const newGroup: Group = {
    id,
    name: cleanName,
    members: memberNames,
    completedStations: [],
    currentStation: null,
    status: 'waiting',
    paused: false,
    active: true,
    lastStatusChange: getUniqueTimestamp(),
  };

  systemState.groups[id] = newGroup;

  commitAndRespond(res, { success: true, group: newGroup });
}

/**
 * Pausiert oder entpausiert alle aktiven Gruppen und Unterstationen global.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function pauseAllGroups(req: Request, res: Response): void {
  const { paused } = req.body || {};
  const targetState = !!paused;

  if (targetState) {
    Object.keys(systemState.groups || {}).forEach((id) => {
      const group = systemState.groups[id];
      if (!group) return;
      if (group.active !== false) {
        group.paused = targetState;
        if (group.status === 'waiting') {
          group.status = 'paused';
          group.lastStatusChange = getUniqueTimestamp();
          writeSystemLog(group.name, '', -1, 'Leitstand (Zentrale Pause)');
        }
      }
    });

    Object.keys(systemState.stations || {}).forEach((mId) => {
      const master = systemState.stations[mId];
      if (master && master.subStations) {
        Object.keys(master.subStations).forEach((sId) => {
          const sub = master.subStations[sId];
          if (sub.active !== false && !sub.paused) {
            sub.paused = true;
            if (!sub.currentGroupId) {
              writeSystemLog('System', sub.id, -3, sub.examiner || 'Prüfer');
            }
          }
        });
      }
    });
  } else {
    Object.keys(systemState.groups || {}).forEach((id) => {
      const group = systemState.groups[id];
      if (!group) return;
      if (group.active !== false) {
        group.paused = targetState;
        if (group.status === 'paused') {
          group.status = 'waiting';
          group.lastStatusChange = getUniqueTimestamp();
          writeSystemLog(group.name, '', -2, 'Leitstand (Zentrale Pause)');
        }
      }
    });
  }

  commitAndRespond(res, { success: true, paused: targetState });
}

/**
 * Pausiert oder entpausiert eine spezifische Gruppe manuell über den Leitstand.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function pauseGroup(req: Request, res: Response): void {
  const { id } = req.params;
  const { paused } = req.body || {};
  const group = systemState.groups[id];

  if (!group) {
    res.status(404).json({ error: 'Fehlt' });
    return;
  }

  group.paused = !!paused;

  if (paused) {
    if (group.status === 'waiting') {
      group.status = 'paused';
      group.lastStatusChange = getUniqueTimestamp();
      writeSystemLog(group.name, '', -1, 'Leitstand');
    }
  } else if (group.status === 'paused') {
    group.status = 'waiting';
    group.lastStatusChange = getUniqueTimestamp();
    writeSystemLog(group.name, '', -2, 'Leitstand');
  }

  commitAndRespond(res, { success: true, group });
}

/**
 * Aktiviert oder deaktiviert eine Gruppe.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {void}
 */
export function toggleGroupActive(req: Request, res: Response): void {
  try {
    const { id } = req.params;
    const { active } = req.body || {};
    const group = systemState.groups[id];
    if (!group) {
      res.status(404).json({ error: 'Gruppe nicht gefunden' });
      return;
    }

    group.active = !!active;

    const groupAnwaerter = Object.values(systemState.anwaerter || {}).filter((a) => a.groupId === id);
    groupAnwaerter.forEach((a) => {
      systemState.anwaerter[a.id].active = !!active;
    });

    if (!active) {
      allocatorModule.releaseGroupFromStation(id, systemState, getUniqueTimestamp);
    } else {
      group.status = 'waiting';
      group.currentStation = null;
      group.lastStatusChange = getUniqueTimestamp();
    }

    commitAndRespond(res, { success: true, group });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}

/**
 * Löst eine leere/unbenutzte Gruppe wieder auf.
 * @param {Request} req - Express Request.
 * @param {Response} res - Express Response.
 * @returns {Promise<void>}
 */
export async function dissolveGroup(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const group = systemState.groups[id];
    if (!group) {
      res.status(404).json({ error: 'Fehlt' });
      return;
    }

    if (group.currentStation !== null || (group.completedStations || []).length > 0) {
      res.status(400).json({ error: 'Bereits aktiv' });
      return;
    }

    const members = Object.values(systemState.anwaerter || {}).filter((a) => a.groupId === id);
    members.forEach((member) => {
      const candidate = member;
      candidate.groupId = null;
    });

    delete systemState.groups[id];

    await dbImmediateSave();
    ioBroadcast();
    res.json({ success: true });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
}
