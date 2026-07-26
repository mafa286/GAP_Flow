// Version Tracker: public/js/global.d.ts (GAP-Flow v1.0.2)

interface Window {
  _dashboardThemeListenerBound?: boolean;
  gapFlowUtils?: any;
  gapFlowAudio?: any;
  prueferPwaHelper?: any;
  themeConfig?: any;
  createAdminPanel?: any;
  adminStationsPopups?: any;
  examinerPanelInstance?: any;
  examinerSocket?: any;
  adminSocket?: any;
  io?: any;
  Chart?: any;
  Papa?: any;
  tailwind?: any;
  updateFavicon?: () => void;
  applyTheme?: () => void;
  toggleTheme?: () => void;
  chartReferenceTimeGlobal?: number;
  firstAssignmentTimeGlobal?: number | null;
  webkitAudioContext?: typeof AudioContext;
  examiner?: () => any;
  adminPanel?: () => any;
}

interface Navigator {
  standalone?: boolean;
  getInstalledRelatedApps?: () => Promise<unknown[]>;
}