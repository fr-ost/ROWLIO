// Merging the results of many pages / scroll steps into datasets, with duplicate
// handling. Keys are exact (the full row), never hashed: a hash collision would silently
// drop a record.
import type { RawDataset } from '@/types';

export function rowKeyOf(cells: string[]): string {
  return cells.join('\u001f');
}

interface Entry {
  dataset: RawDataset;
  /** key → how many copies of the row have been emitted so far. */
  emitted: Map<string, number>;
}

export interface AddResult {
  added: number;
  duplicates: number;
}

/**
 * Collects rows across steps.
 *
 * mode 'pages'  – every step is a different page: rows are appended; with skipDuplicates
 *                 a row seen on any earlier page (or earlier on this page) is dropped.
 * mode 'scroll' – every step re-reads the same, growing (or virtualised) page: a row is
 *                 only new if this step shows more copies of it than have been emitted,
 *                 so re-reading never duplicates and genuine repeats that are visible
 *                 together are kept. With skipDuplicates every row is emitted once.
 */
export class Accumulator {
  private readonly entries = new Map<string, Entry>();
  private order: string[] = [];
  total = 0;
  duplicates = 0;

  constructor(
    private readonly mode: 'pages' | 'scroll',
    private readonly skipDuplicates: boolean,
    /** Stop adding once this many rows are held (0 = unlimited). */
    private readonly maxRecords = 0,
  ) {}

  add(datasets: RawDataset[]): AddResult {
    let added = 0;
    let duplicates = 0;
    for (const incoming of datasets) {
      let entry = this.entries.get(incoming.key);
      if (!entry) {
        entry = {
          dataset: { ...incoming, columns: incoming.columns.slice(), rows: [], warnings: incoming.warnings.slice() },
          emitted: new Map(),
        };
        this.entries.set(incoming.key, entry);
        this.order.push(incoming.key);
      } else {
        for (const warning of incoming.warnings) {
          if (!entry.dataset.warnings.includes(warning)) entry.dataset.warnings.push(warning);
        }
      }
      const target = entry.dataset;
      // Align columns by name; a column first seen on a later page is appended.
      const mapping = incoming.columns.map((name) => {
        let index = target.columns.indexOf(name);
        if (index === -1) {
          index = target.columns.length;
          target.columns.push(name);
          for (const row of target.rows) row.push('');
        }
        return index;
      });
      const stepCounts = new Map<string, number>();
      for (const source of incoming.rows) {
        if (this.maxRecords > 0 && this.total >= this.maxRecords) break;
        const row = new Array<string>(target.columns.length).fill('');
        for (let i = 0; i < source.length; i++) {
          const index = mapping[i];
          if (index !== undefined) row[index] = source[i];
        }
        const key = rowKeyOf(row);
        const emitted = entry.emitted.get(key) ?? 0;
        if (this.mode === 'scroll') {
          const seenThisStep = (stepCounts.get(key) ?? 0) + 1;
          stepCounts.set(key, seenThisStep);
          const allowed = this.skipDuplicates ? 1 : seenThisStep;
          if (emitted >= allowed) {
            // Re-read of a known row is not a "duplicate" worth reporting unless the
            // user asked to skip real repeats.
            if (this.skipDuplicates && seenThisStep > 1) duplicates++;
            continue;
          }
        } else if (this.skipDuplicates && emitted > 0) {
          duplicates++;
          continue;
        }
        entry.emitted.set(key, emitted + 1);
        target.rows.push(row);
        this.total++;
        added++;
      }
    }
    this.duplicates += duplicates;
    return { added, duplicates };
  }

  get full(): boolean {
    return this.maxRecords > 0 && this.total >= this.maxRecords;
  }

  datasets(): RawDataset[] {
    return this.order.map((key) => this.entries.get(key)!.dataset);
  }
}
