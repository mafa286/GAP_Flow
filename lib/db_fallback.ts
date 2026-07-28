// Version Tracker: lib/db_fallback.ts (GAP-Flow v1.1.5)

import fs from 'fs';
import { SystemState } from './types';

/**
 * Prüft, ob der In-Memory-Systemzustand (systemState) komplett leer ist.
 * Dient als Absicherung für den Empty-Save-Guard.
 * @param {Partial<SystemState>} systemState - Der aktuelle Systemzustand im RAM.
 * @returns {boolean} True, wenn weder Anwärter, Gruppen noch Stationen registriert sind.
 */
export function isSystemStateEmpty(systemState: Partial<SystemState>): boolean {
  const hasAnwaerter = Object.keys(systemState.anwaerter || {}).length > 0;
  const hasGroups = Object.keys(systemState.groups || {}).length > 0;
  const hasStations = Object.keys(systemState.stations || {}).length > 0;
  return !hasAnwaerter && !hasGroups && !hasStations;
}

/**
 * Lädt den Zustand aus dem JSON-Backup und wendet Schema-Härtungen an.
 * @param {string} jsonBackupPath - Pfad zur JSON-Backup-Datei.
 * @param {SystemState} systemState - Der zu befüllende Systemzustand im RAM.
 * @param {function(): number} getUniqueTimestamp - Funktion zur Generierung eindeutiger Zeitstempel.
 * @returns {boolean} True, wenn das Backup erfolgreich geladen wurde.
 */
export function loadJsonFallback(
  jsonBackupPath: string,
  systemState: SystemState,
  getUniqueTimestamp: () => number
): boolean {
  if (!fs.existsSync(jsonBackupPath)) return false;
  try {
    const rawData = fs.readFileSync(jsonBackupPath, 'utf8');
    const loaded = JSON.parse(rawData);

    // Kompatibilität: "students" auf "anwaerter" abbilden
    if (loaded.students && !loaded.anwaerter) {
      loaded.anwaerter = loaded.students;
      delete loaded.students;
    }

    // Schema-Härtung für Gruppen im JSON-Objekt
    if (loaded.groups) {
      Object.keys(loaded.groups).forEach((gId) => {
        const group = loaded.groups[gId];
        if (group.active === undefined) group.active = true;
        if (group.paused === undefined) group.paused = false;
        if (!group.completedStations || !Array.isArray(group.completedStations)) {
          group.completedStations = [];
        }
        if (!group.members || !Array.isArray(group.members)) {
          group.members = [];
        }
        if (group.lastStatusChange === undefined || Number.isNaN(group.lastStatusChange)) {
          group.lastStatusChange = getUniqueTimestamp();
        }
      });
    }

    // Schema-Härtung für Anwärter im JSON-Objekt
    if (loaded.anwaerter) {
      Object.keys(loaded.anwaerter).forEach((aId) => {
        const candidate = loaded.anwaerter[aId];
        if (candidate.active === undefined) candidate.active = true;
      });
    }

    // Schema-Härtung für Stationen im JSON-Objekt
    if (loaded.stations) {
      Object.keys(loaded.stations).forEach((mId) => {
        const station = loaded.stations[mId];
        if (station.targetAvgDuration === undefined) {
          station.targetAvgDuration = 15.0;
        }
        if (station.subStations) {
          Object.keys(station.subStations).forEach((subId) => {
            const sub = station.subStations[subId];
            if (sub.active === undefined) sub.active = true;
            if (sub.reservedGroupId === undefined) sub.reservedGroupId = null;
          });
        }
      });
    }

    if (loaded.firstAssignmentTime === undefined) {
      loaded.firstAssignmentTime = null;
    }

    if (loaded.settings) {
      systemState.settings = {
        phoneLeitstelleName: loaded.settings.phoneLeitstelleName || '',
        phoneLeitstelleNumber: loaded.settings.phoneLeitstelleNumber || '',
        phonePruefungsleitungName: loaded.settings.phonePruefungsleitungName || '',
        phonePruefungsleitungNumber: loaded.settings.phonePruefungsleitungNumber || '',
      };
    }

    Object.assign(systemState, loaded);
    console.log('[System-IO] Systemzustand aus JSON-Backup geladen.');
    return true;
  } catch (e) {
    const err = e as Error;
    console.error('[System-IO] Konnte JSON-Backup nicht lesen, initialisiere leeren Zustand:', err.message);
    return false;
  }
}

/**
 * Speichert den aktuellen Zustand als JSON-Fallback.
 * @param {string} jsonBackupPath - Pfad zur JSON-Backup-Datei.
 * @param {unknown} clonedState - Der geklonte Zustand.
 * @param {SystemState} systemState - Der originale Zustand (für Metadaten-Bereinigung).
 * @returns {void}
 */
export function saveJsonFallback(
  jsonBackupPath: string,
  clonedState: unknown,
  systemState: SystemState
): void {
  const tmpPath = `${jsonBackupPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(clonedState, null, 2));
    fs.renameSync(tmpPath, jsonBackupPath);

    systemState.isCleared = false;
    systemState.pendingLogCancellations = [];
  } catch (e) {
    const error = e as Error;
    console.error('[System-IO] Fehler beim Schreiben des JSON-Fallbacks:', error.message);
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {
        // Ignoriere temporäre Unlink-Fehler
      }
    }
  }
}
