// Main-thread side of the data worker. Small jobs run inline (cheaper than copying the
// data to a worker); large ones go to the worker so the UI never freezes.
import type { ExportOptions, TableData, TransformOp, TransformResult } from '@/types';
import { applyTransform } from '@/data-processing/transforms';
import { buildExport } from '@/export';
import type { WorkerRequest, WorkerResponse } from './data.worker';

const WORKER_CELL_THRESHOLD = 100_000;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (done: number, total: number) => void;
};

let worker: Worker | null = null;
let workerBroken = false;
let seq = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const entry = pending.get(message.id);
      if (!entry) return;
      if (message.kind === 'progress') {
        entry.onProgress?.(message.done, message.total);
        return;
      }
      pending.delete(message.id);
      if (message.kind === 'result') entry.resolve(message.value);
      else {
        const error = new Error(message.message);
        error.name = message.name;
        entry.reject(error);
      }
    };
    worker.onerror = () => {
      // The worker could not start: fall back to the main thread from now on.
      workerBroken = true;
      worker = null;
      for (const entry of pending.values()) entry.reject(new Error('The background worker failed.'));
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

type RequestBody = WorkerRequest extends infer U ? (U extends { id: number } ? Omit<U, 'id'> : never) : never;

function call<T>(message: RequestBody, onProgress?: (done: number, total: number) => void): Promise<T> | null {
  const instance = getWorker();
  if (!instance) return null;
  const id = seq++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
    instance.postMessage({ ...message, id } as WorkerRequest);
  });
}

function cellCount(data: TableData): number {
  return data.rows.length * Math.max(1, data.columns.length);
}

export async function runTransform(data: TableData, op: TransformOp): Promise<TransformResult> {
  if (cellCount(data) >= WORKER_CELL_THRESHOLD) {
    const viaWorker = call<TransformResult>({ kind: 'transform', data, op });
    if (viaWorker) {
      try {
        return await viaWorker;
      } catch (error) {
        if (!workerBroken) throw error;
      }
    }
  }
  return applyTransform(data, op);
}

export interface ExportResult {
  blob: Blob;
  extension: string;
  mime: string;
}

export async function runExport(
  sheets: { name: string; data: TableData }[],
  options: ExportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const cells = sheets.reduce((sum, sheet) => sum + cellCount(sheet.data), 0);
  if (cells >= WORKER_CELL_THRESHOLD) {
    const viaWorker = call<ExportResult>({ kind: 'export', sheets, options }, onProgress);
    if (viaWorker) {
      try {
        return await viaWorker;
      } catch (error) {
        if (!workerBroken) throw error;
      }
    }
  }
  return buildExport(sheets, options, onProgress);
}
