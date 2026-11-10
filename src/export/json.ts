// JSON / JSON Lines writers. Values stay strings: the export is faithful to the page, and
// deciding that "007" is a number is the user's call, not ours.
import type { TableData } from '@/types/data';

export const DEFAULT_JSON_CHUNK_ROWS = 2000;

/** Object keys for the columns: the names as shown, with a suffix if two columns ever share one. */
function recordKeys(data: TableData): string[] {
  const taken = new Set<string>();
  return data.columns.map((column) => {
    let key = column.name;
    for (let n = 2; taken.has(key); n++) key = `${column.name} (${n})`;
    taken.add(key);
    return key;
  });
}

/**
 * One object per row, keyed by column name.
 *
 * Note: JavaScript objects always enumerate integer-like keys ("2023") before other keys,
 * so an object cannot preserve the column order for such names. The serialisers below
 * therefore write the JSON text themselves instead of going through these objects.
 */
export function toRecords(data: TableData): Record<string, string>[] {
  const keys = recordKeys(data);
  return data.rows.map((row) =>
    // fromEntries defines own properties, so a column called "__proto__" is kept as data.
    Object.fromEntries(keys.map((key, index) => [key, row.cells[index] ?? ''])),
  );
}

interface ObjectWriter {
  write(cells: string[]): string;
}

/** Serialises a row as a JSON object with the keys in column order, whatever they are called. */
function objectWriter(data: TableData, indent: string): ObjectWriter {
  const keys = recordKeys(data).map((key) => JSON.stringify(key));
  if (keys.length === 0) return { write: () => '{}' };
  if (indent === '') {
    return {
      write: (cells) => {
        let out = '{';
        for (let i = 0; i < keys.length; i++) {
          out += `${i === 0 ? '' : ','}${keys[i]}:${JSON.stringify(cells[i] ?? '')}`;
        }
        return `${out}}`;
      },
    };
  }
  // Pretty objects sit inside the top-level array, hence the two indentation levels.
  const inner = `\n${indent}${indent}`;
  return {
    write: (cells) => {
      let out = '{';
      for (let i = 0; i < keys.length; i++) {
        out += `${i === 0 ? '' : ','}${inner}${keys[i]}: ${JSON.stringify(cells[i] ?? '')}`;
      }
      return `${out}\n${indent}}`;
    },
  };
}

/**
 * A JSON array of objects, yielded in strings of about `chunkRows` rows. The pretty form
 * is byte-for-byte what `JSON.stringify(records, null, 2)` would produce.
 */
export function* jsonChunks(
  data: TableData,
  opts: { pretty: boolean },
  chunkRows: number = DEFAULT_JSON_CHUNK_ROWS,
): Generator<string> {
  const size = Math.max(1, Math.floor(chunkRows));
  const total = data.rows.length;
  if (total === 0) {
    yield '[]';
    return;
  }
  const indent = opts.pretty ? '  ' : '';
  const writer = objectWriter(data, indent);
  const open = opts.pretty ? `[\n${indent}` : '[';
  const between = opts.pretty ? `,\n${indent}` : ',';
  const close = opts.pretty ? '\n]' : ']';

  let buffer = open;
  for (let r = 0; r < total; r++) {
    if (r > 0) buffer += between;
    buffer += writer.write(data.rows[r]!.cells);
    if ((r + 1) % size === 0 && r + 1 < total) {
      yield buffer;
      buffer = '';
    }
  }
  yield buffer + close;
}

export function toJson(data: TableData, opts: { pretty: boolean }): string {
  let text = '';
  for (const chunk of jsonChunks(data, opts)) text += chunk;
  return text;
}

/** JSON Lines: one compact object per row, each terminated by "\n". */
export function* jsonlChunks(data: TableData, chunkRows: number = DEFAULT_JSON_CHUNK_ROWS): Generator<string> {
  const size = Math.max(1, Math.floor(chunkRows));
  const writer = objectWriter(data, '');
  let buffer = '';
  for (let r = 0; r < data.rows.length; r++) {
    buffer += `${writer.write(data.rows[r]!.cells)}\n`;
    if ((r + 1) % size === 0) {
      yield buffer;
      buffer = '';
    }
  }
  if (buffer !== '') yield buffer;
}
