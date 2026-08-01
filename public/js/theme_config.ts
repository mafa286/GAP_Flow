/**
 * Stummschaltung der Tailwind-CDN-Produktionswarnung in der Browserkonsole.
 * @param {...unknown[]} args - Die Ausgabeparameter für console.warn.
 * @returns {void}
 */
const originalConsoleWarn = console.warn;
console.warn = function (...args: unknown[]): void {
  if (typeof args[0] === 'string' && args[0].includes('cdn.tailwindcss.com should not be used in production')) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

type OrgType = 'THW' | 'FEUERWEHR' | 'DRK';

interface OrgColorConfig {
  primary: string;
  primaryRgb: string;
  primaryHover: string;
  primaryContrast: string;
  accent: string;
  accentHover: string;
  accentContrast: string;
  [key: string]: string;
}

const currentOrg: OrgType = 'THW';

const configs: Record<OrgType, OrgColorConfig> = {
  THW: {
    primary: '#00387B',
    primaryRgb: '0, 56, 123',
    primaryHover: '#002654',
    primaryContrast: '#f9fafb',
    accent: '#FFCC00',
    accentHover: '#E6B800',
    accentContrast: '#0f172a',
  },
  FEUERWEHR: {
    primary: '#e30613',
    primaryRgb: '227, 6, 19',
    primaryHover: '#b91c1c',
    primaryContrast: '#f9fafb',
    accent: '#FFE600',
    accentHover: '#ccd100',
    accentContrast: '#0f172a',
  },
  DRK: {
    primary: '#da291c',
    primaryRgb: '218, 41, 28',
    primaryHover: '#b91c1c',
    primaryContrast: '#f9fafb',
    accent: '#FFCC00',
    accentHover: '#d97706',
    accentContrast: '#0f172a',
  },
};

const palette: OrgColorConfig = configs[currentOrg] || configs.THW;

const style = document.createElement('style');
style.innerHTML = `
  :root {
    --org-bg-app: #f8fafc;
    --org-bg-card: #ffffff;
    --org-bg-card-accent: #f1f5f9;
    --org-border: #475569;
    --org-text-main: #090d16;
    --org-text-muted: #334155;
    --org-shadow: 0 10px 15px -3px rgba(203, 213, 225, 0.8), 0 4px 6px -4px rgba(203, 213, 225, 0.8);
    --org-overlay-bg: rgba(15, 23, 42, 0.65);
    --org-scrollbar-thumb: #475569;
    --org-scrollbar-track: #ffffff;

    --sig-danger-border: #991b1b;
    --sig-danger-bg: rgba(254, 226, 226, 0.6);
    --sig-danger-text: #991b1b;
    
    --sig-warning-border: #c2410c;
    --sig-warning-bg: rgba(255, 237, 213, 0.6);
    --sig-warning-text: #c2410c;
    
    --sig-success-border: #065f46;
    --sig-success-bg: rgba(209, 250, 229, 0.6);
    --sig-success-text: #065f46;

    --badge-name-border: #475569;
    --badge-name-bg: rgba(241, 245, 249, 0.6);
    --badge-name-text: #475569;
    
    --badge-group-border: #1e3a8a;
    --badge-group-bg: rgba(219, 234, 254, 0.6);
    --badge-group-text: #1e3a8a;

    --org-primary: ${palette.primary};
    --org-primary-rgb: ${palette.primaryRgb};
    --org-primary-hover: ${palette.primaryHover};
    --org-primary-contrast: ${palette.primaryContrast};
    --org-accent: ${palette.accent};
    --org-accent-hover: ${palette.accentHover};
    --org-accent-contrast: ${palette.accentContrast};
    --org-brand: ${palette.primary};
    
    --org-progress-track: #cbd5e1;
  }
  
  .dark {
    --org-bg-app: #030712;
    --org-bg-card: #111827;
    --org-bg-card-accent: #1f2937;
    --org-border: var(--org-bg-card-accent);
    --org-text-main: #f3f4f6;
    --org-text-muted: #9ca3af;
    --org-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.5);
    --org-overlay-bg: rgba(3, 7, 18, 0.85);
    --org-scrollbar-thumb: #9ca3af;
    --org-scrollbar-track: #111827;

    --sig-danger-border: #fca5a5;
    --sig-danger-bg: rgba(69, 10, 10, 0.6);
    --sig-danger-text: #fca5a5;
    
    --sig-warning-border: #fdba74;
    --sig-warning-bg: rgba(67, 20, 7, 0.6);
    --sig-warning-text: #fdba74;
    
    --sig-success-border: #86efac;
    --sig-success-bg: rgba(6, 78, 59, 0.6);
    --sig-success-text: #86efac;

    --badge-name-border: #e5e7eb;
    --badge-name-bg: rgba(31, 41, 55, 0.6);
    --badge-name-text: #e5e7eb;
    
    --badge-group-border: #93c5fd;
    --badge-group-bg: rgba(23, 37, 84, 0.6);
    --badge-group-text: #93c5fd;
    --org-brand: var(--org-accent);
    
    --org-progress-track: #1e293b;
  }

  .app-bg { background-color: var(--org-bg-app) !important; color: var(--org-text-main) !important; }
  .app-card { background-color: var(--org-bg-card) !important; border: 1px solid var(--org-border) !important; box-shadow: var(--org-shadow) !important; border-radius: 0.75rem !important; }
  .app-card-accent { background-color: var(--org-bg-card-accent) !important; border: 1px solid var(--org-border) !important; border-radius: 0.5rem !important; }
  .app-overlay-modal { background-color: var(--org-overlay-bg) !important; backdrop-filter: blur(4px) !important; display: none; }
  .text-sig-danger { color: var(--sig-danger-text) !important; }
  .text-sig-warning { color: var(--sig-warning-text) !important; }
  .bg-sig-success-border { background-color: var(--sig-success-border) !important; }
  .bg-sig-danger-border { background-color: var(--sig-danger-border) !important; }
  .card-sig-danger { background-color: var(--sig-danger-bg) !important; border-color: var(--sig-danger-border) !important; }
  .loader-spinner { border-color: var(--org-border) !important; border-top-color: var(--org-primary) !important; }
  .duration-100 { transition-duration: 100ms !important; }
  .app-overlay-modal { background-color: var(--org-overlay-bg) !important; backdrop-filter: blur(6px) !important; display: none; }

  .text-main { color: var(--org-text-main) !important; }
  .text-muted { color: var(--org-text-muted) !important; }
  .text-brand { color: var(--org-brand) !important; }
  .border-main { border-color: var(--org-border) !important; }
  ::placeholder { color: var(--org-text-muted) !important; opacity: 0.85 !important; }

  .input-text, .input-select {
    background-color: var(--org-bg-card) !important;
    color: var(--org-text-main) !important;
    border: 1px solid var(--org-border) !important;
    border-radius: 0.5rem !important;
    transition: border-color 0.2s !important;
  }
  .input-text:focus, .input-select:focus {
    border-color: var(--org-primary) !important;
    outline: none !important;
    box-shadow: 0 0 0 2px rgba(var(--org-primary-rgb), 0.2) !important;
  }

  .input-file { color: transparent !important; width: 130px; overflow: hidden; }
  .input-file::file-selector-button {
    background-color: var(--org-primary) !important;
    color: var(--org-primary-contrast) !important;
    border: 1px solid var(--org-primary) !important;
    border-radius: 0.5rem !important;
    font-weight: 800 !important;
    transition: all 0.2s ease-in-out !important;
    cursor: pointer !important;
  }
  .input-file::file-selector-button:hover {
    background-color: var(--org-accent) !important;
    border-color: var(--org-accent-hover) !important;
    color: var(--org-accent-contrast) !important;
  }

  .btn-brand {
    background-color: var(--org-primary) !important;
    color: var(--org-primary-contrast) !important;
    border: 1px solid var(--org-primary) !important;
    border-radius: 0.5rem !important;
    font-weight: 800 !important;
    transition: all 0.2s ease-in-out !important;
    cursor: pointer !important;
    text-align: center !important;
  }
  .btn-brand:hover {
    background-color: var(--org-accent) !important;
    border-color: var(--org-accent-hover) !important;
    color: var(--org-accent-contrast) !important;
  }

  .btn-link {
    background-color: var(--org-primary) !important;
    color: var(--org-primary-contrast) !important;
    border: 1px solid var(--org-primary) !important;
    border-radius: 0.5rem !important;
    font-weight: 800 !important;
    font-family: monospace !important;
    font-size: 10px !important;
    padding: 0.25rem 0.5rem !important;
    text-transform: uppercase !important;
    transition: all 0.2s ease-in-out !important;
    display: inline-block !important;
    text-align: center !important;
    text-decoration: none !important;
  }
  .btn-link:hover {
    background-color: var(--org-accent) !important;
    border-color: var(--org-accent-hover) !important;
    color: var(--org-accent-contrast) !important;
  }

  .btn-sig-red {
    background-color: var(--sig-danger-bg) !important;
    border: 1px solid var(--sig-danger-border) !important;
    color: var(--sig-danger-text) !important;
    border-radius: 0.5rem !important;
    font-weight: 800 !important;
    transition: all 0.2s ease-in-out !important;
    cursor: pointer !important;
  }
  .btn-sig-red:hover { background-color: var(--sig-danger-border) !important; color: #ffffff !important; }
  .dark .btn-sig-red:hover { color: #111827 !important; }

  .btn-sig-orange {
    background-color: var(--sig-warning-bg) !important;
    border: 1px solid var(--sig-warning-border) !important;
    color: var(--sig-warning-text) !important;
    border-radius: 0.5rem !important;
    font-weight: 800 !important;
    transition: all 0.2s ease-in-out !important;
    cursor: pointer !important;
  }
  .btn-sig-orange:hover { background-color: var(--sig-warning-border) !important; color: #ffffff !important; }
  .dark .btn-sig-orange:hover { color: #111827 !important; }

  .btn-sig-green {
    background-color: var(--sig-success-bg) !important;
    border: 1px solid var(--sig-success-border) !important;
    color: var(--sig-success-text) !important;
    border-radius: 0.5rem !important;
    font-weight: 800 !important;
    transition: all 0.2s ease-in-out !important;
    cursor: pointer !important;
  }
  .btn-sig-green:hover { background-color: var(--sig-success-border) !important; color: #ffffff !important; }
  .dark .btn-sig-green:hover { color: #111827 !important; }

  .sig-badge-red {
    background-color: var(--sig-danger-bg) !important;
    border: 1px solid var(--sig-danger-border) !important;
    color: var(--sig-danger-text) !important;
    border-radius: 0.375rem !important;
    font-weight: 700 !important;
  }
  .sig-badge-orange {
    background-color: var(--sig-warning-bg) !important;
    border: 1px solid var(--sig-warning-border) !important;
    color: var(--sig-warning-text) !important;
    border-radius: 0.375rem !important;
    font-weight: 700 !important;
  }
  .sig-badge-green {
    background-color: var(--sig-success-bg) !important;
    border: 1px solid var(--sig-success-border) !important;
    color: var(--sig-success-text) !important;
    border-radius: 0.375rem !important;
    font-weight: 700 !important;
  }

  .badge-name-active {
    background-color: var(--badge-name-bg) !important;
    color: var(--badge-name-text) !important;
    border: 1px solid var(--badge-name-border) !important;
    border-radius: 0.375rem !important;
    font-weight: 700 !important;
    padding: 0.125rem 0.625rem !important;
  }
  .badge-name-inactive {
    background-color: var(--badge-name-bg) !important;
    color: var(--org-text-muted) !important;
    border: 1px solid var(--badge-name-border) !important;
    border-radius: 0.375rem !important;
    font-weight: 700 !important;
    padding: 0.125rem 0.625rem !important;
    opacity: 0.5 !important;
    text-decoration: line-through !important;
  }

  .badge-group-active {
    background-color: var(--badge-group-bg) !important;
    color: var(--badge-group-text) !important;
    border: 1px solid var(--badge-group-border) !important;
    border-radius: 0.375rem !important;
    font-weight: 700 !important;
    padding: 0.125rem 0.625rem !important;
  }
  .badge-group-inactive {
    background-color: var(--badge-group-bg) !important;
    color: var(--org-text-muted) !important;
    border: 1px solid var(--badge-group-border) !important;
    border-radius: 0.375rem !important;
    font-weight: 700 !important;
    padding: 0.125rem 0.625rem !important;
    opacity: 0.5 !important;
    text-decoration: line-through !important;
  }

  .progress-track { background-color: var(--org-progress-track) !important; }
  .progress-fill { background-color: var(--org-brand) !important; }

  .transition, .transition-colors, .transition-all {
    transition-duration: 200ms !important;
    transition-timing-function: ease-in-out !important;
  }
  .duration-300 { transition-duration: 300ms !important; }
  .duration-500 { transition-duration: 500ms !important; }

  ::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
  ::-webkit-scrollbar-track { background: var(--org-scrollbar-track) !important; }
  ::-webkit-scrollbar-thumb { background: var(--org-scrollbar-thumb) !important; border-radius: 4px !important; }
  ::-webkit-scrollbar-thumb:hover { background: var(--org-brand) !important; }
`;
document.head.appendChild(style);

window.themeConfig = {
  org: currentOrg,
  palette,
  getColor(colorName: string, isDark?: boolean): string {
    const dark = isDark !== undefined ? !!isDark : document.documentElement.classList.contains('dark');
    if (colorName === 'border') return dark ? '#374151' : '#cbd5e1';
    if (colorName === 'muted') return dark ? '#9ca3af' : '#334155';
    if (colorName === 'danger') return dark ? '#fca5a5' : '#991b1b';
    if (colorName === 'warning') return dark ? '#fdba74' : '#c2410c';
    if (colorName === 'success') return dark ? '#86efac' : '#065f46';
    return palette[colorName] || colorName;
  },
};

window.tailwind = {
  config: {
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          brand: 'var(--org-brand)',
        },
      },
    },
  },
};

window.updateFavicon = function (): void {
  if (!document.head) return;
  let link = document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    document.head.appendChild(link);
  }
  const isDark = document.documentElement.classList.contains('dark');
  link.href = isDark ? '/favicon-dark.png?v=1.1.65' : '/favicon-light.png?v=1.1.65';
};

window.applyTheme = function (): void {
  const isDark =
    localStorage.getItem('theme') === 'dark' ||
    (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  if (typeof window.updateFavicon === 'function') {
    window.updateFavicon();
  }

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', isDark ? '#030712' : '#f8fafc');
  }
};

if (typeof window.applyTheme === 'function') {
  window.applyTheme();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.updateFavicon === 'function') window.updateFavicon();
  });
} else if (typeof window.updateFavicon === 'function') {
  window.updateFavicon();
}

window.addEventListener('storage', (e: StorageEvent) => {
  if (e.key === 'theme') {
    if (typeof window.applyTheme === 'function') window.applyTheme();
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: e.newValue }));
  }
});

window.toggleTheme = function (): void {
  const turnDark = !document.documentElement.classList.contains('dark');
  if (turnDark) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }));
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }));
  }
  if (typeof window.updateFavicon === 'function') {
    window.updateFavicon();
  }

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', turnDark ? '#030712' : '#f8fafc');
  }
};
