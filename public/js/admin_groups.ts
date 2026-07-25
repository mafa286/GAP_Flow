// Version Tracker: public/js/admin_groups.ts (GAP-Flow v1.1.4)

interface ClientAnwaerter {
  id: string;
  name: string;
  groupId: string | null;
  active: boolean;
}

interface ClientGroup {
  id: string;
  name: string;
  members: string[];
  completedStations: string[];
  currentStation: string | null;
  status: string;
  paused: boolean;
  active: boolean;
  lastStatusChange: number;
}

interface AdminGroupsComponent {
  anwaerter: Record<string, ClientAnwaerter>;
  groups: Record<string, ClientGroup>;
  newAnwaerterName: string;
  newGroupName: string;
  selectedAnwaerterIds: string[];
  autoAllocationActive: boolean;
  renderLock: boolean;
  isSubmitting: boolean;
  password: string;
  _cachedSortedGroups: ClientGroup[] | null;
  _cachedSortedAnwaerter: ClientAnwaerter[] | null;

  get sortedGroups(): ClientGroup[];
  get sortedAnwaerter(): ClientAnwaerter[];
  initSocket(): void;
  isMemberActive(memberName: string): boolean;
  isAnyGroupActiveAndNotPaused(): boolean;
  toggleAllGroupsPause(): Promise<void>;
  getNextGroupDefaultName(): string;
  updateDefaultGroupName(): void;
  clearAllAnwaerter(): Promise<void>;
  addAnwaerter(): Promise<void>;
  handleCSVImport(event: Event): void;
  toggleAnwaerterActive(id: string, state: boolean): Promise<void>;
  createGroup(): Promise<void>;
  toggleGroupPause(id: string): Promise<void>;
  toggleGroupActive(id: string, state: boolean): Promise<void>;
  dissolveGroup(id: string): Promise<void>;
  connectSocket(
    callback: (state: {
      anwaerter: Record<string, ClientAnwaerter>;
      groups: Record<string, ClientGroup>;
      autoAllocationActive: boolean;
    }) => void
  ): void;
}

window.adminPanel = function (): Record<string, unknown> {
  if (typeof window.createAdminPanel !== 'function') {
    return {};
  }

  return window.createAdminPanel({
    anwaerter: {},
    groups: {},
    newAnwaerterName: '',
    newGroupName: '',
    selectedAnwaerterIds: [],
    autoAllocationActive: false,
    renderLock: false,
    _cachedSortedGroups: null,
    _cachedSortedAnwaerter: null,

    get sortedGroups(): ClientGroup[] {
      const self = this as unknown as AdminGroupsComponent;
      if (self.renderLock && self._cachedSortedGroups) {
        return self._cachedSortedGroups;
      }
      const list = Object.values(self.groups || {}).sort((a, b) =>
        a.name.localeCompare(b.name, 'de', { numeric: true })
      );
      self._cachedSortedGroups = list;
      return list;
    },

    get sortedAnwaerter(): ClientAnwaerter[] {
      const self = this as unknown as AdminGroupsComponent;
      if (self.renderLock && self._cachedSortedAnwaerter) {
        return self._cachedSortedAnwaerter;
      }
      const list = Object.values(self.anwaerter || {}).sort((a, b) =>
        a.name.localeCompare(b.name, 'de', { numeric: true })
      );
      self._cachedSortedAnwaerter = list;
      return list;
    },

    initSocket(): void {
      const self = this as unknown as AdminGroupsComponent;
      self.connectSocket((state) => {
        self._cachedSortedGroups = null;
        self._cachedSortedAnwaerter = null;
        self.renderLock = true;

        self.anwaerter = state.anwaerter;
        self.groups = state.groups;
        self.autoAllocationActive = state.autoAllocationActive;
        self.updateDefaultGroupName();

        setTimeout(() => {
          self.renderLock = false;
        }, 0);
      });
    },

    isMemberActive(memberName: string): boolean {
      const self = this as unknown as AdminGroupsComponent;
      if (!self.anwaerter) return true;
      const candidate = Object.values(self.anwaerter).find((a) => a.name === memberName);
      return candidate ? candidate.active !== false : true;
    },

    isAnyGroupActiveAndNotPaused(): boolean {
      const self = this as unknown as AdminGroupsComponent;
      return Object.values(self.groups || {}).some((g) => g.active !== false && !g.paused);
    },

    async toggleAllGroupsPause(): Promise<void> {
      const self = this as unknown as AdminGroupsComponent;
      const targetState = self.isAnyGroupActiveAndNotPaused();
      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/groups/pause_all', {
          method: 'PUT',
          headers: {
            Authorization: self.password,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ paused: targetState }),
        });
        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `HTTP Status ${response.status}`);
        }
      } catch (e) {
        const error = e as Error;
        console.error(error);
        alert(`Fehler bei zentraler Pausensteuerung: ${error.message}`);
      } finally {
        self.isSubmitting = false;
      }
    },

    getNextGroupDefaultName(): string {
      const self = this as unknown as AdminGroupsComponent;
      let maxNum = 0;
      const pattern = /^Heros\s+(\d+)$/i;

      Object.values(self.groups || {}).forEach((g) => {
        const match = g.name.trim().match(pattern);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) {
            maxNum = num;
          }
        }
      });

      const nextNum = maxNum + 1;
      const paddedNum = nextNum.toString().padStart(2, '0');
      return `Heros ${paddedNum}`;
    },

    updateDefaultGroupName(): void {
      const self = this as unknown as AdminGroupsComponent;
      const activeEl = document.activeElement;
      const isTypingGroupName =
        activeEl && activeEl.tagName === 'INPUT' && activeEl.hasAttribute('data-group-name-input');
      if (isTypingGroupName) return;

      if (!self.newGroupName || self.newGroupName.trim() === '') {
        self.newGroupName = self.getNextGroupDefaultName();
      }
    },

    async clearAllAnwaerter(): Promise<void> {
      const self = this as unknown as AdminGroupsComponent;
      if (
        !confirm(
          'ACHTUNG: Dies löscht alle registrierten Anwärter, gebildeten Gruppen und das Verlaufsprotokoll unwiderruflich!\n\nIhre angelegten Stationen und Prüfernamen bleiben vollständig erhalten.\n\nMöchten Sie alle Anwärter & Gruppen jetzt löschen?'
        )
      ) {
        return;
      }
      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/anwaerter/clear', {
          method: 'POST',
          headers: { Authorization: self.password },
        });
        if (!response.ok) {
          throw new Error(`HTTP Status ${response.status}`);
        }
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler: Das Löschen der Anwärter ist fehlgeschlagen. Bitte Verbindung prüfen.');
      } finally {
        self.isSubmitting = false;
      }
    },

    async addAnwaerter(): Promise<void> {
      const self = this as unknown as AdminGroupsComponent;
      if (!self.newAnwaerterName) return;
      self.isSubmitting = true;
      try {
        const response = await fetch('/api/admin/anwaerter', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: self.newAnwaerterName }),
        });
        if (!response.ok) {
          throw new Error(`HTTP Status ${response.status}`);
        }
        self.newAnwaerterName = '';
      } catch (e) {
        console.error(e);
        alert('Netzwerk-Fehler: Der Anwärter konnte nicht registriert werden. Bitte Verbindung prüfen.');
      } finally {
        self.isSubmitting = false;
      }
    },

    handleCSVImport(event: Event): void {
      const self = this as unknown as AdminGroupsComponent;
      const targetInput = event.target as HTMLInputElement | null;
      if (!targetInput || !targetInput.files || targetInput.files.length === 0) return;

      const file = targetInput.files[0];

      if (window.gapFlowUtils) {
        window.gapFlowUtils.parseCSVFile(
          file,
          async (rows: unknown[][]) => {
            const namesToImport: string[] = [];
            let isFirstLine = true;

            rows.forEach((row) => {
              const cols = (row as string[]).map((c) => (c ? String(c).trim() : ''));
              if (cols.length === 0 || cols.every((c) => c === '')) return;

              const firstColLower = cols[0].toLowerCase();
              if (
                isFirstLine &&
                (firstColLower.includes('vorname') ||
                  firstColLower.includes('nachname') ||
                  firstColLower.includes('name'))
              ) {
                isFirstLine = false;
                return;
              }
              isFirstLine = false;

              if (cols.length >= 2) {
                const vorname = cols[0];
                const nachname = cols[1];
                if (vorname && nachname) {
                  namesToImport.push(`${nachname}, ${vorname}`);
                } else if (vorname || nachname) {
                  namesToImport.push(vorname || nachname);
                }
              } else if (cols.length === 1 && cols[0]) {
                namesToImport.push(cols[0]);
              }
            });

            if (namesToImport.length > 0) {
              if (
                confirm(
                  `ACHTUNG: Dieser Import löscht alle bisherigen Demo-Daten, gebildeten Gruppen und Logs unwiderruflich, um das System sauber aufzubauen! Möchten Sie diese ${namesToImport.length} echten Anwärter jetzt importieren?`
                )
              ) {
                const res = await fetch('/api/admin/anwaerter/batch', {
                  method: 'POST',
                  headers: {
                    Authorization: self.password,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ names: namesToImport }),
                });

                if (res.ok) {
                  const data = (await res.json().catch(() => ({}))) as { count?: number; duplicatesIgnored?: number };
                  let msg = `Das System wurde gereinigt und ${data.count || 0} Anwärter erfolgreich importiert.`;
                  if (data.duplicatesIgnored && data.duplicatesIgnored > 0) {
                    msg += ` (${data.duplicatesIgnored} Duplikate wurden ignoriert)`;
                  }
                  alert(msg);
                  self.newGroupName = '';
                } else {
                  alert('Fehler beim Massen-Import.');
                }
              }
            } else {
              alert('Keine gültigen Datensätze in der CSV-Datei gefunden.');
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

    async toggleAnwaerterActive(id: string, state: boolean): Promise<void> {
      const self = this as unknown as AdminGroupsComponent;
      self.isSubmitting = true;
      try {
        const response = await fetch(`/api/admin/anwaerter/${id}/toggle_active`, {
          method: 'PUT',
          headers: {
            Authorization: self.password,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ active: state }),
        });
        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `HTTP Status ${response.status}`);
        }
      } catch (e) {
        const error = e as Error;
        console.error(error);
        alert(`Fehler bei Anwärter-Aktivierung: ${error.message}`);
      } finally {
        self.isSubmitting = false;
      }
    },

    async createGroup(): Promise<void> {
      const self = this as unknown as AdminGroupsComponent;
      if (!self.newGroupName || self.selectedAnwaerterIds.length === 0) return;
      self.isSubmitting = true;

      const groupNameToCreate = self.newGroupName;
      const anwaerterIdsToCreate = [...self.selectedAnwaerterIds];

      self.newGroupName = '';
      self.selectedAnwaerterIds = [];

      try {
        const response = await fetch('/api/admin/groups', {
          method: 'POST',
          headers: { Authorization: self.password, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: groupNameToCreate, anwaerterIds: anwaerterIdsToCreate }),
        });
        if (!response.ok) {
          throw new Error(`HTTP Status ${response.status}`);
        }
      } catch (e) {
        console.error(e);
        self.newGroupName = groupNameToCreate;
        self.selectedAnwaerterIds = anwaerterIdsToCreate;
        alert('Netzwerk-Fehler: Gruppe konnte nicht erstellt werden. Bitte Verbindung prüfen.');
      } finally {
        self.isSubmitting = false;
      }
    },

    async toggleGroupPause(id: string): Promise<void> {
      const self = this as unknown as AdminGroupsComponent;
      const group = self.groups[id];
      if (!group) return;
      const targetState = !group.paused;
      self.isSubmitting = true;
      try {
        const response = await fetch(`/api/admin/groups/${id}/pause`, {
          method: 'PUT',
          headers: {
            Authorization: self.password,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ paused: targetState }),
        });
        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `HTTP Status ${response.status}`);
        }
      } catch (e) {
        const error = e as Error;
        console.error(error);
        alert(`Fehler bei Gruppen-Pause: ${error.message}`);
      } finally {
        self.isSubmitting = false;
      }
    },

    async toggleGroupActive(id: string, state: boolean): Promise<void> {
      const self = this as unknown as AdminGroupsComponent;
      self.isSubmitting = true;
      try {
        const response = await fetch(`/api/admin/groups/${id}/toggle_active`, {
          method: 'PUT',
          headers: {
            Authorization: self.password,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ active: state }),
        });
        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `HTTP Status ${response.status}`);
        }
      } catch (e) {
        const error = e as Error;
        console.error(error);
        alert(`Fehler bei Gruppen-Aktivierung: ${error.message}`);
      } finally {
        self.isSubmitting = false;
      }
    },

    async dissolveGroup(id: string): Promise<void> {
      const self = this as unknown as AdminGroupsComponent;
      if (!confirm('Möchten Sie diese Gruppe wirklich auflösen? Die zugewiesenen Anwärter werden wieder freigegeben.')) {
        return;
      }
      self.isSubmitting = true;
      try {
        const response = await fetch(`/api/admin/groups/${id}/dissolve`, {
          method: 'POST',
          headers: { Authorization: self.password },
        });
        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `HTTP Status ${response.status}`);
        }
      } catch (e) {
        const error = e as Error;
        console.error(error);
        alert(`Fehler beim Auflösen der Gruppe: ${error.message}`);
      } finally {
        self.isSubmitting = false;
      }
    },
  });
};