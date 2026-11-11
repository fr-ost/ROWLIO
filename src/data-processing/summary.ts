// Column statistics for the "Column summary" dialog.
import type { ColumnType, TableData } from '@/types/data';
import { columnStats, isBlank, parseNumberStrict } from '@/data-processing/infer';

export interface NumericSummary {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  median: number;
}

export interface ColumnSummary {
  name: string;
  type: ColumnType;
  total: number;
  filled: number;
  empty: number;
  distinct: number;
  /** Present when at least one cell is a plain number. */
  numeric: NumericSummary | null;
  shortest: number;
  longest: number;
  /** Most frequent non-empty values, most frequent first. */
  top: { value: string; count: number }[];
}

export function summarizeColumn(data: TableData, columnIndex: number, topN = 8): ColumnSummary {
  const stats = columnStats(data, columnIndex);
  const counts = new Map<string, number>();
  const numbers: number[] = [];
  let shortest = Infinity;
  let longest = 0;
  for (const row of data.rows) {
    const value = row.cells[columnIndex] ?? '';
    if (isBlank(value)) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
    const length = Array.from(value).length;
    if (length < shortest) shortest = length;
    if (length > longest) longest = length;
    const number = parseNumberStrict(value);
    if (number !== null) numbers.push(number);
  }
  let numeric: NumericSummary | null = null;
  if (numbers.length > 0) {
    numbers.sort((a, b) => a - b);
    const sum = numbers.reduce((total, n) => total + n, 0);
    const mid = numbers.length >> 1;
    numeric = {
      count: numbers.length,
      sum,
      min: numbers[0]!,
      max: numbers[numbers.length - 1]!,
      mean: sum / numbers.length,
      median: numbers.length % 2 ? numbers[mid]! : (numbers[mid - 1]! + numbers[mid]!) / 2,
    };
  }
  const top = Array.from(counts, ([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, topN);
  return {
    name: data.columns[columnIndex]?.name ?? '',
    type: stats.type,
    total: data.rows.length,
    filled: stats.nonEmpty,
    empty: stats.empty,
    distinct: counts.size,
    numeric,
    shortest: shortest === Infinity ? 0 : shortest,
    longest,
    top,
  };
}
