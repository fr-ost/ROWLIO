// Projects: extraction results saved on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, FileJson, FolderInput, FolderOpen, MoreHorizontal, Pencil, Search, Trash2, Upload } from 'lucide-react';
import type { ProjectMeta } from '@/types';
import { brand } from '@/config/brand';
import { formatNumber, t } from '@/i18n';
import { slugify } from '@/utils/text';
import { deleteProject, duplicateProject, exportProjectFile, getProject, importProjectFile, listProjects, updateProjectMeta } from '@/storage/projects';
import { useData } from '@/app/stores/data';
import { navigate, toast, useUi } from '@/app/stores/ui';
import { exportSheets } from '@/app/services/exportData';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Menu, PageHeader, Select, Spinner, Textarea, IconButton, type MenuItem } from '@/app/components/ui';

function formatDate(time: number): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function saveJsonFile(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ProjectsPage() {
  const exportDefaults = useUi((state) => state.settings.export);
  const openProjectId = useData((state) => state.project.id);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('__all__');
  const [editing, setEditing] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);
  const [replacing, setReplacing] = useState<ProjectMeta | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (error) {
      setProjects([]);
      toast.error(t('Could not read saved projects'), error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const folders = useMemo(() => Array.from(new Set((projects ?? []).map((project) => project.folder).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [projects]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (projects ?? []).filter((project) => {
      if (folder === '__none__' && project.folder) return false;
      if (folder !== '__all__' && folder !== '__none__' && project.folder !== folder) return false;
      if (!needle) return true;
      return [project.name, project.folder, project.notes, project.sourceTitle, project.sourceUrl].some((value) => value.toLowerCase().includes(needle));
    });
  }, [projects, query, folder]);

  const open = async (project: ProjectMeta) => {
    setBusy(project.id);
    try {
      const loaded = await getProject(project.id);
      if (!loaded) {
        toast.error(t('That project no longer exists.'));
        await reload();
        return;
      }
      useData.getState().open(loaded.datasets, { replace: true, project: { id: loaded.meta.id, name: loaded.meta.name, folder: loaded.meta.folder } });
      if (loaded.datasets.length === 0) toast.info(t('“{name}” has no datasets.', { name: loaded.meta.name }));
      else navigate('/data');
    } catch (error) {
      toast.error(t('Could not open the project'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const requestOpen = (project: ProjectMeta) => {
    const state = useData.getState();
    if (state.items.length > 0 && state.dirty) setReplacing(project);
    else void open(project);
  };

  const exportAs = async (project: ProjectMeta, format: 'xlsx' | 'csv' | 'json') => {
    setBusy(project.id);
    try {
      const loaded = await getProject(project.id);
      if (!loaded || loaded.datasets.length === 0) {
        toast.info(t('“{name}” has no data to export.', { name: project.name }));
        return;
      }
      const outcome = await exportSheets(
        loaded.datasets.map((dataset) => ({ name: dataset.name, data: { columns: dataset.columns, rows: dataset.rows } })),
        { format, delimiter: exportDefaults.csvDelimiter, bom: exportDefaults.csvBom, formulaGuard: exportDefaults.formulaGuard, jsonPretty: exportDefaults.jsonPretty, xlsxTypes: exportDefaults.xlsxTypes, includeHeader: true },
        project.name,
      );
      toast.success(t('Exported {rows} rows to {count} file(s)', { rows: formatNumber(outcome.rows), count: outcome.files.length }));
    } catch (error) {
      toast.error(t('Export failed'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const exportFile = async (project: ProjectMeta) => {
    try {
      saveJsonFile(await exportProjectFile(project.id), `${brand.filePrefix}-${slugify(project.name) || 'project'}${brand.projectFileExtension}`);
      toast.success(t('Project file saved to your downloads folder'), t('Import it again here, on this or another device.'));
    } catch (error) {
      toast.error(t('Could not export the project'), error instanceof Error ? error.message : String(error));
    }
  };

  const importFile = async (file: File) => {
    try {
      const meta = await importProjectFile(JSON.parse(await file.text()));
      toast.success(t('Imported “{name}”', { name: meta.name }), t('{rows} rows in {count} dataset(s).', { rows: formatNumber(meta.rowCount), count: meta.datasetCount }));
      await reload();
    } catch (error) {
      toast.error(t('That file could not be imported'), error instanceof SyntaxError ? t('It is not a valid {name} project file.', { name: brand.name }) : error instanceof Error ? error.message : String(error));
    }
  };

  const menuFor = (project: ProjectMeta): MenuItem[] => [
    { label: t('Rename / move…'), icon: Pencil, onSelect: () => setEditing(project) },
    {
      label: t('Duplicate'),
      icon: Copy,
      onSelect: async () => {
        try {
          const copy = await duplicateProject(project.id);
          toast.success(t('Created “{name}”', { name: copy.name }));
          await reload();
        } catch (error) {
          toast.error(t('Could not duplicate the project'), error instanceof Error ? error.message : String(error));
        }
      },
    },
    { type: 'separator' },
    { type: 'label', label: t('Export') },
    { label: t('Excel workbook (XLSX)'), icon: Download, onSelect: () => void exportAs(project, 'xlsx') },
    { label: t('CSV (one file per dataset)'), icon: Download, onSelect: () => void exportAs(project, 'csv') },
    { label: t('JSON (one file per dataset)'), icon: Download, onSelect: () => void exportAs(project, 'json') },
    { label: t('{name} project file (backup)', { name: brand.name }), icon: FileJson, onSelect: () => void exportFile(project) },
    { type: 'separator' },
    { label: t('Delete…'), icon: Trash2, danger: true, onSelect: () => setDeleting(project) },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <PageHeader
        title={t('Projects')}
        description={t('Extraction results you chose to save. They are stored in this browser only and you can delete them at any time.')}
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="project-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importFile(file);
              }}
            />
            <Button icon={Upload} onClick={() => fileInput.current?.click()}>
              {t('Import project file')}
            </Button>
          </>
        }
      />

      {projects === null ? (
        <div className="py-10 text-center">
          <Spinner label={t('Loading projects…')} />
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderOpen}
            title={t('No saved projects yet')}
            description={t('After extracting data, press Save in the Data Preview to keep it here. Until you do, extracted data lives only in the open workspace tab.')}
            action={
              <Button variant="primary" onClick={() => navigate('/')}>
                {t('Go to Extract')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-72 max-w-full">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-zinc-400" aria-hidden />
              <Input type="search" className="pl-8" value={query} placeholder={t('Search projects…')} aria-label={t('Search projects')} onChange={(event) => setQuery(event.target.value)} data-testid="project-search" />
            </div>
            <Select className="w-52" value={folder} aria-label={t('Folder')} onChange={(event) => setFolder(event.target.value)}>
              <option value="__all__">{t('All folders')}</option>
              <option value="__none__">{t('No folder')}</option>
              {folders.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <span className="ml-auto text-xs text-zinc-500">{t('{shown} of {total} projects', { shown: visible.length, total: projects.length })}</span>
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState icon={Search} title={t('No projects match')} description={t('Try a different search or folder.')} />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800" data-testid="project-list">
                {visible.map((project) => (
                  <li key={project.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="project-row">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-semibold" data-testid="project-title">
                          {project.name}
                        </span>
                        {project.folder ? (
                          <Badge>
                            <FolderInput className="mr-1 size-3" aria-hidden />
                            {project.folder}
                          </Badge>
                        ) : null}
                        {openProjectId === project.id ? <Badge tone="brand">{t('Open')}</Badge> : null}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-zinc-500">
                        {t('{rows} rows · {count} dataset(s) · updated {date}', { rows: formatNumber(project.rowCount), count: project.datasetCount, date: formatDate(project.updatedAt) })}
                        {project.sourceTitle || project.sourceUrl ? ` · ${project.sourceTitle || project.sourceUrl}` : ''}
                      </div>
                      {project.notes ? <div className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-400">{project.notes}</div> : null}
                    </div>
                    <Button size="sm" variant="primary" loading={busy === project.id} onClick={() => requestOpen(project)} data-testid="open-project">
                      {t('Open')}
                    </Button>
                    <Menu
                      label={t('Actions for {name}', { name: project.name })}
                      align="end"
                      items={menuFor(project)}
                      trigger={({ ref, ...props }) => <IconButton ref={ref as (el: HTMLButtonElement | null) => void} icon={MoreHorizontal} label={t('Actions for {name}', { name: project.name })} data-testid="project-menu" {...props} />}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <EditProjectDialog
        project={editing}
        folders={folders}
        onClose={() => setEditing(null)}
        onSaved={async (meta) => {
          if (useData.getState().project.id === meta.id) {
            const state = useData.getState();
            useData.setState({ project: { ...state.project, name: meta.name, folder: meta.folder } });
          }
          await reload();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('Delete this project?')}
        message={t('“{name}” and its {rows} rows will be permanently removed from this browser. This cannot be undone.', { name: deleting?.name ?? '', rows: formatNumber(deleting?.rowCount ?? 0) })}
        confirmLabel={t('Delete project')}
        danger
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteProject(deleting.id);
            if (useData.getState().project.id === deleting.id) useData.setState({ project: { id: null, name: '', folder: '' }, dirty: useData.getState().items.length > 0 });
            toast.success(t('Deleted “{name}”', { name: deleting.name }));
            await reload();
          } catch (error) {
            toast.error(t('Could not delete the project'), error instanceof Error ? error.message : String(error));
          }
        }}
      />
      <ConfirmDialog
        open={replacing !== null}
        onClose={() => setReplacing(null)}
        title={t('Replace the open data?')}
        message={t('The Data Preview holds changes that are not saved in a project. Opening “{name}” replaces them.', { name: replacing?.name ?? '' })}
        confirmLabel={t('Open project')}
        onConfirm={() => {
          if (replacing) void open(replacing);
        }}
      />
    </div>
  );
}

function EditProjectDialog({ project, folders, onClose, onSaved }: { project: ProjectMeta | null; folders: string[]; onClose: () => void; onSaved: (meta: ProjectMeta) => void | Promise<void> }) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (project) {
      setName(project.name);
      setFolder(project.folder);
      setNotes(project.notes);
      setError('');
    }
  }, [project]);

  const save = async () => {
    if (!project) return;
    if (!name.trim()) {
      setError(t('Give the project a name.'));
      return;
    }
    try {
      const meta = await updateProjectMeta(project.id, { name, folder, notes });
      toast.success(t('Project updated'));
      await onSaved(meta);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <Dialog
      open={project !== null}
      onClose={onClose}
      title={t('Rename or move project')}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={() => void save()} data-testid="edit-project-save">
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('Name')} error={error}>
          {(id) => <Input id={id} value={name} autoFocus onChange={(event) => setName(event.target.value)} data-testid="edit-project-name" />}
        </Field>
        <Field label={t('Folder')} hint={t('Type a new folder name, pick an existing one, or leave empty.')}>
          {(id) => (
            <>
              <Input id={id} value={folder} list={`${id}-list`} onChange={(event) => setFolder(event.target.value)} data-testid="edit-project-folder" />
              <datalist id={`${id}-list`}>
                {folders.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label={t('Notes')}>{(id) => <Textarea id={id} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
