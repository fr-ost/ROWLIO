// First-run introduction: five short steps, skippable at any time.
import { useEffect, useState } from 'react';
import { Ban, Download, HardDrive, MousePointerClick, Table2, type LucideIcon } from 'lucide-react';
import { brand } from '@/config/brand';
import { t } from '@/i18n';
import { useUi } from '@/app/stores/ui';
import { Button, Dialog } from './ui';

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
  points: string[];
}

const STEPS: Step[] = [
  {
    icon: Table2,
    title: 'Extract tables in one click',
    body: 'Open any page, click the {name} icon in Chrome’s toolbar and choose “Extract tables”.',
    points: ['Merged cells, multi-row headers and nested tables are handled.', 'Tables that appear after the page loads are picked up too.'],
  },
  {
    icon: MousePointerClick,
    title: 'Select repeated elements',
    body: 'For product cards, search results or listings, use the Visual Selector and click one item.',
    points: ['Similar items and their fields (title, price, image, link…) are detected.', 'Prefer code? Advanced Selectors accepts CSS and XPath.'],
  },
  {
    icon: Download,
    title: 'Clean, then export',
    body: 'Review the records in the Data Preview: edit, filter, remove duplicates, split or combine columns.',
    points: ['Export to CSV, Excel, JSON, JSON Lines or TSV, or copy to the clipboard.', 'Every change can be undone; the original extraction is always kept.'],
  },
  {
    icon: HardDrive,
    title: 'Your data stays on your device',
    body: 'Extraction and export happen inside your browser. Nothing is uploaded, and there is no account.',
    points: ['Data is stored only when you save a project, in this browser’s local storage.', 'You can delete saved projects, recipes and settings at any time in Settings.'],
  },
  {
    icon: Ban,
    title: 'What {name} does not do',
    body: '{name} reads pages you can already open in your browser, when you ask it to.',
    points: ['It does not bypass logins, paywalls, CAPTCHAs or anti-bot protections.', 'It does not crawl in the background, track you or show ads.', 'Chrome’s own pages and the Chrome Web Store cannot be read by any extension.'],
  },
];

export function Onboarding() {
  const loaded = useUi((state) => state.settingsLoaded);
  const done = useUi((state) => state.settings.onboardingDone);
  const update = useUi((state) => state.updateSettings);
  const [step, setStep] = useState(0);
  const open = loaded && !done;

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Reflect the state on <html> once it is known, so automation never has to guess
  // whether the introduction is about to appear.
  useEffect(() => {
    if (loaded) document.documentElement.dataset.onboarding = done ? 'done' : 'open';
  }, [loaded, done]);

  if (!open) return null;
  const current = STEPS[step];
  const Icon = current.icon;
  const last = step === STEPS.length - 1;
  const finish = () => void update({ onboardingDone: true });
  const name = { name: brand.name };

  return (
    <Dialog
      open
      onClose={finish}
      title={t('Welcome to {name}', name)}
      description={brand.tagline}
      width="max-w-xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Button variant="ghost" onClick={finish} data-testid="onboarding-skip">
            {t('Skip')}
          </Button>
          <div className="flex items-center gap-2">
            <span className="mr-2 text-xs text-zinc-500" aria-live="polite">
              {t('Step {n} of {total}', { n: step + 1, total: STEPS.length })}
            </span>
            <Button onClick={() => setStep(step - 1)} disabled={step === 0}>
              {t('Back')}
            </Button>
            <Button variant="primary" onClick={last ? finish : () => setStep(step + 1)} data-testid="onboarding-next">
              {last ? t('Get started') : t('Next')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex gap-4" data-testid="onboarding">
        <div key={step} className="brand-gradient pop-in float flex size-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_10px_24px_-8px_rgb(16_169_116/0.7)]">
          <Icon className="size-5" aria-hidden />
        </div>
        <div key={`text-${step}`} className="fade-in min-w-0">
          <h3 className="text-[15px] font-semibold">{t(current.title, name)}</h3>
          <p className="mt-1 text-[13px] text-zinc-700 dark:text-zinc-300">{t(current.body, name)}</p>
          <ul className="mt-2 ml-4 list-disc space-y-1 text-[13px] text-zinc-600 dark:text-zinc-400">
            {current.points.map((point) => (
              <li key={point}>{t(point, name)}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-5 flex justify-center gap-1.5" aria-hidden>
        {STEPS.map((_, index) => (
          <span key={index} className={index === step ? 'brand-gradient h-1.5 w-6 rounded-full transition-all duration-300' : 'size-1.5 rounded-full bg-zinc-300 transition-all duration-300 dark:bg-zinc-700'} />
        ))}
      </div>
    </Dialog>
  );
}
