interface Window {
  GAP_FLOW_VERSION?: string;
  _dashboardThemeListenerBound?: boolean;
  gapFlowUtils?: any;
  gapFlowAudio?: any;
  gapFlowChart?: any;
  prueferPwaHelper?: any;
  prueferPush?: any;
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
