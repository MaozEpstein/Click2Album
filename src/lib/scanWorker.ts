import { createDerivatives } from './thumbnails';

/**
 * Worker של הסריקה: מקבל קובץ, מחזיר את כל הנגזרות.
 * הפענוח והדחיסה — החלק הכבד — רצים כאן, במקביל על כמה ליבות.
 */

export interface ScanWorkerRequest {
  taskId: number;
  file: File;
  sizeHint: { width: number; height: number } | null;
}

export interface ScanWorkerResponse {
  taskId: number;
  result: Awaited<ReturnType<typeof createDerivatives>>;
}

self.onmessage = async (e: MessageEvent<ScanWorkerRequest>) => {
  const { taskId, file, sizeHint } = e.data;
  try {
    const result = await createDerivatives(file, sizeHint);
    (self as unknown as Worker).postMessage({ taskId, result } satisfies ScanWorkerResponse);
  } catch {
    (self as unknown as Worker).postMessage({ taskId, result: null } satisfies ScanWorkerResponse);
  }
};
