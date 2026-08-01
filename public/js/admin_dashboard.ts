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

let stationsChartInstance: any = null;

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
      if (!canvasElement || !window.Chart) return;

      if (stationsChartInstance) {
        stationsChartInstance.destroy();
        stationsChartInstance = null;
      }

      const gridColor = window.themeConfig ? window.themeConfig.getColor('border') : '#cbd5e1';
      const tickColor = window.themeConfig ? window.themeConfig.getColor('muted') : '#475569';

      if (!window._dashboardThemeListenerBound) {
        window._dashboardThemeListenerBound = true;
        window.addEventListener('theme-changed', (e: Event) => {
          if (!stationsChartInstance) return;
          const customEvent = e as CustomEvent<string>;
          const dark = customEvent.detail === 'dark';
          const newGrid = window.themeConfig ? window.themeConfig.getColor('border', dark) : '#cbd5e1';
          const newTick = window.themeConfig ? window.themeConfig.getColor('muted', dark) : '#475569';
          stationsChartInstance.options.scales.x.grid.color = newGrid;
          stationsChartInstance.options.scales.x.ticks.color = newTick;
          stationsChartInstance.options.scales.y.grid.color = newGrid;
          stationsChartInstance.options.scales.y.ticks.color = newTick;
          stationsChartInstance.options.scales.y.title.color = newTick;
          stationsChartInstance.update();
        });
      }

      stationsChartInstance = new window.Chart(canvasElement, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Voraussichtliche Endzeit',
              data: [],
              backgroundColor: [],
              borderRadius: 6,
              barPercentage: 0.5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: { color: tickColor, font: { weight: 'bold', size: 9 } },
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: tickColor,
                maxTicksLimit: 12,
                callback(value: number) {
                  const startTime = window.chartReferenceTimeGlobal || Date.now();
                  const targetTime = startTime + value * 60 * 1000;
                  return window.gapFlowUtils ? `${window.gapFlowUtils.formatTime(targetTime)} Uhr` : `${targetTime}`;
                },
              },
              title: { display: true, text: 'Voraussichtliche Fertigstellung', color: tickColor },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label(context: any) {
                  const value = context.parsed.y;
                  const startTime = window.chartReferenceTimeGlobal || Date.now();
                  const targetTime = startTime + value * 60 * 1000;

                  const refTime = window.firstAssignmentTimeGlobal || startTime;
                  const elapsedMins = (Date.now() - refTime) / 60000;
                  const remainingMins = Math.max(0, Math.round(value - elapsedMins));

                  const timeStr = window.gapFlowUtils ? window.gapFlowUtils.formatTime(targetTime) : `${targetTime}`;
                  return `Voraussichtliches Ende: ${timeStr} Uhr (${remainingMins} Min. Rest)`;
                },
              },
            },
          },
        },
        plugins: [
          {
            id: 'targetLinePlugin',
            afterDraw: (chart: any) => {
              let activeLimitStr = '';
              const refTime = self.firstAssignmentTime || self.pageLoadTime;

              if (self.targetEndTime) {
                activeLimitStr = self.targetEndTime;
              } else if (self.firstAssignmentTime) {
                const targetDate = new Date(self.firstAssignmentTime + 5 * 60 * 60 * 1000);
                const hrs = targetDate.getHours().toString().padStart(2, '0');
                const mins = targetDate.getMinutes().toString().padStart(2, '0');
                activeLimitStr = `${hrs}:${mins}`;
              }

              if (!activeLimitStr) return;
              if (!chart.scales || !chart.scales.y || !chart.scales.x) return;

              const [targetHrs, targetMins] = activeLimitStr.split(':').map(Number);
              const targetDate = new Date(refTime);
              targetDate.setHours(targetHrs, targetMins, 0, 0);

              if (targetDate.getTime() < refTime) {
                targetDate.setDate(targetDate.getDate() + 1);
              }

              const yAxis = chart.scales.y;
              const yValue = (targetDate.getTime() - refTime) / 60000;
              const yPos = yAxis.getPixelForValue(yValue);

              const dangerColor = window.themeConfig ? window.themeConfig.getColor('danger') : '#ef4444';
              const brandColor = window.themeConfig
                ? window.themeConfig.getColor(document.documentElement.classList.contains('dark') ? 'accent' : 'primary')
                : '#3b82f6';

              if (yPos >= yAxis.top && yPos <= yAxis.bottom) {
                const ctx = chart.ctx;
                ctx.save();

                ctx.beginPath();
                ctx.moveTo(chart.scales.x.left, yPos);
                ctx.lineTo(chart.scales.x.right, yPos);
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = dangerColor;
                ctx.setLineDash([6, 6]);
                ctx.stroke();

                ctx.fillStyle = dangerColor;
                ctx.font = 'bold 10px sans-serif';
                ctx.textBaseline = 'bottom';
                ctx.textAlign = 'right';
                ctx.fillText(`SOLL-LIMIT: ${activeLimitStr} Uhr`, chart.scales.x.right - 10, yPos - 6);

                ctx.restore();
              }

              if (self.firstAssignmentTime) {
                const elapsedMins = (Date.now() - refTime) / 60000;
                const nowYPos = yAxis.getPixelForValue(elapsedMins);

                if (nowYPos >= yAxis.top && nowYPos <= yAxis.bottom) {
                  const ctx = chart.ctx;
                  ctx.save();

                  ctx.beginPath();
                  ctx.moveTo(chart.scales.x.left, nowYPos);
                  ctx.lineTo(chart.scales.x.right, nowYPos);
                  ctx.lineWidth = 2.0;
                  ctx.strokeStyle = brandColor;
                  ctx.setLineDash([4, 4]);
                  ctx.stroke();

                  ctx.fillStyle = brandColor;
                  ctx.font = 'bold 10px sans-serif';
                  ctx.textBaseline = 'bottom';
                  ctx.textAlign = 'left';
                  ctx.fillText('AKTUELLE UHRZEIT', chart.scales.x.left + 10, nowYPos - 6);

                  ctx.restore();
                }
              }
            },
          },
        ],
      });
    },

    updateChart(): void {
      const self = this as unknown as AdminDashboardComponent;
      if (!stationsChartInstance) {
        self.initChart();
      }
      if (!stationsChartInstance) return;

      window.chartReferenceTimeGlobal = self.firstAssignmentTime || self.pageLoadTime;
      window.firstAssignmentTimeGlobal = self.firstAssignmentTime;

      const activeStations = Object.values(self.stations).filter((s) => s.active);

      activeStations.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

      const labels = activeStations.map((s) => (s.name.length > 26 ? `${s.name.substring(0, 24)}...` : s.name));
      const remainingTimes: number[] = [];
      const backgroundColors: string[] = [];

      self.calcTableData = [];

      let limitMins = Infinity;
      const now = Date.now();
      let activeFirstAssignment = self.firstAssignmentTime;

      // Guard gegen veraltete Zeitstempel von vergangenen Tagen (> 24 Stunden alt)
      if (activeFirstAssignment && (now - activeFirstAssignment) > 24 * 60 * 60 * 1000) {
        activeFirstAssignment = null;
      }

      const refTime = activeFirstAssignment || self.pageLoadTime;

      if (self.targetEndTime) {
        const [targetHrs, targetMins] = self.targetEndTime.split(':').map(Number);
        const targetDate = new Date(refTime);
        targetDate.setHours(targetHrs, targetMins, 0, 0);

        if (targetDate.getTime() < refTime) {
          targetDate.setDate(targetDate.getDate() + 1);
        }

        limitMins = (targetDate.getTime() - refTime) / 60000;
      } else if (self.firstAssignmentTime) {
        limitMins = 300;
      }

      activeStations.forEach((st) => {
        let activeSubsCount = 0;
        if (st.subStations) {
          activeSubsCount = Object.values(st.subStations).filter((sub: any) => sub.active !== false).length;
        }

        const defaultAvg = st.targetAvgDuration || 15.0;
        const stats = st.stats || { avgDuration: defaultAvg, hasLogs: false, g_rem: 0, n_subs: activeSubsCount || 1 };

        const { avgDuration, hasLogs, g_rem } = stats;
        const n_subs = stats.n_subs || activeSubsCount || 1;

        let tActive = 0;
        let busySubsCount = 0;

        if (st.subStations) {
          Object.values(st.subStations).forEach((sub) => {
            if (sub.currentGroupId && sub.startTime) {
              const elapsedMins = (Date.now() - sub.startTime) / 60000;
              tActive += elapsedMins;
              busySubsCount += 1;
            }
          });
        }

        const tActiveAvg = busySubsCount > 0 ? tActive / busySubsCount : 0;
        const rawRemaining = (avgDuration * g_rem - tActive) / n_subs;
        const remainingTime = Math.max(0, Math.round(rawRemaining));

        const elapsedMins = (Date.now() - refTime) / 60000;
        const barVal = Math.round(elapsedMins + remainingTime);

        remainingTimes.push(barVal);

        let isOvertime = false;
        let isWarning = false;

        if (limitMins !== Infinity) {
          isOvertime = barVal >= limitMins;
          isWarning = barVal > limitMins - 30 && barVal < limitMins;
        }

        if (isOvertime) {
          backgroundColors.push(window.themeConfig ? window.themeConfig.getColor('danger') : '#ef4444');
        } else if (isWarning) {
          backgroundColors.push(window.themeConfig ? window.themeConfig.getColor('warning') : '#f97316');
        } else {
          backgroundColors.push(window.themeConfig ? window.themeConfig.getColor('success') : '#10b981');
        }

        const endTime = Date.now() + remainingTime * 60 * 1000;
        const endTimeStr = window.gapFlowUtils ? `${window.gapFlowUtils.formatTime(endTime)} Uhr` : `${endTime}`;

        self.calcTableData.push({
          id: st.id,
          name: st.name,
          avg: avgDuration.toFixed(1),
          hasLogs,
          g_rem,
          t_active_avg: Math.round(tActiveAvg),
          n_subs,
          total: remainingTime,
          endTimeStr,
          isOvertime,
          isWarning,
        });
      });

      let maxVal = Math.max(...remainingTimes, 30);
      if (limitMins !== Infinity) {
        maxVal = Math.max(maxVal, limitMins + 15);
      }

      if (maxVal <= 300) {
        stationsChartInstance.options.scales.y.ticks.stepSize = 15;
      } else if (stationsChartInstance.options.scales.y.ticks) {
        delete stationsChartInstance.options.scales.y.ticks.stepSize;
      }

      stationsChartInstance.options.scales.y.min = 0;
      stationsChartInstance.options.scales.y.max = maxVal;
      stationsChartInstance.data.labels = labels;
      stationsChartInstance.data.datasets[0].data = remainingTimes;
      stationsChartInstance.data.datasets[0].backgroundColor = backgroundColors;
      stationsChartInstance.update();
    },

    getGroupFilterOptions(): string[] {
      const self = this as unknown as AdminDashboardComponent;
      const names = new Set(Object.values(self.groups).map((g) => g.name));
      self.logs.forEach((log) => {
        if (log.durationMinutes !== -3 && log.durationMinutes !== -4 && log.groupName) {
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
