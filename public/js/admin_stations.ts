interface ClientSubStation {
  id: string;
  parentId: string;
  examiner: string;
  paused: boolean;
  currentGroupId: string | null;
  token: string;
  startTime: number | null;
  active?: boolean;
  deviceToken?: string | null;
  reservedGroupId?: string | null;
}

interface ClientStation {
  id: string;
  name: string;
  active: boolean;
  multiplier: number;
  subStations: Record<string, ClientSubStation>;
}

interface ExtendedSubStation extends ClientSubStation {
  activeGroup: { id: string; name: string } | null;
}

interface ExtendedStation extends ClientStation {
  subList: ExtendedSubStation[];
}

interface AdminStationsComponent {
  stations: Record<string, ClientStation>;
  groups: Record<string, { id: string; name: string; status: string; completedStations: string[] }>;
  newStationName: string;
  autoAllocationActive: boolean;
  renderLock: boolean;
  isSubmitting: boolean;
  password: string;
  _cachedStationList: ExtendedStation[] | null;
  showManualAssignPopup: boolean;
  popupManualAssignGroupId: string;
  showExaminerPopup: boolean;
  popupExaminerName: string;
  popupSubId: string;
  popupMasterId: string;
  showReservationPopup: boolean;
  popupReservationGroupId: string;
  showAddLogPopup: boolean;
  popupAddLogGroupId: string;
  showRevertLogPopup: boolean;
  popupRevertLogGroupId: string;

  get stationDetailsList(): ExtendedStation[];
  initSocket(): void;
  clearAllStations(): Promise<void>;
  addStation(): Promise<void>;
  addSubStation(id: string, currentMultiplier: number): Promise<void>;
  toggleSubActive(id: string, subId: string, active: boolean): Promise<void>;
  handleCSVImport(event: Event): void;
  connectSocket(
    callback: (state: {
      groups: Record<string, { id: string; name: string; status: string; completedStations: string[] }>;
      stations: Record<string, ClientStation>;
      autoAllocationActive: boolean;
    }) => void
  ): void;
}

window.adminPanel = function (): Record<string, unknown> {
  const coreConfig = {
    stations: {},
    groups: {},
    newStationName: 'Station',
    autoAllocationActive: false,
    renderLock: false,
    _cachedStationList: null,
    showManualAssignPopup: false,
    popupManualAssignGroupId: '',
    showExaminerPopup: false,
    popupExaminerName: '',
    popupSubId: '',
    popupMasterId: '',
    showReservationPopup: false,
    popupReservationGroupId: '',
    showAddLogPopup: false,
    popupAddLogGroupId: '',
    showRevertLogPopup: false,
    popupRevertLogGroupId: '',

    get stationDetailsList(): ExtendedStation[] {
        const self = this as unknown as AdminStationsComponent;
        if (self.renderLock && self._cachedStationList) {
          return self._cachedStationList;
        }
        const list = Object.values(self.stations || {})
          .map((st) => {
            const subList = Object.values(st.subStations || {})
              .map((sub) => ({
                ...sub,
                activeGroup:
                  sub.currentGroupId && self.groups[sub.currentGroupId]
                    ? self.groups[sub.currentGroupId]
                    : null,
              }))
              .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

            return {
              ...st,
              subList,
            };
          })
          .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

        self._cachedStationList = list;
        return list;
      },

      initSocket(): void {
      const self = this as unknown as AdminStationsComponent & { fetchAdminStatus(): Promise<any> };

      // 1. Sofortiger HTTP REST Load für 100 % Lade-Garantie
      self.fetchAdminStatus().then((state) => {
        if (state) {
          self._cachedStationList = null;
          self.groups = state.groups || {};
          self.stations = state.stations || {};
          self.autoAllocationActive = !!state.autoAllocationActive;
        }
      });

      // 2. WebSocket Live-Stream für Echtzeit-Updates
      self.connectSocket((state) => {
        self._cachedStationList = null;
        const cleanState = JSON.parse(JSON.stringify(state));

        self.renderLock = true;
        self.groups = cleanState.groups || {};
        self.autoAllocationActive = !!cleanState.autoAllocationActive;
        self.stations = cleanState.stations || {};

        setTimeout(() => {
          self._cachedStationList = null;
          self.renderLock = false;
        }, 0);
      });
    },

    /**
     * Löscht alle registrierten Stationen nach Bestätigung über das API-Back-End.
     * @returns {Promise<void>}
     */
    async clearAllStations(): Promise<void> {
      const self = this as unknown as AdminStationsComponent;
      if (
        !confirm(
          'ACHTUNG: Dies löscht alle Stationen, Unterstationen und das Verlaufsprotokoll unwiderruflich!\n\nIhre registrierten Anwärter und Gruppen bleiben vollständig erhalten und werden auf den Startzustand zurückgesetzt.\n\nMöchten Sie alle Stationen jetzt löschen?'
        )
      ) {
        return;
      }
      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/stations/clear', {
          method: 'POST',
          headers: { Authorization: self.password },
        });
        if (!response.ok) {
          throw new Error(`HTTP Status ${response.status}`);
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler: Das Löschen der Stationen ist fehlgeschlagen. Bitte Verbindung prüfen.');
      } finally {
        self.isSubmitting = false;
      }
    },

    /**
     * Erstellt eine neue Hauptstation über die REST-API.
     * @returns {Promise<void>}
     */
    async addStation(): Promise<void> {
      const self = this as unknown as AdminStationsComponent;
      if (self.isSubmitting) return;
      if (!self.newStationName) return;
      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/stations', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: self.newStationName }),
        });
        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `HTTP Status ${response.status}`);
        }
        self.newStationName = 'Station';
      } catch (e) {
        const error = e as Error;
        console.error(error);
        alert(`Fehler beim Anlegen der Station: ${error.message}`);
      } finally {
        self.isSubmitting = false;
      }
    },

    async addSubStation(id: string, currentMultiplier: number): Promise<void> {
      const self = this as unknown as AdminStationsComponent;
      if (self.isSubmitting) return;
      if (currentMultiplier >= 5) return;
      const nextMultiplier = currentMultiplier + 1;
      self.isSubmitting = true;
      try {
        const response = await fetch(`/api/admin/stations/${id}`, {
          method: 'PUT',
          headers: {
            Authorization: self.password,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ multiplier: nextMultiplier }),
        });
        if (!response.ok) {
          throw new Error(`HTTP Status ${response.status}`);
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler: Die Unterstation konnte nicht hinzugefügt werden. Bitte Verbindung prüfen.');
      } finally {
        self.isSubmitting = false;
      }
    },

    async toggleSubActive(id: string, subId: string, active: boolean): Promise<void> {
      const self = this as unknown as AdminStationsComponent;
      self.isSubmitting = true;
      try {
        const response = await fetch(`/api/admin/stations/${id}/sub_config`, {
          method: 'PUT',
          headers: {
            Authorization: self.password,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ subId, active }),
        });
        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `HTTP Status ${response.status}`);
        }
      } catch (e) {
        const error = e as Error;
        console.error(error);
        alert(`Fehler beim Aktivieren/Deaktivieren: ${error.message}`);
      } finally {
        self.isSubmitting = false;
      }
    },

    handleCSVImport(event: Event): void {
      const self = this as unknown as AdminStationsComponent;
      const targetInput = event.target as HTMLInputElement | null;
      if (!targetInput || !targetInput.files || targetInput.files.length === 0) return;

      const file = targetInput.files[0];

      if (window.gapFlowUtils) {
        window.gapFlowUtils.parseCSVFile(
          file,
          async (rows: unknown[][]) => {
            const stationsMap: Record<string, unknown> = {};
            let isFirstLine = true;

            rows.forEach((row) => {
              const cols = (row as string[]).map((c) => (c ? String(c).trim() : ''));
              if (cols.length === 0 || cols.every((c) => c === '')) return;

              const firstColLower = cols[0].toLowerCase();
              if (
                isFirstLine &&
                (firstColLower.includes('nummer') ||
                  firstColLower.includes('name') ||
                  firstColLower.includes('dauer') ||
                  firstColLower.includes('richtzeit') ||
                  firstColLower.includes('prüfer') ||
                  firstColLower.includes('parallel'))
              ) {
                isFirstLine = false;
                return;
              }
              isFirstLine = false;

              if (cols.length >= 2) {
                const mId = cols[0];
                const rawName = cols[1];

                if (!mId || !rawName) return;

                const rawAvgDuration = cols.length >= 3 ? parseFloat(cols[2].replace(',', '.')) : 15.0;
                const targetAvgDuration = (!Number.isNaN(rawAvgDuration) && rawAvgDuration > 0) ? rawAvgDuration : 15.0;

                const rawMultiplier = cols.length >= 4 ? parseInt(cols[3], 10) : 1;
                const multiplier = (!Number.isNaN(rawMultiplier) && rawMultiplier >= 1 && rawMultiplier <= 5) ? rawMultiplier : 1;

                let displayName = rawName;
                if (!displayName.startsWith(`${mId} -`)) {
                  displayName = `${mId} - ${displayName}`;
                }

                const subStations: Record<string, unknown> = {};
                for (let idx = 1; idx <= multiplier; idx += 1) {
                  const subId = `${mId}.${idx}`;
                  subStations[subId] = {
                    id: subId,
                    parentId: mId,
                    examiner: `Prüfer ${subId}`,
                    paused: true,
                    currentGroupId: null,
                    token: subId,
                    startTime: null,
                  };
                }

                stationsMap[mId] = {
                  id: mId,
                  name: displayName,
                  active: true,
                  multiplier,
                  targetAvgDuration,
                  subStations,
                };
              }
            });

            const stationsToImport = Object.values(stationsMap);

            if (stationsToImport.length > 0) {
              const msg = `ACHTUNG: Dies setzt alle Stationen, Unterstationen und das Verlaufsprotokoll unwiderruflich zurück, um Ihr individuelles Stations-Setup sauber aufzubauen!\n\nIhre registrierten Anwärter und gebildeten Gruppen bleiben vollständig erhalten.\n\nMöchten Sie diese ${stationsToImport.length} Stationen jetzt importieren?`;

              if (confirm(msg)) {
                const res = await fetch('/api/admin/stations/batch', {
                  method: 'POST',
                  headers: {
                    Authorization: self.password,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ stations: stationsToImport }),
                });

                if (res.ok) {
                  const data = (await res.json().catch(() => ({}))) as {
                    count?: number;
                    duplicatesIgnored?: number;
                  };
                  let successMsg = `Das System wurde aktualisiert und ${data.count || 0} Stationen erfolgreich importiert.`;
                  if (data.duplicatesIgnored && data.duplicatesIgnored > 0) {
                    successMsg += ` (${data.duplicatesIgnored} Duplikate wurden ignoriert)`;
                  }
                  alert(successMsg);
                } else {
                  alert('Fehler beim Massen-Import der Stationen.');
                }
              }
            } else {
              alert('Keine gültigen Stations-Datensätze in der CSV-Datei gefunden.');
            }
          },
          (err: Error) => {
            console.error('CSV-Importfehler:', err);
            alert('Fehler beim Lesen oder Verarbeiten der CSV-Datei.');
          }
        );
      }

      targetInput.value = '';
    },
  };

  const popupsConfig = window.adminStationsPopups || {};
  const mergedConfig = Object.defineProperties(
    coreConfig,
    Object.getOwnPropertyDescriptors(popupsConfig)
  ) as Record<string, unknown>;

  if (typeof window.createAdminPanel === 'function') {
    return window.createAdminPanel(mergedConfig);
  }
  return mergedConfig;
};
