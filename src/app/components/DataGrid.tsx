// Spreadsheet-like data viewer: virtualised rows (only what is on screen is in the DOM),
// column resize / reorder / rename, sorting, row + column selection, in-place cell editing
// and keyboard navigation.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, MoreVertical } from 'lucide-react';
import type { Column, ColumnStats, ColumnType, Row, SortSpec } from '@/types';
import { formatNumber, t } from '@/i18n';
import { Menu, cx, type MenuItem } from './ui';

export const ROW_HEIGHT = 30;
const HEADER_HEIGHT = 34;
const GUTTER_WIDTH = 68;
const DEFAULT_WIDTH = 190;
const MIN_WIDTH = 60;
const OVERSCAN = 8;
/** Browsers cap element heights (~33M px in Chrome); beyond this the scroll range is scaled. */
const MAX_SCROLL_HEIGHT = 15_000_000;

const TYPE_LABEL: Record<ColumnType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  url: 'URL',
  email: 'Email',
  boolean: 'Yes/No',
  empty: 'Empty',
  mixed: 'Mixed',
};
const TYPE_SHORT: Record<ColumnType, string> = {
  text: 'Abc',
  number: '123',
  date: 'Date',
  url: 'URL',
  email: '@',
  boolean: 'Y/N',
  empty: '∅',
  mixed: 'Mix',
};

export interface DataGridProps {
  columns: Column[];
  rows: Row[];
  /** Indexes into `rows`, in display order (after search / filter / sort). */
  view: number[];
  stats: ColumnStats[];
  widths: Record<string, number>;
  sort: SortSpec | null;
  selectedRows: Set<number>;
  selectedColumns: Set<string>;
  onSelectRows(next: Set<number>): void;
  onSelectColumns(next: Set<string>): void;
  onResize(columnId: string, width: number): void;
  onSort(columnId: string): void;
  onEditCell(rowId: number, columnId: string, value: string): void;
  onMoveColumn(columnId: string, toIndex: number): void;
  onRenameColumn(columnId: string): void;
  columnMenu(column: Column, index: number): MenuItem[];
}

interface CellPos {
  row: number; // index into view
  col: number;
}

interface RowProps {
  row: Row;
  displayIndex: number;
  top: number;
  columns: Column[];
  widthOf: (id: string) => number;
  totalWidth: number;
  selected: boolean;
  activeCol: number;
  selectedColumns: Set<string>;
  onToggle: (displayIndex: number, shift: boolean) => void;
  onCellClick: (displayIndex: number, col: number) => void;
  onCellDoubleClick: (displayIndex: number, col: number) => void;
}

const GridRow = memo(function GridRow({
  row,
  displayIndex,
  top,
  columns,
  widthOf,
  totalWidth,
  selected,
  activeCol,
  selectedColumns,
  onToggle,
  onCellClick,
  onCellDoubleClick,
}: RowProps) {
  return (
    <div
      role="row"
      aria-rowindex={displayIndex + 2}
      aria-selected={selected}
      data-row-id={row.id}
      className={cx(
        'absolute left-0 flex border-b border-zinc-100 dark:border-zinc-800/70',
        selected ? 'bg-brand-50 dark:bg-brand-950/60' : displayIndex % 2 ? 'bg-zinc-50/60 dark:bg-zinc-900/40' : 'bg-white dark:bg-zinc-950',
      )}
      style={{ top, height: ROW_HEIGHT, width: totalWidth }}
    >
      <div
        role="rowheader"
        className={cx(
          'sticky left-0 z-[1] flex shrink-0 items-center gap-2 border-r border-zinc-200 px-2 text-[11px] text-zinc-500 tabular-nums dark:border-zinc-800',
          selected ? 'bg-brand-50 dark:bg-brand-950' : 'bg-zinc-50 dark:bg-zinc-900',
        )}
        style={{ width: GUTTER_WIDTH }}
      >
        <input
          type="checkbox"
          className="size-3.5 accent-brand-600"
          checked={selected}
          aria-label={t('Select row {n}', { n: displayIndex + 1 })}
          onChange={() => undefined}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(displayIndex, event.shiftKey);
          }}
        />
        <span className="truncate">{displayIndex + 1}</span>
      </div>
      {columns.map((column, col) => {
        const value = row.cells[col] ?? '';
        return (
          <div
            key={column.id}
            role="gridcell"
            aria-colindex={col + 2}
            data-col={col}
            title={value.length > 24 ? value : undefined}
            onClick={() => onCellClick(displayIndex, col)}
            onDoubleClick={() => onCellDoubleClick(displayIndex, col)}
            className={cx(
              'flex shrink-0 items-center overflow-hidden border-r border-zinc-100 px-2 text-[12.5px] whitespace-pre text-zinc-800 dark:border-zinc-800/70 dark:text-zinc-200',
              selectedColumns.has(column.id) && 'bg-brand-50/70 dark:bg-brand-950/40',
              activeCol === col && 'outline-2 -outline-offset-2 outline-brand-500',
            )}
            style={{ width: widthOf(column.id) }}
          >
            {value === '' ? null : <span className="truncate">{value.length > 300 ? value.slice(0, 300) : value}</span>}
          </div>
        );
      })}
    </div>
  );
});

export function DataGrid(props: DataGridProps) {
  const { columns, rows, view, stats, widths, sort, selectedRows, selectedColumns } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [active, setActive] = useState<CellPos | null>(null);
  const [editing, setEditing] = useState<{ pos: CellPos; value: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const lastToggled = useRef<number | null>(null);
  const dragColumn = useRef<string | null>(null);

  const widthOf = useCallback((id: string) => widths[id] ?? DEFAULT_WIDTH, [widths]);
  const totalWidth = useMemo(() => GUTTER_WIDTH + columns.reduce((sum, column) => sum + widthOf(column.id), 0), [columns, widthOf]);
  const columnLeft = useMemo(() => {
    const lefts: number[] = [];
    let x = GUTTER_WIDTH;
    for (const column of columns) {
      lefts.push(x);
      x += widthOf(column.id);
    }
    return lefts;
  }, [columns, widthOf]);

  const count = view.length;
  const naturalHeight = count * ROW_HEIGHT;
  const scaled = naturalHeight > MAX_SCROLL_HEIGHT;
  const bodyHeight = scaled ? MAX_SCROLL_HEIGHT : naturalHeight;
  // When scaled, scroll position maps proportionally onto the full row range.
  const scrollRange = Math.max(1, bodyHeight - viewport);
  const rowOffset = scaled ? (scrollTop / scrollRange) * (naturalHeight - viewport) : scrollTop;
  const first = Math.max(0, Math.floor(rowOffset / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(count, Math.ceil((rowOffset + viewport) / ROW_HEIGHT) + OVERSCAN);
  const shift = scaled ? scrollTop - rowOffset : 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(Math.max(100, el.clientHeight - HEADER_HEIGHT));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the active cell valid when the data underneath changes.
  useEffect(() => {
    setEditing(null);
    setActive((current) => (current && (current.row >= count || current.col >= columns.length) ? null : current));
  }, [count, columns.length]);

  const ensureVisible = useCallback(
    (pos: CellPos) => {
      const el = scrollRef.current;
      if (!el) return;
      if (!scaled) {
        const top = pos.row * ROW_HEIGHT;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + ROW_HEIGHT > el.scrollTop + viewport) el.scrollTop = top + ROW_HEIGHT - viewport;
      }
      const left = columnLeft[pos.col] ?? 0;
      const right = left + widthOf(columns[pos.col]?.id ?? '');
      if (left - GUTTER_WIDTH < el.scrollLeft) el.scrollLeft = left - GUTTER_WIDTH;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    },
    [columnLeft, columns, scaled, viewport, widthOf],
  );

  const commitEdit = useCallback(() => {
    setEditing((current) => {
      if (current) {
        const row = rows[view[current.pos.row]];
        const column = columns[current.pos.col];
        if (row && column && (row.cells[current.pos.col] ?? '') !== current.value) props.onEditCell(row.id, column.id, current.value);
      }
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, view, columns, props.onEditCell]);

  const startEdit = useCallback(
    (pos: CellPos, initial?: string) => {
      const row = rows[view[pos.row]];
      if (!row || !columns[pos.col]) return;
      setActive(pos);
      setEditing({ pos, value: initial ?? row.cells[pos.col] ?? '' });
    },
    [rows, view, columns],
  );

  const toggleRow = useCallback(
    (displayIndex: number, shiftKey: boolean) => {
      const next = new Set(selectedRows);
      const row = rows[view[displayIndex]];
      if (!row) return;
      if (shiftKey && lastToggled.current !== null) {
        const from = Math.min(lastToggled.current, displayIndex);
        const to = Math.max(lastToggled.current, displayIndex);
        for (let i = from; i <= to; i++) {
          const item = rows[view[i]];
          if (item) next.add(item.id);
        }
      } else if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.add(row.id);
      }
      lastToggled.current = displayIndex;
      props.onSelectRows(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRows, rows, view, props.onSelectRows],
  );

  const onCellClick = useCallback((row: number, col: number) => {
    setActive({ row, col });
    scrollRef.current?.focus({ preventScroll: true });
  }, []);
  const onCellDoubleClick = useCallback((row: number, col: number) => startEdit({ row, col }), [startEdit]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing || event.target !== scrollRef.current) return;
    if (!active) {
      if (['ArrowDown', 'ArrowRight', 'Enter'].includes(event.key) && count > 0 && columns.length > 0) {
        event.preventDefault();
        setActive({ row: first, col: 0 });
      }
      return;
    }
    const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1);
    let next: CellPos | null = null;
    switch (event.key) {
      case 'ArrowDown':
        next = { row: Math.min(count - 1, active.row + 1), col: active.col };
        break;
      case 'ArrowUp':
        next = { row: Math.max(0, active.row - 1), col: active.col };
        break;
      case 'ArrowRight':
        next = { row: active.row, col: Math.min(columns.length - 1, active.col + 1) };
        break;
      case 'ArrowLeft':
        next = { row: active.row, col: Math.max(0, active.col - 1) };
        break;
      case 'PageDown':
        next = { row: Math.min(count - 1, active.row + page), col: active.col };
        break;
      case 'PageUp':
        next = { row: Math.max(0, active.row - page), col: active.col };
        break;
      case 'Home':
        next = { row: event.ctrlKey || event.metaKey ? 0 : active.row, col: 0 };
        break;
      case 'End':
        next = { row: event.ctrlKey || event.metaKey ? count - 1 : active.row, col: columns.length - 1 };
        break;
      case 'Enter':
      case 'F2':
        event.preventDefault();
        startEdit(active);
        return;
      case ' ':
        event.preventDefault();
        toggleRow(active.row, event.shiftKey);
        return;
      case 'Escape':
        setActive(null);
        return;
      default:
        return;
    }
    event.preventDefault();
    setActive(next);
    ensureVisible(next);
  };

  // ---- header interactions -------------------------------------------------------------------

  const startResize = (event: React.PointerEvent, column: Column) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(column.id);
    const move = (e: PointerEvent) => props.onResize(column.id, Math.max(MIN_WIDTH, Math.round(startWidth + e.clientX - startX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const allVisibleSelected = count > 0 && selectedRows.size >= count && view.every((index) => selectedRows.has(rows[index].id));
  const toggleAll = () => {
    if (allVisibleSelected) props.onSelectRows(new Set());
    else props.onSelectRows(new Set(view.map((index) => rows[index].id)));
  };

  const editRow = editing ? rows[view[editing.pos.row]] : null;

  return (
    <div
      ref={scrollRef}
      role="grid"
      tabIndex={0}
      aria-label={t('Extracted data')}
      aria-rowcount={count + 1}
      aria-colcount={columns.length + 1}
      aria-multiselectable="true"
      data-testid="data-grid"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      className="relative h-full overflow-auto rounded-lg border border-zinc-200 bg-white outline-none focus-visible:border-brand-500 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div role="row" aria-rowindex={1} className="sticky top-0 z-10 flex border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" style={{ width: totalWidth, height: HEADER_HEIGHT }}>
        <div className="sticky left-0 z-[2] flex shrink-0 items-center gap-2 border-r border-zinc-200 bg-zinc-100 px-2 dark:border-zinc-800 dark:bg-zinc-900" style={{ width: GUTTER_WIDTH }}>
          <input
            type="checkbox"
            className="size-3.5 accent-brand-600"
            checked={allVisibleSelected}
            aria-label={t('Select all rows')}
            data-testid="select-all-rows"
            onChange={toggleAll}
            ref={(el) => {
              if (el) el.indeterminate = !allVisibleSelected && selectedRows.size > 0;
            }}
          />
          <span className="text-[11px] text-zinc-500">#</span>
        </div>
        {columns.map((column, index) => {
          const stat = stats[index];
          const sorted = sort?.column === column.id ? sort.direction : null;
          const isSelected = selectedColumns.has(column.id);
          return (
            <div
              key={column.id}
              role="columnheader"
              aria-colindex={index + 2}
              aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
              data-testid="column-header"
              draggable
              onDragStart={(event) => {
                dragColumn.current = column.id;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', column.name);
              }}
              onDragOver={(event) => {
                if (!dragColumn.current || dragColumn.current === column.id) return;
                event.preventDefault();
                setDragOver(column.id);
              }}
              onDragLeave={() => setDragOver((current) => (current === column.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const moved = dragColumn.current;
                dragColumn.current = null;
                setDragOver(null);
                if (moved && moved !== column.id) props.onMoveColumn(moved, index);
              }}
              onDragEnd={() => {
                dragColumn.current = null;
                setDragOver(null);
              }}
              className={cx(
                'group relative flex shrink-0 items-center gap-1 border-r border-zinc-200 pr-1 pl-2 dark:border-zinc-800',
                isSelected && 'bg-brand-100 dark:bg-brand-900/50',
                dragOver === column.id && 'shadow-[inset_3px_0_0_var(--color-brand-500)]',
              )}
              style={{ width: widthOf(column.id) }}
            >
              <input
                type="checkbox"
                className="size-3.5 shrink-0 accent-brand-600"
                checked={isSelected}
                aria-label={t('Select column {name}', { name: column.name })}
                onChange={(event) => {
                  const next = new Set(selectedColumns);
                  if (event.target.checked) next.add(column.id);
                  else next.delete(column.id);
                  props.onSelectColumns(next);
                }}
              />
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-zinc-800 dark:text-zinc-100"
                title={t('{name} — click to sort, double-click to rename', { name: column.name })}
                onClick={() => props.onSort(column.id)}
                onDoubleClick={() => props.onRenameColumn(column.id)}
              >
                <span className="truncate">{column.name}</span>
                {sorted === 'asc' ? <ArrowUp className="size-3 shrink-0 text-brand-600" aria-hidden /> : null}
                {sorted === 'desc' ? <ArrowDown className="size-3 shrink-0 text-brand-600" aria-hidden /> : null}
              </button>
              {stat ? (
                <span
                  className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  title={t('{type} · {filled} filled · {empty} empty · {distinct} distinct', {
                    type: t(TYPE_LABEL[stat.type]),
                    filled: formatNumber(stat.nonEmpty),
                    empty: formatNumber(stat.empty),
                    distinct: formatNumber(stat.distinct),
                  })}
                >
                  {TYPE_SHORT[stat.type]}
                </span>
              ) : null}
              <Menu
                label={t('Column actions for {name}', { name: column.name })}
                align="end"
                items={props.columnMenu(column, index)}
                trigger={({ ref, ...triggerProps }) => (
                  <button
                    type="button"
                    ref={ref as (el: HTMLButtonElement | null) => void}
                    aria-label={t('Column actions for {name}', { name: column.name })}
                    data-testid="column-menu"
                    className="flex size-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-white"
                    {...triggerProps}
                  >
                    <MoreVertical className="size-3.5" aria-hidden />
                  </button>
                )}
              />
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('Resize column {name}', { name: column.name })}
                onPointerDown={(event) => startResize(event, column)}
                onDoubleClick={() => props.onResize(column.id, DEFAULT_WIDTH)}
                className="absolute top-0 -right-1 z-[3] h-full w-2 cursor-col-resize hover:bg-brand-400/50"
              />
            </div>
          );
        })}
      </div>

      <div className="relative" style={{ height: bodyHeight, width: totalWidth }}>
        {Array.from({ length: Math.max(0, last - first) }, (_, i) => {
          const displayIndex = first + i;
          const row = rows[view[displayIndex]];
          if (!row) return null;
          return (
            <GridRow
              key={row.id}
              row={row}
              displayIndex={displayIndex}
              top={displayIndex * ROW_HEIGHT + shift}
              columns={columns}
              widthOf={widthOf}
              totalWidth={totalWidth}
              selected={selectedRows.has(row.id)}
              activeCol={active && active.row === displayIndex ? active.col : -1}
              selectedColumns={selectedColumns}
              onToggle={toggleRow}
              onCellClick={onCellClick}
              onCellDoubleClick={onCellDoubleClick}
            />
          );
        })}
        {editing && editRow ? (
          <textarea
            autoFocus
            aria-label={t('Edit cell')}
            data-testid="cell-editor"
            value={editing.value}
            onChange={(event) => setEditing({ pos: editing.pos, value: event.target.value })}
            onBlur={commitEdit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setEditing(null);
                scrollRef.current?.focus({ preventScroll: true });
              } else if (event.key === 'Enter' && !event.altKey && !event.shiftKey) {
                event.preventDefault();
                commitEdit();
                scrollRef.current?.focus({ preventScroll: true });
              } else if (event.key === 'Tab') {
                event.preventDefault();
                const pos = editing.pos;
                commitEdit();
                const col = Math.min(columns.length - 1, Math.max(0, pos.col + (event.shiftKey ? -1 : 1)));
                setActive({ row: pos.row, col });
                scrollRef.current?.focus({ preventScroll: true });
              }
              event.stopPropagation();
            }}
            className="absolute z-[5] resize-none rounded-sm border-2 border-brand-500 bg-white px-1.5 py-1 text-[12.5px] leading-snug text-zinc-900 shadow-lg outline-none dark:bg-zinc-900 dark:text-zinc-100"
            style={{
              top: editing.pos.row * ROW_HEIGHT + shift,
              left: columnLeft[editing.pos.col],
              width: Math.max(widthOf(columns[editing.pos.col].id), 160),
              height: editing.value.includes('\n') || editing.value.length > 60 ? ROW_HEIGHT * 3 : ROW_HEIGHT,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
