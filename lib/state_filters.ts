import { SystemState, Station, SubStation, LogEntry } from './types';

/**
 * Trefferobjekt bei der Suche nach einer Unterstation.
 */
export interface SubStationMatch {
  subStation: SubStation | null;
  masterStation: Station | null;
}

/**
 * Aktivitätsstatus eines Gruppenmitglieds.
 */
export interface GroupMemberStatus {
  name: string;
  active: boolean;
}

/**
 * Details der aktuell an der Unterstation aktiven Gruppe.
 */
export interface FlatGroupDetails {
  id: string;
  name: string;
  members: GroupMemberStatus[];
}

/**
 * Bereinigtes Unterstations-Objekt für das Prüfer-Panel.
 */
export interface FlatExaminerSubStation {
  id: string;
  examiner: string;
  paused: boolean;
  currentGroupId: string | null;
  startTime: number | null;
  active: boolean;
}

/**
 * Flacher Status-Payload für das Prüfer-Panel (DSGVO-konform).
 */
export interface FlatExaminerState {
  subStation: FlatExaminerSubStation;
  masterName: string;
  remainingGroups: number;
  waitingGroups: number;
  currentGroupDetails: FlatGroupDetails | null;
  totalActiveGroups: number;
  completedThisMaster: number;
  reservedGroupName: string;
  isRegistered: boolean;
  isAuthorized: boolean;
  isClaimed: boolean;
  settings?: {
    phoneLeitstelleName?: string;
    phoneLeitstelleNumber?: string;
    phonePruefungsleitungName?: string;
    phonePruefungsleitungNumber?: string;
  };
}

/**
 * Sucht eine Unterstation sowie deren übergeordnete Master-Station anhand des statischen Tokens.
 * @param {SystemState} systemState - Der aktuelle Systemzustand im RAM.
 * @param {string | null | undefined} token - Das zu suchende Zugriffstoken der Unterstation.
 * @returns {SubStationMatch} Objekt mit den gefundenen Stationen.
 */
export function findSubStationAndMasterByToken(
  systemState: SystemState,
  token?: string | null
): SubStationMatch {
  if (!token) return { subStation: null, masterStation: null };
  const masterIds = Object.keys(systemState.stations || {});
  for (let i = 0; i < masterIds.length; i += 1) {
    const master = systemState.stations[masterIds[i]];
    if (master && master.subStations) {
      const subIds = Object.keys(master.subStations);
      for (let j = 0; j < subIds.length; j += 1) {
        const sub = master.subStations[subIds[j]];
        if (sub && sub.token === token) {
          return { subStation: sub, masterStation: master };
        }
      }
    }
  }
  return { subStation: null, masterStation: null };
}

/**
 * Prüft, ob ein Log-Eintrag zu einer bestimmten Hauptstation gehört.
 * @param {LogEntry} log - Der zu prüfende Log-Eintrag.
 * @param {Station} station - Die Referenz-Hauptstation.
 * @returns {boolean} True, wenn der Log-Eintrag der Station zugeordnet werden kann.
 */
export function isLogForStation(log: LogEntry, station: Station): boolean {
  const logStationId = String(log.stationId || '');
  return logStationId === station.name || (!!logStationId && logStationId.split('.')[0] === station.id);
}

/**
 * Erstellt einen gefilterten Zustand des Systems für den Read-Only Beamer-Monitor.
 * DSGVO: Entfernt alle Personennamen der Anwärter und Prüfer sowie inaktive Gruppen/Stationen.
 * @param {SystemState} systemState - Der aktuelle Systemzustand im RAM.
 * @returns {Record<string, unknown>} Minimierter Systemzustand für den Beamer-Client.
 */
/**
 * Entfernt inaktive Gruppen und leert die Mitgliedernamen zur Einhaltung der DSGVO-Richtlinien.
 * @param {Record<string, any>} [groups] - Das Gruppen-Objekt des Systemzustands.
 * @returns {void}
 */
function stripInactiveGroupsAndMembers(groups?: Record<string, any>): void {
  if (!groups) return;
  const gIds = Object.keys(groups);
  gIds.forEach((gId) => {
    if (groups[gId].active === false) {
      delete groups[gId];
    } else {
      groups[gId].members = [];
    }
  });
}

export function getBeamerState(systemState: SystemState): Record<string, unknown> {
  const cleanState = structuredClone(systemState) as unknown as Record<string, any>;
  delete cleanState.logs;
  delete cleanState.anwaerter;
  delete cleanState.autoAllocationActive;
  delete cleanState.firstAssignmentTime;
  delete cleanState.isCleared;
  delete cleanState.pendingLogCancellations;
  delete cleanState.settings;

  stripInactiveGroupsAndMembers(cleanState.groups);

  if (cleanState.stations) {
    const mIds = Object.keys(cleanState.stations);
    mIds.forEach((mId) => {
      const s = cleanState.stations[mId];
      const subStations = Object.values(s.subStations || {}) as SubStation[];
      const hasActiveSub = subStations.some((sub) => sub.active !== false);
      if (!s.active || !hasActiveSub) {
        delete cleanState.stations[mId];
      } else {
        s.hasActiveSub = true;

        const activeSubs = subStations.filter((sub) => sub.active !== false);
        const pausedSubs = activeSubs.filter((sub) => !!sub.paused);
        const hasSprechwunsch = activeSubs.some((sub) => !!sub.sprechwunsch);

        const stats = s.stats || { avgDuration: 15.0, g_rem: 0, n_subs: 1 };
        let remainingTime = 0;
        if (stats.g_rem > 0) {
          let tActive = 0;
          activeSubs.forEach((sub) => {
            if (sub.currentGroupId && sub.startTime) {
              tActive += (Date.now() - sub.startTime) / 60000;
            }
          });
          const rawRemaining = ((stats.avgDuration * stats.g_rem) - tActive) / (stats.n_subs || 1);
          remainingTime = Math.max(1, Math.round(rawRemaining));
        }

        s.beamerStatus = {
          isAnyPaused: pausedSubs.length > 0,
          pausedCount: pausedSubs.length,
          totalActiveSubs: activeSubs.length,
          remainingTime,
          sprechwunsch: hasSprechwunsch,
        };

        delete s.subStations;
        delete s.stats;
      }
    });
  }
  return cleanState;
}

/**
 * Erstellt den hochgradig minimierten Status-Payload für eine spezifische Unterstation.
 * DSGVO: Überträgt nur die an dieser Station aktiven Gruppenmitglieder. Keine globalen Listen.
 * @param {SystemState} systemState - Der aktuelle Systemzustand im RAM.
 * @param {string} token - Das Zugriffstoken der anfragenden Unterstation.
 * @param {string | null | undefined} clientDeviceToken - Das lokal gespeicherte Token des Prüfer-Smartphones.
 * @returns {FlatExaminerState | null} Flaches Zustandsobjekt für das Prüfer-Panel oder null bei Ungültigkeit.
 */
export function getFlatExaminerState(
  systemState: SystemState,
  token: string,
  clientDeviceToken?: string | null
): FlatExaminerState | null {
  const { subStation: targetSub, masterStation: targetMaster } = findSubStationAndMasterByToken(systemState, token);

  if (!targetSub || !targetMaster) return null;

  const totalGroups = Object.values(systemState.groups || {});
  const remaining = totalGroups.filter(
    (g) => g.active !== false &&
           !(g.completedStations || []).includes(targetMaster.id) &&
           !(g.currentStation && g.currentStation.split('.')[0] === targetMaster.id)
  ).length;

  const waiting = totalGroups.filter(
    (g) => g.active !== false &&
           !(g.completedStations || []).includes(targetMaster.id) &&
           g.status === 'waiting'
  ).length;

  let currentGroupDetails: FlatGroupDetails | null = null;
  if (targetSub.currentGroupId && systemState.groups[targetSub.currentGroupId]) {
    const rawGroup = systemState.groups[targetSub.currentGroupId];
    const membersWithStatus: GroupMemberStatus[] = (rawGroup.members || []).map((mName) => {
      const candidate = Object.values(systemState.anwaerter || {}).find((a) => a.name === mName);
      return { name: mName, active: candidate ? candidate.active !== false : true };
    });
    currentGroupDetails = { id: rawGroup.id, name: rawGroup.name, members: membersWithStatus };
  }

  const totalActiveGroups = totalGroups.filter((g) => g.active !== false).length;
  const completedThisMaster = totalGroups.filter(
    (g) => g.active !== false && (g.completedStations || []).includes(targetMaster.id)
  ).length;

  const cleanSub: FlatExaminerSubStation = {
    id: targetSub.id,
    examiner: targetSub.examiner,
    paused: targetSub.paused,
    currentGroupId: targetSub.currentGroupId,
    startTime: targetSub.startTime,
    active: targetSub.active !== false,
  };

  let reservedGroupName = '';
  if (targetSub.reservedGroupId && systemState.groups[targetSub.reservedGroupId]) {
    reservedGroupName = systemState.groups[targetSub.reservedGroupId].name;
  }

  const isRegistered = !!targetSub.examiner;
  const isAuthorized = isRegistered && !!targetSub.deviceToken && (targetSub.deviceToken === clientDeviceToken);
  const isClaimed = !!targetSub.deviceToken;

  return {
    subStation: cleanSub,
    masterName: targetMaster.name,
    remainingGroups: remaining,
    waitingGroups: waiting,
    currentGroupDetails,
    totalActiveGroups,
    completedThisMaster,
    reservedGroupName,
    isRegistered,
    isAuthorized,
    isClaimed,
    settings: systemState.settings ? {
      phoneLeitstelleName: systemState.settings.phoneLeitstelleName || '',
      phoneLeitstelleNumber: systemState.settings.phoneLeitstelleNumber || '',
      phonePruefungsleitungName: systemState.settings.phonePruefungsleitungName || '',
      phonePruefungsleitungNumber: systemState.settings.phonePruefungsleitungNumber || '',
    } : undefined,
  };
}

/**
 * Minimiert den Payload für die Live-Dashboard-Ansicht (Admin-Kanal).
 * DSGVO: Entfernt die globale Anwärterdatenbank und alle Namen der Gruppenmitglieder.
 * @param {SystemState} systemState - Der aktuelle Systemzustand im RAM.
 * @returns {Record<string, unknown>} Gefilterter Systemzustand für das Live-Dashboard.
 */
export function getAdminDashboardState(systemState: SystemState): Record<string, unknown> {
  const cleanState = structuredClone(systemState) as unknown as Record<string, any>;
  delete cleanState.anwaerter;
  stripInactiveGroupsAndMembers(cleanState.groups);
  if (cleanState.stations) {
    Object.keys(cleanState.stations).forEach((mId) => {
      const master = cleanState.stations[mId];
      if (master && master.subStations) {
        Object.keys(master.subStations).forEach((sId) => {
          delete master.subStations[sId].token;
          delete master.subStations[sId].deviceToken;
        });
      }
    });
  }
  return cleanState;
}

/**
 * Minimiert den Payload für die Gruppenverwaltungs-Ansicht (Admin-Kanal).
 * DSGVO: Entfernt alle Stationskonfigurationen und das Live-Aktivitätslog.
 * @param {SystemState} systemState - Der aktuelle Systemzustand im RAM.
 * @returns {Record<string, unknown>} Gefilterter Systemzustand für die Gruppenverwaltung.
 */
export function getAdminGroupsState(systemState: SystemState): Record<string, unknown> {
  const cleanState = structuredClone(systemState) as unknown as Record<string, any>;
  delete cleanState.stations;
  delete cleanState.logs;
  delete cleanState.firstAssignmentTime;
  delete cleanState.pendingLogCancellations;
  delete cleanState.isCleared;
  return cleanState;
}

/**
 * Minimiert den Payload für die Stationsverwaltungs-Ansicht (Admin-Kanal).
 * DSGVO: Entfernt die Anwärterdatenbank, das Aktivitätslog, alle Gruppenmitglieder und Dashboard-Stats.
 * @param {SystemState} systemState - Der aktuelle Systemzustand im RAM.
 * @returns {Record<string, unknown>} Gefilterter Systemzustand für die Stationsverwaltung.
 */
export function getAdminStationsState(systemState: SystemState): Record<string, unknown> {
  const cleanState = structuredClone(systemState) as unknown as Record<string, any>;
  delete cleanState.anwaerter;
  delete cleanState.logs;
  stripInactiveGroupsAndMembers(cleanState.groups);
  if (cleanState.stations) {
    const mIds = Object.keys(cleanState.stations);
    mIds.forEach((mId) => {
      delete cleanState.stations[mId].stats;
    });
  }
  delete cleanState.firstAssignmentTime;
  delete cleanState.pendingLogCancellations;
  delete cleanState.isCleared;
  return cleanState;
}
