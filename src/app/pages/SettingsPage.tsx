// Settings: defaults, site access, and control over everything stored on this device.
import { useCallback, useEffect, useState } from 'react';
import { Keyboard, ShieldCheck, Trash2 } from 'lucide-react';
import type { Settings } from '@/types';
import { brand } from '@/config/brand';
import { t } from '@/i18n';
import { listSiteAccess, revokeSiteAccess } from '@/messaging/tabClient';
import { deleteAllData, storageEstimate } from '@/storage/db';
import { listProjects } from '@/storage/projects';
import { listRecipes } from '@/storage/recipes';
import { resetSettings } from '@/storage/settings';
import { useData } from '@/app/stores/data';
import { toast, useUi } from '@/app/stores/ui';
import { formatBytes } from '@/app/services/exportData';
import { Button, Card, Checkbox, ConfirmDialog, Field, Input, Notice, PageHeader, Segmented } from '@/app/components/ui';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="grid gap-4 p-5 md:grid-cols-[15rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{description}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </Card>
  );
}

function NumberSetting({ label, hint, value, min, max, onCommit }: { label: string; hint?: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <Input
          id={id}
          type="number"
          className="w-40"
          min={min}
          max={max}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const parsed = Math.floor(Number(draft));
            if (!Number.isFinite(parsed)) {
              setDraft(String(value));
              return;
            }
            const clamped = Math.min(max, Math.max(min, parsed));
            setDraft(String(clamped));
            if (clamped !== value) onCommit(clamped);
          }}
        />
      )}
    </Field>
  );
}

export function SettingsPage() {
  const settings = useUi((state) => state.settings);
  const update = useUi((state) => state.updateSettings);
  const [origins, setOrigins] = useState<string[]>([]);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [counts, setCounts] = useState<{ projects: number; recipes: number } | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const refresh = useCallback(async () => {
    setOrigins(await listSiteAccess());
    setUsage(await storageEstimate().catch(() => null));
    try {
      const [projects, recipes] = await Promise.all([listProjects(), listRecipes()]);
      setCounts({ projects: projects.length, recipes: recipes.length });
    } catch {
      setCounts(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = (patch: Parameters<typeof update>[0], message = t('Setting saved')) => {
    update(patch).then(
      () => toast.success(message),
      (error: unknown) => toast.error(t('Could not save the setting'), error instanceof Error ? error.message : String(error)),
    );
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <PageHeader title={t('Settings')} description={t('Preferences are stored in this browser only.')} />

      <Section title={t('Appearance')}>
        <div className="flex items-center gap-3 text-[13px]">
          <span>{t('Theme')}</span>
          <Segmented<Settings['theme']>
            label={t('Theme')}
            value={settings.theme}
            onChange={(theme) => save({ theme })}
            options={[
              { value: 'system', label: t('System') },
              { value: 'light', label: t('Light') },
              { value: 'dark', label: t('Dark') },
            ]}
          />
        </div>
      </Section>

      <Section title={t('Table extraction')} description={t('Defaults for the Tables screen and quick extraction.')}>
        <Checkbox checked={settings.tables.includeHidden} onChange={(includeHidden) => save({ tables: { includeHidden } })} label={t('Include hidden rows and columns')} description={t('Off: content hidden with CSS is skipped and reported as a warning.')} />
        <Checkbox checked={settings.tables.fillMerged} onChange={(fillMerged) => save({ tables: { fillMerged } })} label={t('Repeat merged cells')} description={t('A cell spanning several rows or columns is copied into each cell it covers, so every row is complete.')} />
        <div className="flex items-center gap-3 text-[13px]">
          <span>{t('Header row')}</span>
          <Segmented
            label={t('Header row')}
            value={settings.tables.headerMode}
            onChange={(headerMode) => save({ tables: { headerMode } })}
            options={[
              { value: 'auto', label: t('Auto') },
              { value: 'first-row', label: t('First row') },
              { value: 'none', label: t('None') },
            ]}
          />
        </div>
      </Section>

      <Section title={t('Export')} description={t('Defaults used by the export dialog and clipboard copy.')}>
        <div className="flex items-center gap-3 text-[13px]">
          <span>{t('CSV delimiter')}</span>
          <Segmented
            label={t('CSV delimiter')}
            value={settings.export.csvDelimiter}
            onChange={(csvDelimiter) => save({ export: { csvDelimiter } })}
            options={[
              { value: ',', label: t('Comma') },
              { value: ';', label: t('Semicolon') },
            ]}
          />
        </div>
        <Checkbox checked={settings.export.csvBom} onChange={(csvBom) => save({ export: { csvBom } })} label={t('Add a UTF-8 marker (BOM) to CSV / TSV')} description={t('Needed for Excel to display বাংলা, العربية, 日本語 and other non-Latin text correctly.')} />
        <Checkbox
          checked={settings.export.formulaGuard}
          onChange={(formulaGuard) => save({ export: { formulaGuard } })}
          label={t('Protect CSV / TSV / clipboard against formula injection')}
          description={t('Web pages can contain text such as =HYPERLINK(…) that a spreadsheet would run as a formula. With this on, such cells get a leading apostrophe. Turn it off only if another program reads the file.')}
        />
        <Checkbox checked={settings.export.jsonPretty} onChange={(jsonPretty) => save({ export: { jsonPretty } })} label={t('Pretty-print JSON')} />
        <Checkbox checked={settings.export.xlsxTypes} onChange={(xlsxTypes) => save({ export: { xlsxTypes } })} label={t('Write plain numbers and ISO dates as typed XLSX cells')} />
      </Section>

      <Section title={t('Pagination and scrolling')} description={t('Starting values for the Pagination screen. Every run is bounded by these limits.')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberSetting label={t('Maximum pages')} value={settings.pagination.maxPages} min={1} max={100000} onCommit={(maxPages) => save({ pagination: { maxPages } })} />
          <NumberSetting label={t('Delay between pages (ms)')} value={settings.pagination.delayMs} min={0} max={600000} onCommit={(delayMs) => save({ pagination: { delayMs } })} />
          <NumberSetting label={t('Maximum scrolls')} value={settings.pagination.maxScrolls} min={1} max={100000} onCommit={(maxScrolls) => save({ pagination: { maxScrolls } })} />
          <NumberSetting label={t('Scroll time limit (seconds)')} value={settings.pagination.maxDurationSec} min={5} max={86400} onCommit={(maxDurationSec) => save({ pagination: { maxDurationSec } })} />
        </div>
        <Checkbox checked={settings.pagination.skipDuplicates} onChange={(skipDuplicates) => save({ pagination: { skipDuplicates } })} label={t('Skip duplicate records by default')} />
      </Section>

      <Section
        title={t('Site access')}
        description={t('{name} has no access to any website by default. Clicking its icon grants temporary access to that one tab.', { name: brand.name })}
      >
        {origins.length === 0 ? (
          <p className="text-[13px] text-zinc-600 dark:text-zinc-400" data-testid="no-site-access">
            {t('No site has permanent access. This is the most private setup.')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {origins.map((origin) => (
              <li key={origin} className="flex items-center gap-3 px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{origin}</code>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (await revokeSiteAccess(origin)) toast.success(t('Access to {origin} removed', { origin }));
                    else toast.error(t('Could not remove access to {origin}', { origin }));
                    await refresh();
                  }}
                >
                  {t('Remove access')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">{t('Permanent access is only ever added when you press “Grant access” for a specific site, and Chrome asks you to confirm.')}</p>
      </Section>

      <Section title={t('Keyboard shortcuts')} description={t('Shortcuts are managed by Chrome.')}>
        <div>
          <Button icon={Keyboard} onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
            {t('Change shortcuts in Chrome')}
          </Button>
        </div>
      </Section>

      <Section title={t('Your data')} description={t('Everything {name} stores lives in this browser profile.', { name: brand.name })}>
        <Notice tone="brand" icon={ShieldCheck}>
          {t('No account, no cloud, no analytics. Projects and recipes are saved in IndexedDB on this device and are never uploaded.')}
        </Notice>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500">{t('Saved projects')}</dt>
            <dd className="font-medium" data-testid="settings-project-count">
              {counts ? counts.projects : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">{t('Saved recipes')}</dt>
            <dd className="font-medium">{counts ? counts.recipes : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">{t('Storage used')}</dt>
            <dd className="font-medium">{usage ? t('{used} of {quota} available', { used: formatBytes(usage.usage), quota: formatBytes(usage.quota) }) : t('Not reported by the browser')}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save({ onboardingDone: false }, t('The introduction will show again'))}>{t('Show the introduction again')}</Button>
          <Button onClick={() => setConfirmReset(true)}>{t('Reset settings')}</Button>
          <Button variant="danger" icon={Trash2} onClick={() => setConfirmWipe(true)} data-testid="delete-all-data">
            {t('Delete all saved data')}
          </Button>
        </div>
      </Section>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t('Reset all settings?')}
        message={t('Settings return to their defaults. Saved projects and recipes are kept.')}
        confirmLabel={t('Reset settings')}
        onConfirm={async () => {
          await resetSettings();
          await useUi.getState().loadSettings();
          // Do not replay the introduction just because settings were reset.
          await update({ onboardingDone: true });
          toast.success(t('Settings reset to defaults'));
        }}
      />
      <ConfirmDialog
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title={t('Delete all saved data?')}
        message={t('All saved projects, recipes and settings will be permanently removed from this browser. Data currently open in the Data Preview stays until you close the tab. This cannot be undone.')}
        confirmLabel={t('Delete everything')}
        danger
        onConfirm={async () => {
          try {
            await deleteAllData();
            useData.setState({ project: { id: null, name: '', folder: '' }, dirty: useData.getState().items.length > 0 });
            await useUi.getState().loadSettings();
            await update({ onboardingDone: true });
            toast.success(t('All saved data was deleted'));
            await refresh();
          } catch (error) {
            toast.error(t('Could not delete the data'), error instanceof Error ? error.message : String(error));
          }
        }}
      />
    </div>
  );
}
