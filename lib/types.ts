// Version Tracker: lib/types.ts (GAP-Flow v1.0.0)

/**
 * Repräsentiert einen registrierten Anwärter.
 */
export interface Anwaerter {
  id: string;
  name: string;
  groupId: string | null;
  active: boolean;
}

/**
 * Repräsentiert eine Unterstation / Prüfstelle.
 */
export interface SubStation {
  id: string;
  parentId: string;
  examiner: string;
  paused: boolean;
  currentGroupId: string | null;
  token: string;
  startTime: number | null;
  active?: boolean;
  reservedGroupId?: string | null;
  deviceToken?: string | null;
  sprechwunsch?: boolean;
  sprechwunschText?: string | null;
  sprechwunschAnswer?: string | null;
}

/**
 * Berechnete Leistungsdaten einer Hauptstation.
 */
export interface StationStats {
  avgDuration: number;
  hasLogs: boolean;
  g_rem: number;
  n_subs: number;
}

/**
 * Repräsentiert eine Hauptstation.
 */
export interface Station {
  id: string;
  name: string;
  active: boolean;
  multiplier: number;
  subStations: Record<string, SubStation>;
  stats?: StationStats;
}

/**
 * Repräsentiert ein Prüfungsteam / Gruppe.
 */
export interface Group {
  id: string;
  name: string;
  members: string[];
  completedStations: string[];
  currentStation: string | null;
  status: 'waiting' | 'assigned' | 'paused' | string;
  lastStatusChange: number;
  paused?: boolean;
  active?: boolean;
}

/**
 * Ein Eintrag im Verlaufsprotokoll / Log.
 */
export interface LogEntry {
  timestamp: number;
  groupName: string;
  stationId: string;
  durationMinutes: number;
  examiner: string;
  cancelled?: boolean;
  text?: string;
}

/**
 * Der zentrale In-Memory-Systemzustand.
 */
export interface SystemState {
  anwaerter: Record<string, Anwaerter>;
  groups: Record<string, Group>;
  stations: Record<string, Station>;
  logs: LogEntry[];
  autoAllocationActive: boolean;
  firstAssignmentTime: number | null;
  isCleared: boolean;
  pendingLogCancellations: number[];
}