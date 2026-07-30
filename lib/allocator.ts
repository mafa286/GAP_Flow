// Version Tracker: lib/allocator.ts (GAP-Flow v1.1.68)

import { SystemState, Group, Station, SubStation, LogEntry } from './types';

/**
 * Signatur der System-Logging-Funktion.
 */
export type WriteSystemLogFn = (
  groupName: string,
  stationId: string,
  durationMinutes: number,
  examiner: string,
  extraProps?: Record<string, unknown>
) => LogEntry | null;

/**
 * Optionen zur Initialisierung des Allocators.
 */
export interface AllocatorOptions {
  writeSystemLog: WriteSystemLogFn;
}

let writeSystemLog: WriteSystemLogFn = () => null;

/**
 * Initialisiert den Allocator mit den benötigten Logging-Abhängigkeiten.
 * @param {AllocatorOptions} options - Konfigurationsobjekt.
 * @returns {void}
 */
export function init(options: AllocatorOptions): void {
  writeSystemLog = options.writeSystemLog;
}

/**
 * Ermittelt alle IDs der Hauptstationen, die sowohl aktiv geschaltet sind als auch
 * über mindestens eine aktive (nicht-deaktivierte) Unterstation verfügen.
 * @param {SystemState} systemState - Der aktuelle Systemzustand.
 * @returns {string[]} Liste der IDs aller aktiven Hauptstationen.
 */
export function getActiveMasterIds(systemState: SystemState): string[] {
  const stations = Object.values(systemState.stations || {});
  const activeStations = stations.filter((s) => {
    const hasActiveSub = Object.values(s.subStations || {}).some((sub) => sub.active !== false);
    return s.active && hasActiveSub;
  });
  return activeStations.map((s) => s.id);
}

/**
 * Protokolliert die feste Zusammensetzung der Gruppenmitglieder beim ersten Zuweisungsschritt
 * in den System-Logs (Ereignis -12 / Mitglieder-Fixierung).
 * @param {Group} group - Die betroffene Gruppe.
 * @param {SystemState} systemState - Der aktuelle Systemzustand.
 * @returns {void}
 */
export function logGroupMembersFixation(group: Group, systemState: SystemState): void {
  const members = Object.values(systemState.anwaerter || {}).filter((a) => a.groupId === group.id);
  members.forEach((member) => {
    writeSystemLog(group.name, '', -12, member.name);
  });
}

/**
 * Überprüft, ob es sich um den allerersten Prüfungslauf der Gruppe handelt.
 * Falls ja, wird die Mitglieder-Fixierung durchgeführt und protokolliert.
 * @param {Group} group - Die zu überprüfende Gruppe.
 * @param {SystemState} systemState - Der aktuelle Systemzustand.
 * @returns {boolean} True, wenn die Mitglieder fixiert wurden, andernfalls false.
 */
export function fixGroupMembersIfNeeded(group: Group, systemState: SystemState): boolean {
  if (!group) return false;
  const isFirstAssignment = (group.completedStations || []).length === 0 && !group.currentStation;
  if (isFirstAssignment) {
    logGroupMembersFixation(group, systemState);
    return true;
  }
  return false;
}

/**
 * Führt die eigentliche Zuteilungsentscheidung für eine bestimmte Unterstation durch.
 * Sucht die am besten geeignete wartende Gruppe anhand von Prioritätsregeln aus.
 * @param {string} subStationId - Die ID der Unterstation, für die ein Team gesucht wird.
 * @param {SystemState} systemState - Der aktuelle Systemzustand.
 * @param {function(): number} getUniqueTimestamp - Funktion zur Timestamp-Generierung.
 * @returns {Group | null} Die zugewiesene Gruppe oder null, wenn kein passender Kandidat existiert.
 */
export function executeAllocation(
  subStationId: string,
  systemState: SystemState,
  getUniqueTimestamp: () => number
): Group | null {
  const masterStations = Object.values(systemState.stations || {});
  const targetMaster = masterStations.find((master) => master.subStations && master.subStations[subStationId]);
  const targetSub = targetMaster ? targetMaster.subStations[subStationId] : null;

  if (!targetSub || !targetMaster || !targetMaster.active || targetSub.paused || targetSub.active === false) {
    return null;
  }

  const activeMasterIds = getActiveMasterIds(systemState);
  const candidates = Object.values(systemState.groups || {}).filter((group) => {
    const isWaiting = group.status === 'waiting';
    const isGroupActive = group.active !== false;
    const notCompleted = !(group.completedStations || []).includes(targetMaster.id);

    if (!isWaiting || !isGroupActive || !notCompleted) return false;

    if (targetSub.reservedGroupId && targetSub.reservedGroupId !== group.id) {
      return false;
    }

    if (targetSub.reservedGroupId !== group.id) {
      const allMasters = Object.values(systemState.stations || {});
      const isReservedElsewhere = allMasters.some((m) => {
        const otherSubs = Object.values(m.subStations || {});
        return otherSubs.some((otherSub) => otherSub.id !== targetSub.id && otherSub.reservedGroupId === group.id);
      });
      if (isReservedElsewhere) {
        return false;
      }
    }

    return true;
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const remA = activeMasterIds.filter((id) => !(a.completedStations || []).includes(id)).length;
    const remB = activeMasterIds.filter((id) => !(b.completedStations || []).includes(id)).length;
    if (remA !== remB) {
      return remB - remA;
    }
    if (a.lastStatusChange !== b.lastStatusChange) {
      return a.lastStatusChange - b.lastStatusChange;
    }
    return a.name.localeCompare(b.name, 'de', { numeric: true });
  });

  const selectedGroup = candidates[0];
  fixGroupMembersIfNeeded(selectedGroup, systemState);

  selectedGroup.status = 'assigned';
  selectedGroup.currentStation = subStationId;
  selectedGroup.lastStatusChange = getUniqueTimestamp();

  targetSub.currentGroupId = selectedGroup.id;
  targetSub.startTime = Date.now();

  const subIds = Object.keys(targetMaster.subStations);
  subIds.forEach((sId) => {
    if (targetMaster.subStations[sId].reservedGroupId === selectedGroup.id) {
      targetMaster.subStations[sId].reservedGroupId = null;
    }
  });

  writeSystemLog(selectedGroup.name, subStationId, -10, targetSub.examiner || 'Prüfer');

  if (!systemState.firstAssignmentTime) {
    systemState.firstAssignmentTime = Date.now();
  }

  return selectedGroup;
}

/**
 * Ermittelt die Namen aller aktiven Mitglieder einer bestimmten Gruppe für Push-Payloads.
 * @param {string} groupId - Die Gruppen-ID.
 * @param {SystemState} systemState - Der aktuelle Systemzustand.
 * @returns {string[]} Liste der Anwärternamen.
 */
export function getGroupMemberNames(groupId: string, systemState: SystemState): string[] {
  if (!groupId || !systemState.anwaerter) return [];
  return Object.values(systemState.anwaerter)
    .filter((a) => a.groupId === groupId && a.active !== false)
    .map((a) => a.name);
}

/**
 * Scannt alle pausierten oder überzogenen Stationen für automatische Erinnerungs-Notifications.
 * @param {SystemState} systemState - Der aktuelle Systemzustand.
 * @returns {{ inactives: Array<Record<string, unknown>>, overtimes: Array<Record<string, unknown>> }} Erinnerungsdaten.
 */
export function scanReminderEvents(systemState: SystemState): {
  inactives: Array<{ subId: string; pausedMinutes: number }>;
  overtimes: Array<{ subId: string; groupName: string; overtimeMinutes: number }>;
} {
  const inactives: Array<{ subId: string; pausedMinutes: number }> = [];
  const overtimes: Array<{ subId: string; groupName: string; overtimeMinutes: number }> = [];
  const now = Date.now();

  Object.values(systemState.stations || {}).forEach((master) => {
    if (!master || !master.subStations) return;
    const avgDuration = master.stats?.avgDuration || master.targetAvgDuration || 15;

    Object.values(master.subStations).forEach((sub) => {
      if (!sub) return;

      // 1. Inaktivitätsprüfung (Pausiert & Leer)
      const pauseRefTime = sub.pausedAt || sub.startTime;
      if (sub.paused && !sub.currentGroupId && pauseRefTime) {
        const pausedMinutes = Math.floor((now - pauseRefTime) / 60000);
        if (pausedMinutes >= 30 && (pausedMinutes - 30) % 10 === 0) {
          inactives.push({ subId: sub.id, pausedMinutes });
        }
      }

      // 2. Richtzeit-Überschreitung (Aktiv mit Gruppe)
      if (sub.currentGroupId && sub.startTime && !sub.paused) {
        const elapsedMinutes = Math.floor((now - sub.startTime) / 60000);
        const overtime = elapsedMinutes - avgDuration;
        if (overtime >= 10 && (overtime - 10) % 10 === 0) {
          const group = systemState.groups[sub.currentGroupId];
          overtimes.push({
            subId: sub.id,
            groupName: group ? group.name : 'Unbekannt',
            overtimeMinutes: overtime,
          });
        }
      }
    });
  });

  return { inactives, overtimes };
}

/**
 * Scannt alle freien, aktiven und unpausierten Unterstationen und füllt diese
 * automatisch mit wartenden Gruppen auf, sofern die Automatik aktiviert ist.
 * @param {SystemState} systemState - Der aktuelle Systemzustand.
 * @param {function(): number} getUniqueTimestamp - Funktion zur Timestamp-Generierung.
 * @param {function(): void} scheduleStateSave - Asynchrone Speicherfunktion der DB.
 * @param {function(): void} broadcastState - Websocket-Schnittstelle zum Broadcasten.
 * @returns {boolean} True, wenn mindestens eine Zuteilung stattgefunden hat.
 */
let isAllocating = false;

export function checkAndAssignIdleStations(
  systemState: SystemState,
  getUniqueTimestamp: () => number,
  scheduleStateSave: () => void,
  broadcastState: () => void
): boolean {
  if (systemState.autoAllocationActive !== true || isAllocating) {
    return false;
  }

  isAllocating = true;
  let allocationOccurred = false;

  try {
    const idleSubs: string[] = [];
    const activeMasters = Object.values(systemState.stations || {}).filter((master) => master.active);
    
    activeMasters.forEach((master) => {
      const subs = Object.values(master.subStations || {});
      subs.forEach((sub) => {
        if (sub.active !== false && !sub.paused && !sub.currentGroupId) {
          idleSubs.push(sub.id);
        }
      });
    });

    idleSubs.forEach((subId) => {
      const assignedGroup = executeAllocation(subId, systemState, getUniqueTimestamp);
      if (assignedGroup) {
        allocationOccurred = true;
        console.log(`[Auto-Allocation] Gruppe '${assignedGroup.name}' wurde automatisch der leerlaufenden Station '${subId}' zugewiesen.`);
      }
    });

    if (allocationOccurred) {
      scheduleStateSave();
      broadcastState();
    }
  } catch (error) {
    console.error('[Auto-Allocation] Kritischer Fehler im Zuteilungslauf:', error);
  } finally {
    isAllocating = false;
  }

  return allocationOccurred;
}

/**
 * Entzieht einer Gruppe manuell oder systemseitig eine aktuell belegte Unterstation.
 * Setzt den Gruppenstatus zurück auf 'wartend' und protokolliert das Ereignis.
 * @param {string} groupId - ID der freizugebenden Gruppe.
 * @param {SystemState} systemState - Der aktuelle Systemzustand.
 * @param {function(): number} getUniqueTimestamp - Funktion zur Timestamp-Generierung.
 * @returns {void}
 */
export function releaseGroupFromStation(
  groupId: string,
  systemState: SystemState,
  getUniqueTimestamp: () => number
): void {
  const group = systemState.groups[groupId];
  if (group && group.currentStation) {
    const masterId = group.currentStation.split('.')[0];
    const master = systemState.stations ? systemState.stations[masterId] : null;
    const sub = (master && master.subStations) ? master.subStations[group.currentStation] : null;
    if (sub) {
      writeSystemLog(group.name, sub.id, -9, sub.examiner || 'Prüfer');
      sub.currentGroupId = null;
      sub.startTime = null;
      if (sub.paused) {
        writeSystemLog('System', sub.id, -3, sub.examiner || 'Prüfer');
      }
    }
    group.status = 'waiting';
    group.currentStation = null;
    group.lastStatusChange = getUniqueTimestamp();
  }
}

/**
 * Startet den Auto-Unpause-Daemon im Hintergrund, der blockierte oder vergessene Pausen
 * von Gruppen nach einer Sicherheitszeit von 30 Minuten automatisch auflöst.
 * @param {SystemState} systemState - Der aktuelle Systemzustand.
 * @param {function(): number} getUniqueTimestamp - Funktion zur Timestamp-Generierung.
 * @param {function(): void} scheduleStateSave - Asynchrone Speicherfunktion der DB.
 * @param {function(): void} broadcastState - Websocket-Schnittstelle zum Broadcasten.
 * @returns {NodeJS.Timeout} Referenz des gestarteten Intervalls.
 */
export function startAutoUnpauseDaemon(
  systemState: SystemState,
  scheduleStateSave: () => void,
  broadcastState: () => void
): void {
  setInterval(() => {
    if (!systemState) return;
    
    try {
      let stateChanged = false;
      const now = Date.now();

      Object.values(systemState.stations || {}).forEach((master) => {
        if (!master || !master.subStations) return;
        
        Object.values(master.subStations).forEach((sub) => {
          if (sub && sub.paused && sub.pausedAt && sub.pauseDurationMinutes) {
            const pauseEndTime = sub.pausedAt + sub.pauseDurationMinutes * 60 * 1000;
            if (now >= pauseEndTime) {
              sub.paused = false;
              sub.pausedAt = undefined;
              sub.pauseDurationMinutes = undefined;
              stateChanged = true;
              console.log(`[Auto-Unpause] Unterstation '${sub.id}' wurde automatisch entpausiert.`);
            }
          }
        });
      });

      if (stateChanged) {
        scheduleStateSave();
        broadcastState();
        checkAndAssignIdleStations(systemState, Date.now, scheduleStateSave, broadcastState);
      }
    } catch (error) {
      console.error('[Auto-Unpause Daemon] Fehler bei automatischer Freigabe-Prüfung:', error);
    }
  }, 10000);
}
