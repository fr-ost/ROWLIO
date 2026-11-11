// Dialogs used by the Data Preview: export, save project, find & replace, split,
// combine, filter, rename.
import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { Column, ColumnFilter, ExportFormat, ExportOptions, FilterCondition, TableData, TransformOp } from '@/types';
import { formatNumber, t } from '@/i18n';
import { listProjects, saveProject } from '@/storage/projects';
import { XlsxLimitError } from '@/export';
import { summarizeColumn } from '@/data-processing/summary';
import type { OpenDataset, ProjectRef } from '@/app/stores/data';
import { toast, useUi } from '@/app/stores/ui';
import { exportSheets, FORMAT_LABELS, formatBytes, type Sheet } from '@/app/services/exportData';
import { Button, Checkbox, Dialog, Field, Input, Notice, ProgressBar, Segmented, Select, Textarea } from './ui';

// ---- Export ------------------------------------------------------------------------------------

type RowScope = 'all' | 'filtered' | 'selected';

export function ExportDialog({
  open,
  onClose,
  active,
  items,
  viewIndexes,
  projectName,
}: {
  open: boolean;
  onClose: () => void;
  active: OpenDataset;
  items: OpenDataset[];
  viewIndexes: number[];
  projectName: string;
}) {
  const defaults = useUi((state) => state.settings.export);
  const updateSettings = useUi((state) => state.updateSettings);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [scope, setScope] = useState<RowScope>('all');
  const [allDatasets, setAllDatasets] = useState(false);
  const [options, setOptions] = useState(defaults);
  const [includeHeader, setIncludeHeader] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setOptions(defaults);
      setProgress(null);
      setError('');
      setScope('all');
    }
  }, [open, defaults]);

  const total = active.dataset.rows.length;
  const filtered = viewIndexes.length;
  const selected = active.selectedRows.size;
  const rowsFor = (item: OpenDataset): TableData => {
    if (item !== active || scope === 'all') return { columns: item.dataset.columns, rows: item.dataset.rows };
    if (scope === 'filtered') return { columns: item.dataset.columns, rows: viewIndexes.map((index) => item.dataset.rows[index]) };
    return { columns: item.dataset.columns, rows: item.dataset.rows.filter((row) => item.selectedRows.has(row.id)) };
  };
  const sheets: Sheet[] = (allDatasets ? items : [active]).map((item) => ({ name: item.dataset.name, data: rowsFor(item) }));
  const rowCount = sheets.reduce((sum, sheet) => sum + sheet.data.rows.length, 0);
  const busy = progress !== null;
  const isText = format === 'csv' || format === 'tsv';

  const run = async () => {
    setError('');
    setProgress({ done: 0, total: rowCount });
    const exportOptions: ExportOptions = {
      format,
      delimiter: options.csvDelimiter,
      bom: options.csvBom,
      formulaGuard: options.formulaGuard,
      jsonPretty: options.jsonPretty,
      xlsxTypes: options.xlsxTypes,
      includeHeader,
    };
    try {
      const outcome = await exportSheets(sheets, exportOptions, projectName || active.dataset.name, (done, totalRows) => setProgress({ done, total: totalRows }));
      void updateSettings({ export: options });
      toast.success(
        outcome.files.length === 1 ? t('Exported {rows} rows to {file}', { rows: formatNumber(outcome.rows), file: outcome.files[0] }) : t('Exported {rows} rows to {count} files', { rows: formatNumber(outcome.rows), count: outcome.files.length }),
        t('{size} · saved to your downloads folder', { size: formatBytes(outcome.bytes) }),
      );
      onClose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(caught instanceof XlsxLimitError || (caught instanceof Error && caught.name === 'XlsxLimitError') ? t('{message} Export as CSV or JSON instead, which have no such limit.', { message }) : message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={t('Export data')}
      description={t('Files are created in your browser and saved to your downloads folder.')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" onClick={() => void run()} loading={busy} disabled={rowCount === 0} data-testid="export-confirm">
            {t('Export {rows} rows', { rows: formatNumber(rowCount) })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('Format')}>
          {(id) => (
            <Select id={id} value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} data-testid="export-format">
              {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((value) => (
                <option key={value} value={value}>
                  {FORMAT_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t('Rows')}>
          {(id) => (
            <Select id={id} value={scope} onChange={(event) => setScope(event.target.value as RowScope)}>
              <option value="all">{t('All rows ({count})', { count: formatNumber(total) })}</option>
              <option value="filtered" disabled={filtered === total}>
                {t('Rows matching the current search / filters ({count})', { count: formatNumber(filtered) })}
              </option>
              <option value="selected" disabled={selected === 0}>
                {t('Selected rows ({count})', { count: formatNumber(selected) })}
              </option>
            </Select>
          )}
        </Field>

        {items.length > 1 ? (
          <Checkbox
            checked={allDatasets}
            onChange={setAllDatasets}
            label={t('Include all {count} open datasets', { count: items.length })}
            description={format === 'xlsx' ? t('Each dataset becomes a sheet in one workbook.') : t('One file per dataset.')}
          />
        ) : null}

        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          {format !== 'json' && format !== 'jsonl' && format !== 'markdown' ? <Checkbox checked={includeHeader} onChange={setIncludeHeader} label={t('Include the header row')} /> : null}
          {format === 'csv' ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span>{t('Delimiter')}</span>
              <Segmented
                label={t('Delimiter')}
                value={options.csvDelimiter}
                onChange={(csvDelimiter) => setOptions({ ...options, csvDelimiter })}
                options={[
                  { value: ',', label: t('Comma') },
                  { value: ';', label: t('Semicolon') },
                ]}
              />
            </div>
          ) : null}
          {isText ? (
            <>
              <Checkbox checked={options.csvBom} onChange={(csvBom) => setOptions({ ...options, csvBom })} label={t('Add a UTF-8 marker (BOM)')} description={t('Lets Excel show বাংলা and other non-Latin text correctly.')} />
              <Checkbox
                checked={options.formulaGuard}
                onChange={(formulaGuard) => setOptions({ ...options, formulaGuard })}
                label={t('Protect against formula injection (recommended)')}
                description={t("Cells starting with =, +, - or @ get a leading apostrophe so spreadsheet apps treat them as text, not formulas. Plain numbers such as -12.5 are left alone.")}
              />
            </>
          ) : null}
          {format === 'markdown' ? <p className="text-xs text-zinc-500">{t('A GitHub-style Markdown table. Line breaks inside cells become <br>.')}</p> : null}
          {format === 'html' ? (
            <>
              <Checkbox
                checked={options.formulaGuard}
                onChange={(formulaGuard) => setOptions({ ...options, formulaGuard })}
                label={t('Protect against formula injection (recommended)')}
                description={t('Spreadsheet apps can open HTML tables and run cells that look like formulas. Cells starting with =, +, - or @ get a leading apostrophe.')}
              />
              <p className="text-xs text-zinc-500">{t('A self-contained web page with one table. Cell text is escaped; the file contains no scripts.')}</p>
            </>
          ) : null}
          {format === 'json' ? <Checkbox checked={options.jsonPretty} onChange={(jsonPretty) => setOptions({ ...options, jsonPretty })} label={t('Pretty-print (indented)')} /> : null}
          {format === 'xlsx' ? (
            <>
              <Checkbox checked={options.xlsxTypes} onChange={(xlsxTypes) => setOptions({ ...options, xlsxTypes })} label={t('Store plain numbers and ISO dates as real numbers / dates')} description={t('Values such as 00123 or +880… always stay text.')} />
              <Notice tone="brand" icon={ShieldCheck}>
                {t('Text is always written as text, never as a formula, so XLSX exports cannot trigger formula injection.')}
              </Notice>
            </>
          ) : null}
        </div>

        {progress ? (
          <div className="flex flex-col gap-1" aria-live="polite">
            <ProgressBar value={progress.total ? progress.done / progress.total : undefined} label={t('Export progress')} />
            <span className="text-xs text-zinc-500">{t('{done} of {total} rows written', { done: formatNumber(progress.done), total: formatNumber(progress.total) })}</span>
          </div>
        ) : null}
        {error ? (
          <Notice tone="red" role="alert">
            {error}
          </Notice>
        ) : null}
      </div>
    </Dialog>
  );
}

// ---- Save project -------------------------------------------------------------------------------

export function SaveProjectDialog({
  open,
  onClose,
  items,
  project,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  items: OpenDataset[];
  project: ProjectRef;
  onSaved: (project: ProjectRef) => void;
}) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [notes, setNotes] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(project.name || items[0]?.dataset.name || '');
    setFolder(project.folder);
    setNotes('');
    setError('');
    listProjects()
      .then((all) => setFolders(Array.from(new Set(all.map((p) => p.folder).filter(Boolean))).sort()))
      .catch(() => setFolders([]));
  }, [open, project, items]);

  const rows = items.reduce((sum, item) => sum + item.dataset.rows.length, 0);

  const save = async (asNew: boolean) => {
    if (!name.trim()) {
      setError(t('Give the project a name.'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const meta = await saveProject({
        id: asNew ? undefined : (project.id ?? undefined),
        name: name.trim(),
        folder: folder.trim(),
        notes: notes.trim() || undefined,
        datasets: items.map((item) => item.dataset),
      });
      onSaved({ id: meta.id, name: meta.name, folder: meta.folder });
      toast.success(t('Project “{name}” saved', { name: meta.name }), t('{rows} rows in {count} dataset(s), stored on this device only.', { rows: formatNumber(meta.rowCount), count: meta.datasetCount }));
      onClose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(/quota/i.test(message) ? t('The browser’s storage quota is full. Delete old projects or export this data to a file instead.') : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project.id ? t('Save project') : t('Save as project')}
      description={t('Projects are stored in this browser (IndexedDB). Nothing is uploaded.')}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('Cancel')}
          </Button>
          {project.id ? (
            <Button onClick={() => void save(true)} disabled={saving}>
              {t('Save as new')}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void save(false)} loading={saving} data-testid="save-project-confirm">
            {project.id ? t('Save changes') : t('Save project')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('Name')} error={error}>
          {(id) => <Input id={id} value={name} autoFocus onChange={(event) => setName(event.target.value)} data-testid="project-name" />}
        </Field>
        <Field label={t('Folder')} hint={t('Optional. Type a new name or choose an existing folder.')}>
          {(id) => (
            <>
              <Input id={id} value={folder} list={`${id}-folders`} onChange={(event) => setFolder(event.target.value)} />
              <datalist id={`${id}-folders`}>
                {folders.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label={t('Notes')}>{(id) => <Textarea id={id} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />}</Field>
        <p className="text-xs text-zinc-500">{t('{count} dataset(s), {rows} rows will be saved.', { count: items.length, rows: formatNumber(rows) })}</p>
      </div>
    </Dialog>
  );
}

// ---- Find & replace -----------------------------------------------------------------------------

export function FindReplaceDialog({
  open,
  onClose,
  columns,
  initialColumn,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  columns: Column[];
  initialColumn: string | null;
  onApply: (op: TransformOp) => Promise<boolean>;
}) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [column, setColumn] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeCell, setWholeCell] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setColumn(initialColumn ?? '');
      setError('');
    }
  }, [open, initialColumn]);

  const apply = async () => {
    if (!find) {
      setError(t('Enter the text to find.'));
      return;
    }
    if (regex) {
      try {
        new RegExp(find);
      } catch (caught) {
        setError(t('Invalid regular expression: {detail}', { detail: caught instanceof Error ? caught.message : '' }));
        return;
      }
    }
    setError('');
    const done = await onApply({ type: 'findReplace', columns: column ? [column] : undefined, find, replace, regex, caseSensitive, wholeCell });
    if (done) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Find and replace')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void apply()} data-testid="find-replace-apply">
            {t('Replace all')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('Find')} error={error}>
          {(id) => <Input id={id} value={find} autoFocus onChange={(event) => setFind(event.target.value)} data-testid="find-input" />}
        </Field>
        <Field label={t('Replace with')} hint={regex ? t('Use $1, $2… for captured groups.') : t('Leave empty to delete the matches.')}>
          {(id) => <Input id={id} value={replace} onChange={(event) => setReplace(event.target.value)} data-testid="replace-input" />}
        </Field>
        <Field label={t('In')}>
          {(id) => (
            <Select id={id} value={column} onChange={(event) => setColumn(event.target.value)}>
              <option value="">{t('All columns')}</option>
              {columns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <Checkbox checked={caseSensitive} onChange={setCaseSensitive} label={t('Match case')} />
          <Checkbox checked={wholeCell} onChange={setWholeCell} label={t('Match the whole cell')} />
          <Checkbox checked={regex} onChange={setRegex} label={t('Regular expression')} />
        </div>
      </div>
    </Dialog>
  );
}

// ---- Split column -------------------------------------------------------------------------------

export function SplitDialog({
  open,
  onClose,
  columns,
  initialColumn,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  columns: Column[];
  initialColumn: string | null;
  onApply: (op: TransformOp) => Promise<boolean>;
}) {
  const [column, setColumn] = useState('');
  const [delimiter, setDelimiter] = useState(',');
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setColumn(initialColumn ?? columns[0]?.id ?? '');
      setError('');
    }
  }, [open, initialColumn, columns]);

  const apply = async () => {
    if (!delimiter) {
      setError(t('Enter a delimiter.'));
      return;
    }
    if (await onApply({ type: 'splitColumn', column, delimiter, keepOriginal })) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Split column')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void apply()} data-testid="split-apply">
            {t('Split')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('Column')}>
          {(id) => (
            <Select id={id} value={column} onChange={(event) => setColumn(event.target.value)}>
              {columns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('Delimiter')} hint={t('The text that separates the parts. Use \\t for a tab and \\n for a line break.')} error={error}>
          {(id) => <Input id={id} mono value={delimiter} onChange={(event) => setDelimiter(event.target.value)} data-testid="split-delimiter" />}
        </Field>
        <Checkbox checked={keepOriginal} onChange={setKeepOriginal} label={t('Keep the original column')} />
      </div>
    </Dialog>
  );
}

// ---- Combine columns ----------------------------------------------------------------------------

export function CombineDialog({
  open,
  onClose,
  columns,
  initialColumns,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  columns: Column[];
  initialColumns: string[];
  onApply: (op: TransformOp) => Promise<boolean>;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [separator, setSeparator] = useState(' ');
  const [name, setName] = useState('');
  const [removeSources, setRemoveSources] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setChosen(initialColumns);
      setName(t('Combined'));
      setError('');
    }
  }, [open, initialColumns]);

  const apply = async () => {
    if (chosen.length < 2) {
      setError(t('Choose at least two columns.'));
      return;
    }
    if (!name.trim()) {
      setError(t('Name the new column.'));
      return;
    }
    // Combine in the order the columns appear in the table.
    const ordered = columns.filter((column) => chosen.includes(column.id)).map((column) => column.id);
    if (await onApply({ type: 'combineColumns', columns: ordered, separator, name: name.trim(), removeSources })) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Combine columns')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void apply()} data-testid="combine-apply">
            {t('Combine')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('Columns to combine')}</legend>
          <div className="grid max-h-48 gap-1 overflow-auto rounded-md border border-zinc-200 p-2 sm:grid-cols-2 dark:border-zinc-800">
            {columns.map((column) => (
              <Checkbox
                key={column.id}
                checked={chosen.includes(column.id)}
                onChange={(on) => setChosen(on ? [...chosen, column.id] : chosen.filter((id) => id !== column.id))}
                label={column.name}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Separator')}>{(id) => <Input id={id} mono value={separator} onChange={(event) => setSeparator(event.target.value)} />}</Field>
          <Field label={t('New column name')}>{(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}</Field>
        </div>
        <Checkbox checked={removeSources} onChange={setRemoveSources} label={t('Remove the original columns')} />
        {error ? (
          <Notice tone="red" role="alert">
            {error}
          </Notice>
        ) : null}
      </div>
    </Dialog>
  );
}

// ---- Filter -------------------------------------------------------------------------------------

export const CONDITION_LABELS: Record<FilterCondition, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  equals: 'equals',
  notEquals: 'does not equal',
  startsWith: 'starts with',
  endsWith: 'ends with',
  empty: 'is empty',
  nonEmpty: 'is not empty',
  regex: 'matches regex',
};

export function FilterDialog({
  open,
  onClose,
  columns,
  initialColumn,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  columns: Column[];
  initialColumn: string | null;
  onAdd: (filter: ColumnFilter) => void;
}) {
  const [column, setColumn] = useState('');
  const [condition, setCondition] = useState<FilterCondition>('contains');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setColumn(initialColumn ?? columns[0]?.id ?? '');
      setValue('');
      setError('');
    }
  }, [open, initialColumn, columns]);
  const needsValue = condition !== 'empty' && condition !== 'nonEmpty';

  const add = () => {
    if (needsValue && !value) {
      setError(t('Enter a value to compare with.'));
      return;
    }
    if (condition === 'regex') {
      try {
        new RegExp(value);
      } catch {
        setError(t('Invalid regular expression.'));
        return;
      }
    }
    onAdd({ column, condition, value: needsValue ? value : '' });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Filter rows')}
      description={t('Filters only change what is shown; no data is removed.')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={add} data-testid="filter-apply">
            {t('Add filter')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Column')}>
          {(id) => (
            <Select id={id} value={column} onChange={(event) => setColumn(event.target.value)}>
              {columns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('Condition')}>
          {(id) => (
            <Select id={id} value={condition} onChange={(event) => setCondition(event.target.value as FilterCondition)} data-testid="filter-condition">
              {(Object.keys(CONDITION_LABELS) as FilterCondition[]).map((key) => (
                <option key={key} value={key}>
                  {t(CONDITION_LABELS[key])}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {needsValue ? (
          <Field label={t('Value')} className="sm:col-span-2" error={error}>
            {(id) => <Input id={id} value={value} autoFocus onChange={(event) => setValue(event.target.value)} data-testid="filter-value" />}
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}

// ---- Rename -------------------------------------------------------------------------------------

export function RenameDialog({
  open,
  onClose,
  title,
  label,
  initial,
  onRename,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  label: string;
  initial: string;
  onRename: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  const valid = useMemo(() => value.trim().length > 0, [value]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-sm"
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant="primary"
            disabled={!valid}
            data-testid="rename-confirm"
            onClick={() => {
              onRename(value.trim());
              onClose();
            }}
          >
            {t('Rename')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onRename(value.trim());
          onClose();
        }}
      >
        <Field label={label}>{(id) => <Input id={id} value={value} autoFocus onChange={(event) => setValue(event.target.value)} onFocus={(event) => event.target.select()} data-testid="rename-input" />}</Field>
      </form>
    </Dialog>
  );
}

// ---- Extract by pattern --------------------------------------------------------------------------

export function RegexDialog({
  open,
  onClose,
  columns,
  initialColumn,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  columns: Column[];
  initialColumn: string | null;
  onApply: (op: TransformOp) => Promise<boolean>;
}) {
  const [column, setColumn] = useState('');
  const [pattern, setPattern] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [target, setTarget] = useState<'new' | 'replace'>('new');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setColumn(initialColumn ?? columns[0]?.id ?? '');
      setError('');
    }
  }, [open, initialColumn, columns]);

  const apply = async () => {
    if (!pattern) {
      setError(t('Enter a pattern to look for.'));
      return;
    }
    try {
      new RegExp(pattern);
    } catch (caught) {
      setError(t('Invalid regular expression: {detail}', { detail: caught instanceof Error ? caught.message : '' }));
      return;
    }
    setError('');
    if (await onApply({ type: 'extractRegex', column, pattern, caseSensitive, target })) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Extract by pattern')}
      description={t('Pull the part of each cell that matches a regular expression, for example an order number or a postcode.')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void apply()} data-testid="regex-apply">
            {t('Extract')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('Column')}>
          {(id) => (
            <Select id={id} value={column} onChange={(event) => setColumn(event.target.value)}>
              {columns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('Pattern')} hint={t('If the pattern has a group in parentheses, the group is extracted; otherwise the whole match. Example: (\\d+) reviews')} error={error}>
          {(id) => <Input id={id} mono value={pattern} autoFocus spellCheck={false} onChange={(event) => setPattern(event.target.value)} data-testid="regex-pattern" />}
        </Field>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Segmented
            label={t('Where to put the result')}
            value={target}
            onChange={setTarget}
            options={[
              { value: 'new', label: t('New column') },
              { value: 'replace', label: t('Replace the cell') },
            ]}
          />
          <Checkbox checked={caseSensitive} onChange={setCaseSensitive} label={t('Match case')} />
        </div>
      </div>
    </Dialog>
  );
}

// ---- Add column ----------------------------------------------------------------------------------

export function AddColumnDialog({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (op: TransformOp) => Promise<boolean> }) {
  const [name, setName] = useState('');
  const [fill, setFill] = useState<'empty' | 'rowNumber' | 'value'>('empty');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setName('');
      setValue('');
      setFill('empty');
      setError('');
    }
  }, [open]);

  const apply = async () => {
    if (!name.trim()) {
      setError(t('Give the new column a name.'));
      return;
    }
    if (await onApply({ type: 'addColumn', name: name.trim(), fill, value })) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Add column')}
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void apply()} data-testid="add-column-apply">
            {t('Add column')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('Column name')} error={error}>
          {(id) => <Input id={id} value={name} autoFocus onChange={(event) => setName(event.target.value)} data-testid="add-column-name" />}
        </Field>
        <Field label={t('Fill with')}>
          {(id) => (
            <Select id={id} value={fill} onChange={(event) => setFill(event.target.value as typeof fill)} data-testid="add-column-fill">
              <option value="empty">{t('Nothing (empty cells)')}</option>
              <option value="rowNumber">{t('Row numbers (1, 2, 3 …)')}</option>
              <option value="value">{t('The same value in every row')}</option>
            </Select>
          )}
        </Field>
        {fill === 'value' ? <Field label={t('Value')}>{(id) => <Input id={id} value={value} onChange={(event) => setValue(event.target.value)} data-testid="add-column-value" />}</Field> : null}
      </div>
    </Dialog>
  );
}

// ---- Column summary ------------------------------------------------------------------------------

function formatStat(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

export function SummaryDialog({ open, onClose, data, columnIndex }: { open: boolean; onClose: () => void; data: TableData; columnIndex: number }) {
  const summary = useMemo(() => (open && columnIndex >= 0 && columnIndex < data.columns.length ? summarizeColumn(data, columnIndex) : null), [open, data, columnIndex]);
  if (!summary) return null;
  const stats: [string, string][] = [
    [t('Rows'), formatNumber(summary.total)],
    [t('Filled'), formatNumber(summary.filled)],
    [t('Empty'), formatNumber(summary.empty)],
    [t('Distinct values'), formatNumber(summary.distinct)],
    [t('Shortest / longest'), t('{min} / {max} characters', { min: summary.shortest, max: summary.longest })],
  ];
  if (summary.numeric) {
    stats.push(
      [t('Numeric cells'), formatNumber(summary.numeric.count)],
      [t('Sum'), formatStat(summary.numeric.sum)],
      [t('Average'), formatStat(summary.numeric.mean)],
      [t('Median'), formatStat(summary.numeric.median)],
      [t('Minimum'), formatStat(summary.numeric.min)],
      [t('Maximum'), formatStat(summary.numeric.max)],
    );
  }
  const most = summary.top[0]?.count ?? 1;
  return (
    <Dialog open={open} onClose={onClose} title={t('Summary of “{name}”', { name: summary.name })} footer={<Button onClick={onClose}>{t('Close')}</Button>}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3" data-testid="column-summary">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {summary.top.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{t('Most common values')}</h3>
          <ul className="flex flex-col gap-1">
            {summary.top.map((item) => (
              <li key={item.value} className="relative overflow-hidden rounded-md bg-zinc-50 px-2 py-1 text-xs dark:bg-zinc-800/60">
                <span className="bar-grow absolute inset-y-0 left-0 bg-brand-100 dark:bg-brand-900/50" style={{ width: `${(item.count / most) * 100}%` }} aria-hidden />
                <span className="relative flex items-center justify-between gap-3">
                  <span className="truncate">{item.value}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatNumber(item.count)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}
