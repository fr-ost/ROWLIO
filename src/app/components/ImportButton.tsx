// "Import file" – brings a local CSV / TSV / JSON / JSON Lines / project file into the
// Data Preview. The file is read by the browser; it is not uploaded anywhere.
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { formatNumber, t } from '@/i18n';
import { datasetFromRaw } from '@/data-processing/dataset';
import { parseImportFile } from '@/data-processing/importFile';
import { useData } from '@/app/stores/data';
import { navigate, toast } from '@/app/stores/ui';
import { Button } from './ui';

export async function importFile(file: File): Promise<boolean> {
  try {
    const result = parseImportFile(file.name, await file.text());
    const datasets = result.project.length > 0 ? result.project : result.raw.map((raw) => datasetFromRaw(raw, { url: '', title: file.name }));
    useData.getState().open(datasets);
    const rows = datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0);
    toast.success(t('Imported {rows} rows from {file}', { rows: formatNumber(rows), file: file.name }));
    navigate('/data');
    return true;
  } catch (error) {
    toast.error(t('That file could not be imported'), error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function ImportButton({ compact }: { compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson,text/csv,application/json"
        className="hidden"
        data-testid="import-file-input"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            await importFile(file);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button icon={Upload} loading={busy} onClick={() => input.current?.click()} title={t('Import a CSV, TSV, JSON or JSON Lines file')} data-testid="import-file">
        {compact ? t('Import') : t('Import a file')}
      </Button>
    </>
  );
}
