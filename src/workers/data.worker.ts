// Data worker: runs heavy transformations and exports off the UI thread.
import type { ExportOptions, TableData, TransformOp } from '@/types';
import { applyTransform } from '@/data-processing/transforms';
import { buildExport } from '@/export';

export type WorkerRequest =
  | { id: number; kind: 'transform'; data: TableData; op: TransformOp }
  | { id: number; kind: 'export'; sheets: { name: string; data: TableData }[]; options: ExportOptions };

export type WorkerResponse =
  | { id: number; kind: 'result'; value: unknown }
  | { id: number; kind: 'progress'; done: number; total: number }
  | { id: number; kind: 'error'; message: string; name: string };

const scope = self as unknown as { postMessage(message: WorkerResponse): void; onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };

scope.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.kind === 'transform') {
      scope.postMessage({ id: message.id, kind: 'result', value: applyTransform(message.data, message.op) });
    } else {
      const result = await buildExport(message.sheets, message.options, (done, total) =>
        scope.postMessage({ id: message.id, kind: 'progress', done, total }),
      );
      scope.postMessage({ id: message.id, kind: 'result', value: result });
    }
  } catch (error) {
    scope.postMessage({
      id: message.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Error',
    });
  }
};
