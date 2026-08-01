interface CalcRowData {
  id: string;
  name: string;
  avg: string;
  hasLogs: boolean;
  g_rem: number;
  t_active_avg: number;
  n_subs: number;
  total: number;
  endTimeStr: string;
  isOvertime: boolean;
  isWarning: boolean;
}

interface ClientLogEntry {
  timestamp: number;
  groupName: string;
  stationId: string;
  durationMinutes: number;
  examiner: string;
  cancelled?: boolean;
}

interface DashboardStation {
  id: string;
  name: string;
  active: boolean;
  targetAvgDuration?: number;
  stats?: {
    avgDuration: number;
    hasLogs: boolean;
    g_rem: number;
    n_subs: number;
  };
  subStations: Record<string, { currentGroupId: string | null; startTime: number | null }>;
}

interface DashboardGroup {
  id: string;
  name: string;
  active?: boolean;
}

interface AdminDashboardComponent {
  groups: Record<string, DashboardGroup>;
  stations: Record<string, DashboardStation>;
  logs: ClientLogEntry[];
  calcTableData: CalcRowData[];
  autoAllocationActive: boolean;
  targetEndTime: string;
  renderLock: boolean;
  _cachedFilteredLogs: ClientLogEntry[] | null;
  pageLoadTime: number;
  firstAssignmentTime: number | null;
  selectedGroups: string[];
  selectedStations: string[];
  authenticated?: boolean;

  get filteredLogs(): ClientLogEntry[];
  escapeHtml(str: string): string;
  pageInit(): void;
  initSocket(): void;
  saveTargetEndTime(): void;
  initChart(): void;
  updateChart(): void;
  getGroupFilterOptions(): string[];
  getStationFilterOptions(): string[];
  matchesStationFilter(log: ClientLogEntry, stationName: string): boolean;
  getLogText(log: ClientLogEntry): string;
  getLogTimeText(log: ClientLogEntry): string;
  connectSocket(
    callback: (state: {
      groups: Record<string, DashboardGroup>;
      stations: Record<string, DashboardStation>;
      logs: ClientLogEntry[];
      autoAllocationActive: boolean;
      firstAssignmentTime: number | null;
    }) => void
  ): void;
  $nextTick(callback: () => void): void;
}

window.adminPanel = function (): Record<string, unknown> {
  if (typeof window.createAdminPanel !== 'function') {
    return {};
  }

  return window.createAdminPanel({
    groups: {},
    stations: {},
    logs: [],
    calcTableData: [],
    autoAllocationActive: false,
    targetEndTime: '',
    renderLock: false,
    _cachedFilteredLogs: null,
    pageLoadTime: Date.now(),
    firstAssignmentTime: null,
    selectedGroups: [],
    selectedStations: [],

    get filteredLogs(): ClientLogEntry[] {
          const self = this as unknown as AdminDashboardComponent;
          if (self.renderLock && self._cachedFilteredLogs) {
            return self._cachedFilteredLogs;
          }
          let list = [...self.logs];

          if (self.selectedGroups.length > 0) {
            list = list.filter((log) => self.selectedGroups.includes(log.groupName));
          }

          if (self.selectedStations.length > 0) {
            list = list.filter((log) => self.selectedStations.some((stationName) => self.matchesStationFilter(log, stationName)));
          }

          const res = list.sort((a, b) => b.timestamp - a.timestamp);
          self._cachedFilteredLogs = res;
          return res;
        },

        /**
         * Maskiert Sonderzeichen in Zeichenketten zur sicheren HTML-Ausgabe.
         * @param {string} str - Der zu maskierende Text.
         * @returns {string} Maskierte Zeichenkette.
         */
        escapeHtml(str: string): string {
          if (!str) return '';
          return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        },

        pageInit(): void {
      const self = this as unknown as AdminDashboardComponent;
      const storedLimit = localStorage.getItem('target_end_time');
      if (storedLimit) {
        self.targetEndTime = storedLimit;
      }

      setInterval(() => {
        if (self.authenticated && Object.keys(self.stations).length > 0) {
          self.updateChart();
        }
      }, 10000);
    },

    initSocket(): void {
      const self = this as unknown as AdminDashboardComponent & { fetchAdminStatus(): Promise<any> };
      
      // 1. Sofortiger HTTP REST Load
      self.fetchAdminStatus().then((state) => {
        if (state) {
          self._cachedFilteredLogs = null;
          self.groups = state.groups || {};
          self.stations = state.stations || {};
          self.logs = state.logs || [];
          self.autoAllocationActive = !!state.autoAllocationActive;
          self.firstAssignmentTime = state.firstAssignmentTime || null;
          self.$nextTick(() => self.updateChart());
        }
      });

      // 2. WebSocket Live-Stream
      self.connectSocket((state) => {
        self._cachedFilteredLogs = null;
        self.renderLock = true;

        self.groups = state.groups || {};
        self.stations = state.stations || {};
        self.logs = state.logs || [];
        self.autoAllocationActive = !!state.autoAllocationActive;
        self.firstAssignmentTime = state.firstAssignmentTime || null;

        setTimeout(() => {
          self._cachedFilteredLogs = null;
          self.updateChart();
          self.renderLock = false;
        }, 0);
      });
    },

    saveTargetEndTime(): void {
      const self = this as unknown as AdminDashboardComponent;
      if (self.targetEndTime) {
        localStorage.setItem('target_end_time', self.targetEndTime);
      } else {
        localStorage.removeItem('target_end_time');
      }
      self.$nextTick(() => {
        self.updateChart();
      });
    },

    initChart(): void {
      const self = this as unknown as AdminDashboardComponent;
      const canvasElement = document.getElementById('stationsChart');
      if (window.gapFlowChart) {
        window.gapFlowChart.initChart(
          canvasElement,
          self.firstAssignmentTime,
          self.pageLoadTime,
          self.targetEndTime
        );
      }
    },

    updateChart(): void {
      const self = this as unknown as AdminDashboardComponent;
      if (window.gapFlowChart) {
        self.calcTableData = window.gapFlowChart.updateChart(
          Object.values(self.stations),
          self.firstAssignmentTime,
          self.pageLoadTime,
          self.targetEndTime
        );
      }
    },

    getGroupFilterOptions(): string[] {
      const self = this as unknown as AdminDashboardComponent;
      const names = new Set(Object.values(self.groups).map((g) => g.name));
      self.logs.forEach((log) => {
        if (log.durationMinutes !== -3 && log.durationMinutes !== -4 && log.groupName && log.groupName !== 'System') {
          names.add(log.groupName);
        }
      });
      return Array.from(names).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
    },

    getStationFilterOptions(): string[] {
      const self = this as unknown as AdminDashboardComponent;
      const names = new Set(Object.values(self.stations).map((s) => s.name));
      return Array.from(names).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
    },

    matchesStationFilter(log: ClientLogEntry, stationName: string): boolean {
      const self = this as unknown as AdminDashboardComponent;
      const st = Object.values(self.stations).find((s) => s.name === stationName);
      if (!st) return false;
      const logStationId = String(log.stationId || '');
      if (logStationId === st.name) return true;
      if (logStationId && logStationId.split('.')[0] === st.id) return true;
      return false;
    },

    getLogText(log: ClientLogEntry): string {
      const self = this as unknown as AdminDashboardComponent;
      const escGroup = self.escapeHtml(log.groupName);
      const escStation = self.escapeHtml(log.stationId);
      const escExaminer = self.escapeHtml(log.examiner || 'Prüfer');
      const escFallbackExaminer = self.escapeHtml(log.examiner || '—');

      let text = '';
      if (log.durationMinutes === -13) {
        text = `👤 Station <span class="font-bold text-brand">${escStation}</span> (${escGroup}) Prüfer wurde auf <span class="font-extrabold text-brand">${escExaminer}</span> geändert.`;
      } else if (log.durationMinutes === -1) {
        text = `⏸️ Gruppe <span class="font-extrabold" style="color: var(--sig-warning-text) !important;">${escGroup}</span> wurde pausiert.`;
      } else if (log.durationMinutes === -2) {
        text = `▶️ Gruppe <span class="font-extrabold text-brand">${escGroup}</span> wurde wieder reaktiviert.`;
      } else if (log.durationMinutes === -3) {
        text = `⏸️ Unterstation <span class="font-bold" style="color: var(--sig-warning-text) !important;">${escStation}</span> (${escGroup}) wurde pausiert.`;
      } else if (log.durationMinutes === -4) {
        text = `▶️ Unterstation <span class="font-bold text-brand">${escStation}</span> (${escGroup}) wurde reaktiviert.`;
      } else if (log.durationMinutes === -5) {
        text = `⏰ Gruppe <span class="font-extrabold" style="color: var(--sig-warning-text) !important;">${escGroup}</span> wurde nach 30 Min. automatisch reaktiviert.`;
      } else if (log.durationMinutes === -6) {
        text = `🎉 Gruppe <span class="font-extrabold" style="color: var(--sig-success-text) !important;">${escGroup}</span> hat alle Prüfungen erfolgreich beendet!`;
      } else if (log.durationMinutes === -7) {
        const displayStation = escStation.startsWith('Station') ? escStation : `Station ${escStation}`;
        text = `❌ Abschluss für <span class="font-extrabold" style="color: var(--sig-danger-text) !important;">${escGroup}</span> an <span class="font-bold" style="color: var(--sig-danger-text) !important;">${displayStation}</span> wurde storniert!`;
      } else if (log.durationMinutes === -8) {
        text = `🔌 Gruppe <span class="font-extrabold" style="color: var(--sig-warning-text) !important;">${escGroup}</span> wurde manuell Unterstation <span class="font-bold" style="color: var(--sig-warning-text) !important;">${escStation}</span> zugewiesen (Prüfer: ${escFallbackExaminer}).`;
      } else if (log.durationMinutes === -9) {
        text = `🚫 Zuweisung für Gruppe <span class="font-extrabold" style="color: var(--sig-danger-text) !important;">${escGroup}</span> an Unterstation <span class="font-bold" style="color: var(--sig-danger-text) !important;">${escStation}</span> wurde manuell aufgehoben.`;
      } else if (log.durationMinutes === -10) {
        text = `🤖 Gruppe <span class="font-extrabold text-brand">${escGroup}</span> wurde automatisch Unterstation <span class="font-bold text-brand">${escStation}</span> zugewiesen (Prüfer: ${escFallbackExaminer}).`;
      } else if (log.durationMinutes === -12) {
        text = `📌 <span class="font-extrabold text-main">${escExaminer}</span> wurde der Gruppe <span class="font-extrabold text-brand">${escGroup}</span> zugewiesen.`;
      } else {
        const displayStation = escStation.startsWith('Station') ? escStation : `Station ${escStation}`;
        text = `✔ <span class="font-extrabold" style="color: var(--sig-success-text) !important;">${escGroup}</span> hat <span class="text-main font-semibold">${displayStation}</span> bei <span class="text-main font-semibold">${escExaminer}</span> abgeschlossen.`;
      }

      if (log.cancelled) {
        return `<span class="line-through text-main opacity-50">${text}</span> <span class="font-black text-[9px] uppercase ml-1.5 tracking-wider" style="color: var(--sig-danger-text) !important;">(Storniert ❌)</span>`;
      }
      return text;
    },

    getLogTimeText(log: ClientLogEntry): string {
      const timeStr = window.gapFlowUtils ? window.gapFlowUtils.formatTime(log.timestamp) : `${log.timestamp}`;
      if (log.durationMinutes >= 0) {
        return `${timeStr} (${log.durationMinutes} Min.)`;
      }
      return `${timeStr}`;
    },
  });
};
