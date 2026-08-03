/**
 * Modul zur Steuerung von Chart.js für das Admin-Dashboard.
 */
interface ChartStationData {
  id: string;
  name: string;
  targetAvgDuration?: number;
  active?: boolean;
  stats?: {
    avgDuration: number;
    hasLogs: boolean;
    g_rem: number;
    n_subs: number;
  };
  subStations?: Record<string, { currentGroupId: string | null; startTime: number | null }>;
}

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

let stationsChartInstance: any = null;

window.gapFlowChart = {
  /**
   * Initialisiert das Chart.js Balkendiagramm im Canvas-Element.
   * @param {HTMLElement | null} canvasElement - Das Canvas-Element.
   * @param {number | null} firstAssignmentTime - Der erste Zuteilungs-Zeitstempel.
   * @param {number} pageLoadTime - Der Ladezeitstempel der Seite.
   * @param {string} targetEndTime - Das eingestellte SOLL-Endzeit Limit.
   */
  initChart(
    canvasElement: HTMLElement | null,
    firstAssignmentTime: number | null,
    pageLoadTime: number,
    targetEndTime: string
  ): void {
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
            const refTime = firstAssignmentTime || pageLoadTime;

            if (targetEndTime) {
              activeLimitStr = targetEndTime;
            } else if (firstAssignmentTime) {
              const targetDate = new Date(firstAssignmentTime + 5 * 60 * 60 * 1000);
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

            if (firstAssignmentTime) {
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

  /**
   * Aktualisiert die Diagramm-Daten und berechnet die Tabellenzeilen für Restlaufzeiten.
   * @param {ChartStationData[]} stations - Liste der aktiven Stationen.
   * @param {number | null} firstAssignmentTime - Der erste Zuteilungs-Zeitstempel.
   * @param {number} pageLoadTime - Der Ladezeitstempel der Seite.
   * @param {string} targetEndTime - Das SOLL-Endzeit Limit.
   * @returns {CalcRowData[]} Berechnete Daten für die Dashboard-Tabelle.
   */
  updateChart(
    stations: ChartStationData[],
    firstAssignmentTime: number | null,
    pageLoadTime: number,
    targetEndTime: string
  ): CalcRowData[] {
    const canvasElement = document.getElementById('stationsChart');
    if (!stationsChartInstance) {
      this.initChart(canvasElement, firstAssignmentTime, pageLoadTime, targetEndTime);
    }
    if (!stationsChartInstance) return [];

    window.chartReferenceTimeGlobal = firstAssignmentTime || pageLoadTime;
    window.firstAssignmentTimeGlobal = firstAssignmentTime;

    const activeStations = stations.filter((s) => s.active !== false);
    activeStations.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    const labels = activeStations.map((s) => (s.name.length > 26 ? `${s.name.substring(0, 24)}...` : s.name));
    const remainingTimes: number[] = [];
    const backgroundColors: string[] = [];
    const calcTableData: CalcRowData[] = [];

    let limitMins = Infinity;
    const now = Date.now();
    let activeFirstAssignment = firstAssignmentTime;

    if (activeFirstAssignment && (now - activeFirstAssignment) > 24 * 60 * 60 * 1000) {
      activeFirstAssignment = null;
    }

    const refTime = activeFirstAssignment || pageLoadTime;

    if (targetEndTime) {
      const [targetHrs, targetMins] = targetEndTime.split(':').map(Number);
      const targetDate = new Date(refTime);
      targetDate.setHours(targetHrs, targetMins, 0, 0);

      if (targetDate.getTime() < refTime) {
        targetDate.setDate(targetDate.getDate() + 1);
      }

      limitMins = (targetDate.getTime() - refTime) / 60000;
    } else if (firstAssignmentTime) {
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

      calcTableData.push({
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

    return calcTableData;
  },
};
