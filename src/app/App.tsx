import { useEffect } from 'react';
import { t } from '@/i18n';
import type { WorkspaceIntent } from '@/messaging/protocol';
import { Sidebar, Toasts, TopBar } from './components/Shell';
import { Onboarding } from './components/Onboarding';
import { initMessageRouter, onBindRequest, onContentEvent } from './services/events';
import { runIntent } from './services/actions';
import { useData } from './stores/data';
import { useRule } from './stores/rule';
import { focusWorkspace, initTargetListeners, useTarget } from './stores/target';
import { applyFeel, applyTheme, navigate, toast, useUi } from './stores/ui';
import { installUiSounds, playSfx } from './services/sfx';
import { HomePage } from './pages/HomePage';
import { TablesPage } from './pages/TablesPage';
import { VisualPage } from './pages/VisualPage';
import { SelectorsPage } from './pages/SelectorsPage';
import { PaginationPage } from './pages/PaginationPage';
import { BatchPage } from './pages/BatchPage';
import { DataPage } from './pages/DataPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { RecipesPage } from './pages/RecipesPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';

function parseIntent(raw: string | null): WorkspaceIntent {
  if (!raw) return { kind: 'none' };
  try {
    const value = JSON.parse(raw) as WorkspaceIntent;
    if (value && typeof value === 'object' && typeof value.kind === 'string') return value;
  } catch {
    /* malformed query: ignore */
  }
  return { kind: 'none' };
}

let started = false;

/** One-time wiring of extension listeners and the initial tab binding. */
function start(): void {
  if (started) return;
  started = true;
  initMessageRouter();
  initTargetListeners();
  installUiSounds();
  void useUi.getState().loadSettings();

  onBindRequest((message) => {
    void useTarget
      .getState()
      .bind(message.tabId, message.url, message.title)
      .then(() => runIntent(message.intent));
  });

  // The visual selector reports back here, wherever in the app the user is.
  onContentEvent('picker:done', (payload) => {
    useRule.getState().setRule(payload.rule, 'visual', { matched: payload.count, sourceUrl: payload.url });
    navigate('/visual');
    void focusWorkspace();
    playSfx('pop');
    toast.success(t('{count} records selected with {fields} fields', { count: payload.count, fields: payload.rule.fields.length }), t('Review the preview, then extract.'));
  });
  onContentEvent('picker:cancelled', (payload) => {
    if (payload.mode === 'records') void focusWorkspace();
  });
  onContentEvent('hud:back', () => void focusWorkspace());

  const params = new URLSearchParams(window.location.search);
  const tab = Number(params.get('tab'));
  if (params.has('tab') && Number.isInteger(tab) && tab >= 0) {
    const intent = parseIntent(params.get('intent'));
    void useTarget
      .getState()
      .bind(tab, params.get('url') ?? '', params.get('title') ?? '')
      .then(() => runIntent(intent));
    // Keep the address bar clean (and avoid re-running the intent on reload).
    window.history.replaceState(null, '', `${window.location.pathname}?tab=${tab}${window.location.hash}`);
  }

  window.addEventListener('beforeunload', (event) => {
    // Extracted data lives in memory until saved as a project: warn before losing it.
    if (useData.getState().dirty && useData.getState().items.length > 0) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

const PAGES = {
  '/': HomePage,
  '/tables': TablesPage,
  '/visual': VisualPage,
  '/selectors': SelectorsPage,
  '/pagination': PaginationPage,
  '/batch': BatchPage,
  '/data': DataPage,
  '/projects': ProjectsPage,
  '/recipes': RecipesPage,
  '/settings': SettingsPage,
  '/help': HelpPage,
} as const;

export function App() {
  const route = useUi((state) => state.route);
  const theme = useUi((state) => state.settings.theme);
  const sound = useUi((state) => state.settings.sound);
  const animations = useUi((state) => state.settings.animations);
  const Page = PAGES[route];

  useEffect(() => {
    start();
  }, []);

  useEffect(() => {
    applyFeel({ sound, animations });
  }, [sound, animations]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  return (
    <div className="app-surface flex h-screen overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        {t('Skip to content')}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-auto outline-none" data-route={route}>
          {/* Keyed by route so each page plays its entrance once. */}
          <div key={route} className="fade-in h-full">
            <Page />
          </div>
        </main>
      </div>
      <Toasts />
      <Onboarding />
    </div>
  );
}
