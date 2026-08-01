import sqlite3 from 'sqlite3';
import { SystemState, Anwaerter, Group, Station, SubStation, LogEntry } from './types';
import * as dbFallback from './db_fallback';

let db: sqlite3.Database | null = null;
let useJsonFallback = false;
let sqlite3Driver: typeof sqlite3 | null = null;

// Versuch, das native sqlite3-Modul zu laden. Bei Fehlschlag automatischer JSON-Fallback.
try {
  sqlite3Driver = sqlite3.verbose();
} catch (e) {
  console.warn('[System-IO] SQLite3-Treiber nicht verfügbar. Schwenke auf stabilen JSON-Sicherungsmodus.');
  useJsonFallback = true;
}

let saveTimeout: NodeJS.Timeout | null = null;
let isSaving = false;
let savePending = false;
let saveRetryCount = 0;
const MAX_SAVE_RETRIES = 5;
let lastSavedLogTimestamp = 0;

/**
 * Führt eine SQL-Abfrage aus und gibt alle passenden Zeilen zurück.
 * @template T
 * @param {string} query - Die auszuführende SQL-Abfrage.
 * @param {unknown[]} [params=[]] - Die Bindungsparameter.
 * @returns {Promise<T[]>} Promise mit den Ergebniszeilen.
 */
const dbAll = <T = unknown>(query: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Database not initialized'));
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });

/**
 * Führt eine SQL-Abfrage aus und gibt die erste gefundene Zeile zurück.
 * @template T
 * @param {string} query - Die auszuführende SQL-Abfrage.
 * @param {unknown[]} [params=[]] - Die Bindungsparameter.
 * @returns {Promise<T | null>} Promise mit der Ergebniszeile oder null.
 */
const dbGet = <T = unknown>(query: string, params: unknown[] = []): Promise<T | null> =>
  new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Database not initialized'));
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve((row as T) || null);
    });
  });

/**
 * Liefert die aktive SQLite-Datenbankinstanz.
 * @returns {sqlite3.Database | null} Die sqlite3-Datenbankverbindung oder null.
 */
export function getDb(): sqlite3.Database | null {
  return db;
}

/**
 * Gibt an, ob das System im JSON-Fallback-Modus betrieben wird.
 * @returns {boolean} True, wenn SQLite inaktiv ist.
 */
export function getUseJsonFallback(): boolean {
  return useJsonFallback;
}

/**
 * Gibt den aktuellen Schreibstatus auf dem Speichermedium zurück.
 * @returns {boolean} True, wenn gerade ein physischer Schreibvorgang läuft.
 */
export function getIsSaving(): boolean {
  return isSaving;
}

/**
 * Setzt den aktuellen Schreibstatus manuell.
 * @param {boolean} val - Der neue Schreibstatus.
 * @returns {void}
 */
export function setSaving(val: boolean): void {
  isSaving = val;
}

/**
 * Löscht einen eventuell geplanten asynchronen Speichertimer.
 * @returns {void}
 */
export function clearSaveTimeout(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
}

/**
 * Initialisiert die System-Datenbank, führt Schemamigrationen durch und lädt den Zustand.
 * @param {string} dbPath - Pfad zur SQLite-Datenbankdatei.
 * @param {string} jsonBackupPath - Pfad zur JSON-Backup-Datei (Fallback).
 * @param {SystemState} systemState - Der zu befüllende In-Memory-Systemzustand.
 * @param {function(): number} getUniqueTimestamp - Funktion zur Generierung von Zeitstempeln.
 * @returns {Promise<void>}
 */
export function initializeSystem(
  dbPath: string,
  jsonBackupPath: string,
  systemState: SystemState,
  getUniqueTimestamp: () => number
): Promise<void> {
  return new Promise((resolve) => {
    if (useJsonFallback || !sqlite3Driver) {
      useJsonFallback = true;
      loadStateFromDb(dbPath, jsonBackupPath, systemState, getUniqueTimestamp).then(resolve);
      return;
    }

    db = new sqlite3Driver.Database(dbPath, (err) => {
      if (err) {
        console.error('[System-IO] Fehler beim Öffnen der SQLite-Datenbank, verwende JSON-Fallback:', err.message);
        useJsonFallback = true;
        loadStateFromDb(dbPath, jsonBackupPath, systemState, getUniqueTimestamp).then(resolve);
      } else if (db) {
        db.serialize(() => {
          db?.run(`CREATE TABLE IF NOT EXISTS anwaerter (id TEXT PRIMARY KEY, name TEXT, groupId TEXT, active INTEGER DEFAULT 1)`);
          db?.run(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, completedStations TEXT, currentStation TEXT, status TEXT, lastStatusChange INTEGER, paused INTEGER DEFAULT 0, active INTEGER DEFAULT 1)`);
          db?.run(`CREATE TABLE IF NOT EXISTS stations (id TEXT PRIMARY KEY, name TEXT, active INTEGER, multiplier INTEGER, targetAvgDuration REAL DEFAULT 15.0)`);
          db?.run(`CREATE TABLE IF NOT EXISTS sub_stations (id TEXT PRIMARY KEY, parentId TEXT, examiner TEXT, paused INTEGER, currentGroupId TEXT, token TEXT, startTime INTEGER, active INTEGER DEFAULT 1, reservedGroupId TEXT, deviceToken TEXT)`);
          db?.run(`CREATE TABLE IF NOT EXISTS logs (timestamp INTEGER, groupName TEXT, stationId TEXT, durationMinutes REAL, cancelled INTEGER DEFAULT 0, examiner TEXT)`);
          db?.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
          db?.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, endpoint TEXT UNIQUE, keys_p256dh TEXT, keys_auth TEXT, role TEXT, targetId TEXT, os TEXT DEFAULT 'android', timestamp INTEGER)`);

          db?.run('ALTER TABLE groups ADD COLUMN paused INTEGER DEFAULT 0', () => {});
          db?.run('ALTER TABLE groups ADD COLUMN active INTEGER DEFAULT 1', () => {});
          db?.run('ALTER TABLE anwaerter ADD COLUMN active INTEGER DEFAULT 1', () => {});
          db?.run('ALTER TABLE logs ADD COLUMN cancelled INTEGER DEFAULT 0', () => {});
          db?.run('ALTER TABLE logs ADD COLUMN examiner TEXT', () => {});
          db?.run('ALTER TABLE sub_stations ADD COLUMN active INTEGER DEFAULT 1', () => {});
          db?.run('ALTER TABLE sub_stations ADD COLUMN reservedGroupId TEXT', () => {});
          db?.run('ALTER TABLE sub_stations ADD COLUMN deviceToken TEXT', () => {});
          db?.run('ALTER TABLE stations ADD COLUMN targetAvgDuration REAL DEFAULT 15.0', () => {});
          db?.run("ALTER TABLE push_subscriptions ADD COLUMN os TEXT DEFAULT 'android'", () => {});

          loadStateFromDb(dbPath, jsonBackupPath, systemState, getUniqueTimestamp).then(resolve);
        });
      }
    });
  });
}

/**
 * Lädt den gesamten Systemzustand aus dem Speicher (SQLite oder JSON-Fallback) in den RAM.
 * @param {string} dbPath - Pfad zur SQLite-Datenbankdatei.
 * @param {string} jsonBackupPath - Pfad zur JSON-Backup-Datei (Fallback).
 * @param {SystemState} systemState - Der zu befüllende In-Memory-Systemzustand.
 * @param {function(): number} getUniqueTimestamp - Funktion zur Generierung von Zeitstempeln.
 * @returns {Promise<void>}
 */
export async function loadStateFromDb(
  dbPath: string,
  jsonBackupPath: string,
  systemState: SystemState,
  getUniqueTimestamp: () => number
): Promise<void> {
  if (useJsonFallback) {
    dbFallback.loadJsonFallback(jsonBackupPath, systemState, getUniqueTimestamp);
  } else {
    try {
      const aRows = await dbAll<Anwaerter & { active: number }>('SELECT * FROM anwaerter');
      const gRows = await dbAll<{ id: string; name: string; completedStations: string; currentStation: string | null; status: string; lastStatusChange: number; paused: number; active: number }>('SELECT * FROM groups');
      const sRows = await dbAll<{ id: string; name: string; active: number; multiplier: number; targetAvgDuration?: number }>('SELECT * FROM stations');

      const hasAnwaerter = aRows && aRows.length > 0;
      const hasGroups = gRows && gRows.length > 0;
      const hasStations = sRows && sRows.length > 0;

      if (!hasAnwaerter && !hasGroups && !hasStations) {
        return;
      }

      (aRows || []).forEach((r) => {
        systemState.anwaerter[r.id] = { ...r, active: r.active !== 0 };
      });

      (gRows || []).forEach((r) => {
        let completed: string[] = [];
        try {
          completed = JSON.parse(r.completedStations || '[]');
        } catch (e) {
          console.error(`[Warnung] completedStations für Gruppe ${r.id} korrupt, weiche auf leeres Array aus.`);
        }
        systemState.groups[r.id] = {
          ...r,
          completedStations: completed,
          paused: r.paused === 1,
          active: r.active !== 0,
          lastStatusChange: (r.lastStatusChange && !Number.isNaN(r.lastStatusChange)) ? r.lastStatusChange : getUniqueTimestamp(),
          members: [],
        };
      });

      Object.keys(systemState.anwaerter || {}).forEach((aId) => {
        const candidate = systemState.anwaerter[aId];
        if (candidate.groupId && systemState.groups[candidate.groupId]) {
          const targetGroup = systemState.groups[candidate.groupId];
          if (!targetGroup.members) {
            targetGroup.members = [];
          }
          if (!targetGroup.members.includes(candidate.name)) {
            targetGroup.members.push(candidate.name);
          }
        }
      });

      (sRows || []).forEach((r) => {
        systemState.stations[r.id] = {
          id: r.id,
          name: r.name,
          active: r.active === 1,
          multiplier: r.multiplier,
          targetAvgDuration: r.targetAvgDuration || 15.0,
          subStations: {},
        };
      });

      const subRows = await dbAll<SubStation & { parentId: string; paused: number; active: number }>('SELECT * FROM sub_stations');
      (subRows || []).forEach((r) => {
        if (systemState.stations[r.parentId]) {
          systemState.stations[r.parentId].subStations[r.id] = {
            ...r,
            paused: r.paused === 1,
            active: r.active !== 0,
            reservedGroupId: r.reservedGroupId || null,
            deviceToken: r.deviceToken || null,
          };
        }
      });

      const logRows = await dbAll<LogEntry & { cancelled: number }>('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 1000');
      const loadedLogs: LogEntry[] = (logRows || []).map((r) => ({
        ...r,
        cancelled: r.cancelled === 1,
        examiner: r.examiner || '',
      })).reverse();

      systemState.logs = loadedLogs;

      const maxRow = await dbGet<{ maxTs: number }>('SELECT MAX(timestamp) as maxTs FROM logs');
      lastSavedLogTimestamp = (maxRow && maxRow.maxTs) ? maxRow.maxTs : 0;

      const autoAllocationRow = await dbGet<{ value: string }>("SELECT value FROM meta WHERE key = 'auto_allocation_active'");
      if (autoAllocationRow) {
        systemState.autoAllocationActive = autoAllocationRow.value === '1';
      }

      const firstAssignmentRow = await dbGet<{ value: string }>("SELECT value FROM meta WHERE key = 'first_assignment_time'");
      if (firstAssignmentRow && firstAssignmentRow.value) {
        systemState.firstAssignmentTime = parseInt(firstAssignmentRow.value, 10);
      }

      const settingsRow = await dbGet<{ value: string }>("SELECT value FROM meta WHERE key = 'system_settings'");
      if (settingsRow && settingsRow.value) {
        try {
          systemState.settings = JSON.parse(settingsRow.value);
        } catch (e) {
          console.error('[System-IO] Fehler beim Lesen der System-Einstellungen aus SQLite meta:', e);
        }
      }

      console.log('[System-IO] Systemzustand aus SQLite-Datenbank geladen.');
    } catch (err) {
      const error = err as Error;
      console.error('[System-IO] Fehler beim Laden aus SQLite, verwende JSON-Fallback:', error.message);
      useJsonFallback = true;
      await loadStateFromDb(dbPath, jsonBackupPath, systemState, getUniqueTimestamp);
    }
  }
}

/**
 * Planer für asynchronen Speichervorgang.
 * @param {string} dbPath - Pfad zur SQLite-Datenbankdatei.
 * @param {string} jsonBackupPath - Pfad zur JSON-Backup-Datei.
 * @param {SystemState} systemState - Der zu speichernde Systemzustand.
 * @param {function(): number} getUniqueTimestamp - Funktion zur Generierung von Zeitstempeln.
 * @returns {void}
 */
export function scheduleStateSave(
  dbPath: string,
  jsonBackupPath: string,
  systemState: SystemState,
  getUniqueTimestamp: () => number
): void {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveStateToStorage(dbPath, jsonBackupPath, systemState, getUniqueTimestamp);
    saveTimeout = null;
  }, 3000);
}

/**
 * Übernimmt die Ablaufsteuerung des physischen Speichervorgangs.
 * @param {string} dbPath - Pfad zur SQLite-Datenbankdatei.
 * @param {string} jsonBackupPath - Pfad zur JSON-Backup-Datei.
 * @param {SystemState} systemState - Der zu speichernde Systemzustand.
 * @param {function(): number} getUniqueTimestamp - Funktion zur Generierung von Zeitstempeln.
 * @returns {void}
 */
export function saveStateToStorage(
  dbPath: string,
  jsonBackupPath: string,
  systemState: SystemState,
  getUniqueTimestamp: () => number
): void {
  if (isSaving) {
    savePending = true;
    return;
  }
  isSaving = true;
  savePending = false;

  saveStateToStoragePromise(dbPath, jsonBackupPath, systemState)
    .then(() => {
      isSaving = false;
      saveRetryCount = 0;
      if (savePending) {
        saveStateToStorage(dbPath, jsonBackupPath, systemState, getUniqueTimestamp);
      }
    })
    .catch((err: Error) => {
      isSaving = false;
      saveRetryCount += 1;
      console.error(`[System-IO] Fehler beim Sichern des Systemzustands (${saveRetryCount}/${MAX_SAVE_RETRIES}):`, err.message);

      if (saveRetryCount >= MAX_SAVE_RETRIES) {
        if (!useJsonFallback) {
          useJsonFallback = true;
          saveRetryCount = 0;
          saveStateToStoragePromise(dbPath, jsonBackupPath, systemState)
            .then(() => {
              isSaving = false;
              if (savePending) {
                saveStateToStorage(dbPath, jsonBackupPath, systemState, getUniqueTimestamp);
              }
            })
            .catch(() => {
              isSaving = false;
              savePending = false;
              saveRetryCount = 0;
            });
          return;
        }
        savePending = false;
        saveRetryCount = 0;
        return;
      }

      if (savePending) {
        setTimeout(() => {
          saveStateToStorage(dbPath, jsonBackupPath, systemState, getUniqueTimestamp);
        }, 1000);
      }
    });
}

/**
 * Führt das physische Schreiben des Arbeitsspeicherzustands synchronisiert aus.
 * @param {string} dbPath - Pfad zur SQLite-Datenbankdatei.
 * @param {string} jsonBackupPath - Pfad zur JSON-Backup-Datei.
 * @param {SystemState} systemState - Der zu speichernde Systemzustand.
 * @returns {Promise<void>}
 */
export function saveStateToStoragePromise(
  dbPath: string,
  jsonBackupPath: string,
  systemState: SystemState
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (dbFallback.isSystemStateEmpty(systemState) && !systemState.isCleared) {
      console.warn('[System-IO] Sicherheits-Schutz: Zustand im Speicher ist leer. Physisches Schreiben übersprungen (Empty Save Guard aktiv).');
      resolve();
      return;
    }

    const clonedState = structuredClone(systemState);

    if (useJsonFallback) {
      try {
        dbFallback.saveJsonFallback(jsonBackupPath, clonedState, systemState);
        resolve();
      } catch (e) {
        reject(e);
      }
    } else {
      if (!db) {
        resolve();
        return;
      }

      let hasError = false;
      const checkErr = (err: Error | null) => {
        if (err) hasError = true;
      };

      db.serialize(() => {
        db?.run('BEGIN TRANSACTION', checkErr);

        const anwaerterIds = Object.keys(clonedState.anwaerter || {});
        Object.keys(clonedState.anwaerter || {}).forEach((id) => {
          const a = clonedState.anwaerter[id];
          db?.run(
            'INSERT OR REPLACE INTO anwaerter (id, name, groupId, active) VALUES (?, ?, ?, ?)',
            [id, a.name, a.groupId, a.active !== false ? 1 : 0],
            checkErr
          );
        });
        if (anwaerterIds.length > 0) {
          const placeholders = anwaerterIds.map(() => '?').join(',');
          db?.run(`DELETE FROM anwaerter WHERE id NOT IN (${placeholders})`, anwaerterIds, checkErr);
        } else {
          db?.run('DELETE FROM anwaerter', checkErr);
        }

        const groupIds = Object.keys(clonedState.groups || {});
        Object.keys(clonedState.groups || {}).forEach((id) => {
          const g = clonedState.groups[id];
          db?.run(
            'INSERT OR REPLACE INTO groups (id, name, completedStations, currentStation, status, lastStatusChange, paused, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [id, g.name, JSON.stringify(g.completedStations || []), g.currentStation, g.status, g.lastStatusChange, g.paused ? 1 : 0, g.active !== false ? 1 : 0],
            checkErr
          );
        });
        if (groupIds.length > 0) {
          const placeholders = groupIds.map(() => '?').join(',');
          db?.run(`DELETE FROM groups WHERE id NOT IN (${placeholders})`, groupIds, checkErr);
        } else {
          db?.run('DELETE FROM groups', checkErr);
        }

        const stationIds = Object.keys(clonedState.stations || {});
        const subStationIds: string[] = [];
        Object.keys(clonedState.stations || {}).forEach((id) => {
          const s = clonedState.stations[id];
          db?.run(
            'INSERT OR REPLACE INTO stations (id, name, active, multiplier, targetAvgDuration) VALUES (?, ?, ?, ?, ?)',
            [id, s.name, s.active ? 1 : 0, s.multiplier, s.targetAvgDuration || 15.0],
            checkErr
          );
          if (s.subStations) {
            Object.keys(s.subStations).forEach((subId) => {
              const sub = s.subStations[subId];
              subStationIds.push(sub.id);
              db?.run(
                'INSERT OR REPLACE INTO sub_stations (id, parentId, examiner, paused, currentGroupId, token, startTime, active, reservedGroupId, deviceToken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [sub.id, sub.parentId, sub.examiner, sub.paused ? 1 : 0, sub.currentGroupId, sub.token, sub.startTime, sub.active !== false ? 1 : 0, sub.reservedGroupId || null, sub.deviceToken || null],
                checkErr
              );
            });
          }
        });
        if (stationIds.length > 0) {
          const placeholders = stationIds.map(() => '?').join(',');
          db?.run(`DELETE FROM stations WHERE id NOT IN (${placeholders})`, stationIds, checkErr);
        } else {
          db?.run('DELETE FROM stations', checkErr);
        }
        if (subStationIds.length > 0) {
          const placeholders = subStationIds.map(() => '?').join(',');
          db?.run(`DELETE FROM sub_stations WHERE id NOT IN (${placeholders})`, subStationIds, checkErr);
        } else {
          db?.run('DELETE FROM sub_stations', checkErr);
        }

        const currentLogs = clonedState.logs || [];
        if (currentLogs.length === 0) {
          db?.run('DELETE FROM logs', checkErr);
          lastSavedLogTimestamp = 0;
        } else {
          const newLogs = currentLogs.filter((l) => l.timestamp > lastSavedLogTimestamp);
          newLogs.forEach((log) => {
            db?.run(
              'INSERT INTO logs (timestamp, groupName, stationId, durationMinutes, cancelled, examiner) VALUES (?, ?, ?, ?, ?, ?)',
              [log.timestamp, log.groupName, log.stationId, log.durationMinutes, log.cancelled ? 1 : 0, log.examiner || ''],
              checkErr
            );
          });

          if (clonedState.pendingLogCancellations && clonedState.pendingLogCancellations.length > 0) {
            clonedState.pendingLogCancellations.forEach((ts) => {
              db?.run('UPDATE logs SET cancelled = 1 WHERE timestamp = ? AND cancelled = 0', [ts], checkErr);
            });
          }
        }

        db?.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['auto_allocation_active', clonedState.autoAllocationActive ? '1' : '0'], checkErr);
        db?.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['first_assignment_time', clonedState.firstAssignmentTime ? clonedState.firstAssignmentTime.toString() : ''], checkErr);
        if (clonedState.settings) {
          db?.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['system_settings', JSON.stringify(clonedState.settings)], checkErr);
        }

        db?.run('SELECT 1', () => {
          if (hasError) {
            db?.run('ROLLBACK', () => {
              reject(new Error('SQLite save transaction rolled back.'));
            });
          } else {
            db?.run('COMMIT', (commitErr) => {
              if (commitErr) {
              db?.run('ROLLBACK', () => {
                reject(commitErr);
              });
            } else {
              if (clonedState.logs.length > 0) {
                lastSavedLogTimestamp = clonedState.logs.reduce((max, l) => (l.timestamp > max ? l.timestamp : max), 0);
              }
              systemState.isCleared = false;
                const processedCancellations = clonedState.pendingLogCancellations || [];
                systemState.pendingLogCancellations = (systemState.pendingLogCancellations || []).filter(
                  (ts) => !processedCancellations.includes(ts)
                );

                if (systemState.logs.length > 1000) {
                  systemState.logs = systemState.logs.slice(-1000);
                }
                resolve();
              }
            });
          }
        });
      });
    }
  });
}
