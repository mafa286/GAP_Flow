// Version Tracker: lib/types.ts (GAP-Flow v1.0.5)

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
  pausedAt?: number;
  pauseDurationMinutes?: number;
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
  targetAvgDuration?: number;
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
}

/**
 * Systemweite Konfigurationseinstellungen.
 */
export interface SystemSettings {
  phoneLeitstelleName: string;
  phoneLeitstelleNumber: string;
  phonePruefungsleitungName: string;
  phonePruefungsleitungNumber: string;
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
  settings?: SystemSettings;
  _examFinishedNotificationSent?: boolean;
}

/**
 * Push-Subscription Schlüssel für die W3C Web Push API.
 */
export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/**
 * Web Push Subscription Datenstrukturen zur Speicherung in der Datenbank.
 */
export interface PushSubscriptionData {
  endpoint: string;
  keys: PushSubscriptionKeys;
  role: 'examiner' | 'admin' | 'pruefungsleitung' | 'leitstelle';
  targetId?: string;
}

/**
 * Aktions-Button in einer PWA-Push-Benachrichtigung.
 */
export interface NotificationAction {
  action: string;
  title: string;
  icon?: string;
}

/**
 * Einheitliches Payload-Format für Push-Benachrichtigungen.
 */
export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  renotify?: boolean;
  vibrate?: number[];
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
}

/**
 * Sprechwunsch-Anforderung von einer Prüfstation an die Leitung.
 */
export interface CallbackRequest {
  target: 'leitstelle' | 'pruefungsleitung';
  subId: string;
  examinerName: string;
  phoneNumber: string;
  timestamp: number;
}
