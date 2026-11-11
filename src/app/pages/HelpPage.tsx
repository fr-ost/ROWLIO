// Help & About: how-tos, shortcuts, privacy summary, honest limitations.
import { useEffect, useState } from 'react';
import { Ban, Check, ShieldCheck } from 'lucide-react';
import { APP_VERSION, brand } from '@/config/brand';
import { t } from '@/i18n';
import { useUi } from '@/app/stores/ui';
import { Logo } from '@/app/components/Shell';
import { Aurora, Credits } from '@/app/components/fx';
import { Button, Card, Kbd, PageHeader } from '@/app/components/ui';

interface Topic {
  title: string;
  steps: string[];
}

const TOPICS: Topic[] = [
  {
    title: 'Extract a table',
    steps: [
      'Open the page, click the {name} icon and choose “Extract tables”, or open the Tables screen in the workspace.',
      'Every table is listed with a preview. Merged cells, multi-row headers and nested tables are handled; anything unusual is shown as a warning.',
      'Tick “Include hidden rows and columns” if the page hides data you need.',
      'Press Extract. The rows open in the Data Preview.',
    ],
  },
  {
    title: 'Select repeated elements (cards, results, listings)',
    steps: [
      'Open the Visual Selector and press “Select on page”.',
      'Click one item, for example one product card. Similar items are highlighted. “Wider” and “Narrower” change which repeating block is used.',
      'Fields such as title, price, image, link, rating and date are detected when present. Rename, reorder or remove them, or press “Add field by clicking”.',
      'If no pattern is found around your click, click a second example and {name} generalises from the two.',
      'Press “Use records”, review the preview in the workspace, then Extract.',
    ],
  },
  {
    title: 'Write your own CSS selectors or XPath',
    steps: [
      'Open Advanced Selectors and try an expression: you see how many elements match and what they contain.',
      'Set a row selector (one element per record), then add fields. Field selectors are evaluated inside each row.',
      'Choose what to read from each match: text, HTML, link URL, image URL or any attribute.',
      'XPath can return attributes (//a/@href) and values (count(//li)). Inside rows, an expression starting with // is treated as .// .',
    ],
  },
  {
    title: 'Extract several pages or an infinite-scroll page',
    steps: [
      'First make sure the extraction works on one page (a table, a selector rule, links or images).',
      'Open Pagination, choose what to extract, and set the limits: maximum pages or scrolls, records, delay.',
      'Press Start. The page is brought to the front while {name} works; press Stop at any time and keep what was collected.',
      'The run ends at your limits, on the last page, or when a page adds nothing new. The reason is always shown.',
    ],
  },
  {
    title: 'Extract a list of pages (Batch URLs)',
    steps: [
      'Set up an extraction that works on one page: a selector rule, a recipe, tables, metadata or contacts.',
      'Open Batch URLs and paste the page addresses, one per line, or take them from a URL column of data you already extracted (for example the product links of a listing).',
      'Press Visit. Each page is opened in the connected tab in turn; every row gets a “Source URL” column. Pages that fail are listed and the rest continue.',
      '{name} can only read pages on the site you invoked it on, unless you granted access to another site.',
    ],
  },
  {
    title: 'Import a file',
    steps: [
      'In the Data Preview press Import and choose a CSV, TSV, JSON or JSON Lines file, or a {name} project file.',
      'The file is read by your browser and opens as a dataset you can clean, combine with extracted data and export. It is not uploaded.',
    ],
  },
  {
    title: 'Clean and filter data',
    steps: [
      'In the Data Preview, double-click a cell to edit it, click a header to sort, drag a header to reorder, drag its edge to resize.',
      'Use Clean for trimming, removing duplicates or empty rows, find and replace, splitting and combining columns, and case changes.',
      'The column menu (⋮) adds number extraction, date parsing and URL normalisation.',
      'Filters and search only change what is shown. Every change can be undone, and “Restore original” brings back the data exactly as extracted.',
    ],
  },
  {
    title: 'Export',
    steps: [
      'Press Export and choose CSV, Excel (XLSX), JSON, JSON Lines or TSV, or use Copy to paste straight into a spreadsheet.',
      'Text is saved as UTF-8, so বাংলা and other scripts are preserved. For Excel, keep the UTF-8 marker on for CSV.',
      'Formula-injection protection stops spreadsheet apps from running page text such as =HYPERLINK(…) as a formula.',
    ],
  },
  {
    title: 'Projects and recipes',
    steps: [
      'Save in the Data Preview stores the open datasets as a project in this browser. Reopen, rename, move into folders, export or delete projects on the Projects screen.',
      'A recipe stores how to extract (selectors, fields, pagination limits), not the data. Save one from the Visual Selector, Advanced Selectors or Pagination screen.',
      'Recipes are offered on the Home screen when the connected page matches their URL pattern.',
    ],
  },
];

const DOES: string[] = [
  'Reads only the tab you invoke it on, and only when you ask.',
  'Processes everything on your device.',
  'Stores projects and recipes locally, and only when you save them.',
  'Works without an account, subscription or usage limit.',
];

const DOES_NOT: string[] = [
  'Upload, sell or share your data. It makes no network requests of its own.',
  'Track you, show ads or collect analytics.',
  'Bypass logins, paywalls, CAPTCHAs or anti-bot protections.',
  'Crawl in the background, rotate proxies or disguise itself.',
];

const LIMITS: string[] = [
  'Chrome blocks all extensions on browser pages (chrome://…), the Chrome Web Store and a few other protected pages.',
  'Content inside cross-origin frames and closed shadow roots is not reachable. Same-origin frames and open shadow roots are.',
  'PDF files and images are not parsed (no OCR).',
  'Access granted by clicking the icon lasts while the tab stays on the same site. Pagination that moves to another site needs “Grant access”.',
  'Image extraction lists image addresses; it does not download the files.',
  'Unsaved data lives in the workspace tab. Closing the tab without saving or exporting discards it.',
  'Very large pages are processed in slices to keep the browser responsive; a table with hundreds of thousands of rows can take a while.',
  'Local files (file://) work only if you enable “Allow access to file URLs” for {name} in Chrome’s extension settings.',
];

export function HelpPage() {
  const update = useUi((state) => state.updateSettings);
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
  useEffect(() => {
    chrome.commands.getAll().then(setCommands).catch(() => setCommands([]));
  }, []);
  const name = { name: brand.name };

  return (
    <div className="page-enter mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <PageHeader title={t('Help & About')} description={brand.positioning} />

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-semibold">{t('How to…')}</h2>
        <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {TOPICS.map((topic, index) => (
            <details key={topic.title} className="group py-2" open={index === 0}>
              <summary className="flex items-center justify-between gap-3 py-1 text-[13px] font-medium marker:content-none">
                {t(topic.title)}
                <span className="text-zinc-400 transition-transform group-open:rotate-90" aria-hidden>
                  ›
                </span>
              </summary>
              <ol className="mt-1 mb-2 ml-5 list-decimal space-y-1 text-[13px] text-zinc-700 dark:text-zinc-300">
                {topic.steps.map((step) => (
                  <li key={step}>{t(step, name)}</li>
                ))}
              </ol>
            </details>
          ))}
        </div>
        <div className="mt-3">
          <Button onClick={() => void update({ onboardingDone: false })} data-testid="replay-onboarding">
            {t('Show the introduction')}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">{t('Keyboard shortcuts')}</h2>
        <table className="w-full text-[13px]">
          <tbody>
            {commands.map((command) => (
              <tr key={command.name} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="py-1.5 pr-4">{command.name === '_execute_action' ? t('Open the {name} popup', name) : command.description}</td>
                <td className="py-1.5 text-right whitespace-nowrap">{command.shortcut ? <Kbd>{command.shortcut}</Kbd> : <span className="text-zinc-400">{t('Not set')}</span>}</td>
              </tr>
            ))}
            {[
              ['Ctrl / ⌘ + F', 'Search the data'],
              ['Ctrl / ⌘ + Z', 'Undo the last change'],
              ['Ctrl / ⌘ + Shift + Z', 'Redo'],
              ['Ctrl / ⌘ + S', 'Save as project'],
              ['Ctrl / ⌘ + E', 'Export'],
              ['Enter / F2', 'Edit the selected cell'],
              ['Arrow keys', 'Move between cells'],
              ['Space', 'Select the current row'],
              ['Esc', 'Cancel editing, or leave the visual selector'],
            ].map(([keys, action]) => (
              <tr key={keys} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="py-1.5 pr-4">{t(action)}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <Kbd>{keys}</Kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-brand-600" aria-hidden />
            {t('What {name} does', name)}
          </h2>
          <ul className="space-y-1.5 text-[13px]">
            {DOES.map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                {t(item)}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Ban className="size-4 text-red-600" aria-hidden />
            {t('What {name} does not do', name)}
          </h2>
          <ul className="space-y-1.5 text-[13px]">
            {DOES_NOT.map((item) => (
              <li key={item} className="flex gap-2">
                <Ban className="mt-0.5 size-4 shrink-0 text-red-500" aria-hidden />
                {t(item)}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-semibold">{t('Known limitations')}</h2>
        <ul className="ml-5 list-disc space-y-1 text-[13px] text-zinc-700 dark:text-zinc-300">
          {LIMITS.map((item) => (
            <li key={item}>{t(item, name)}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-500">{t('Use {name} only on content you are allowed to access, and respect each website’s terms and applicable law.', name)}</p>
      </Card>

      <Card className="relative flex flex-wrap items-center gap-4 overflow-hidden p-5" data-testid="about">
        <Aurora />
        <Logo className="relative size-12 drop-shadow-[0_6px_14px_rgb(16_169_116/0.5)]" />
        <div className="relative min-w-0 flex-1">
          <div className="text-base font-semibold">
            {brand.name} <span className="text-xs font-normal text-zinc-500">{t('version {version}', { version: APP_VERSION })}</span>
          </div>
          <div className="text-[13px] text-zinc-600 dark:text-zinc-400">
            {brand.tagline} · {brand.attribution}
          </div>
          <div className="mt-1 text-xs text-zinc-500">{brand.motto}</div>
          <div className="mt-2 text-xs">
            <span className="text-zinc-500">{brand.copyright}. </span>
            <Credits />
          </div>
        </div>
        <ul className="relative flex flex-wrap gap-1.5 text-xs">
          {brand.promises.map((promise) => (
            <li key={promise} className="rounded-full bg-brand-50 px-2.5 py-1 font-medium text-brand-800 dark:bg-brand-950 dark:text-brand-300">
              {promise}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
