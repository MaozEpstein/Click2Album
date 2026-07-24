import type { PhotoSource, SourcePhotoFile } from '../sources/types';
import { extractDateInfo } from './exif';
import { createDerivatives, type DerivativesResult } from './thumbnails';
import { savePhoto, saveProjectState, type PhotoRecord } from './db';
import { computeFlags } from './quality';
import type { ScanWorkerRequest, ScanWorkerResponse } from './scanWorker';

export interface ScanProgress {
  processed: number;
  /** סה"כ תמונות לעיבוד; 0 = עדיין סופרים את הקבצים */
  total: number;
  /** הערכת זמן שנותר בשניות; null = עוד אין מספיק מדידות */
  etaSeconds: number | null;
  /** thumbnails אחרונים שנוצרו — להצגה חיה במסך הסריקה */
  latestThumbnails: Blob[];
}

const LATEST_THUMBS_SHOWN = 8;

/**
 * בריכת Workers לסריקה: הפענוח והדחיסה מתפזרים על הליבות.
 * ליבה אחת נשארת פנויה לממשק; תקרה של 6 (מעבר לזה — זיכרון ותורים משותפים).
 */
function workerCount(): number {
  return Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
}

interface WorkerSlot {
  worker: Worker;
  resolve: ((result: DerivativesResult | null) => void) | null;
}

function createPool(): WorkerSlot[] {
  try {
    return Array.from({ length: workerCount() }, () => {
      const worker = new Worker(new URL('./scanWorker.ts', import.meta.url), {
        type: 'module',
      });
      const slot: WorkerSlot = { worker, resolve: null };
      worker.onmessage = (e: MessageEvent<ScanWorkerResponse>) => {
        const resolve = slot.resolve;
        slot.resolve = null;
        resolve?.(e.data.result);
      };
      worker.onerror = () => {
        const resolve = slot.resolve;
        slot.resolve = null;
        resolve?.(null);
      };
      return slot;
    });
  } catch {
    return []; // דפדפן בלי Workers — נסיגה לעיבוד בחוט הראשי
  }
}

function runOnWorker(
  slot: WorkerSlot,
  taskId: number,
  file: File,
  sizeHint: { width: number; height: number } | null,
): Promise<DerivativesResult | null> {
  return new Promise((resolve) => {
    slot.resolve = resolve;
    slot.worker.postMessage({ taskId, file, sizeHint } satisfies ScanWorkerRequest);
  });
}

/**
 * סורק מקור תמונות: לכל תמונה מחלץ תאריך, יוצר thumbnail ושומר ל-IndexedDB.
 * מדווח התקדמות תוך כדי, ומוודא שה-UI לא נחסם.
 */
export async function scanSource(
  source: PhotoSource,
  onProgress: (progress: ScanProgress) => void,
): Promise<number> {
  let processed = 0;
  const latest: Blob[] = [];

  // שלב א': ספירת הקבצים — מאפשרת "X מתוך Y" והערכת זמן
  const files: SourcePhotoFile[] = [];
  for await (const entry of source.listPhotos()) {
    files.push(entry);
    if (files.length % 50 === 0) {
      onProgress({ processed: 0, total: 0, etaSeconds: null, latestThumbnails: [] });
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const total = files.length;
  const startedAt = performance.now();

  const pool = createPool();
  let nextIndex = 0;

  /** מעבד תמונה אחת (העבודה הכבדה ב-worker אם קיים) ושומר */
  const processOne = async (
    entry: SourcePhotoFile,
    slot: WorkerSlot | null,
  ): Promise<void> => {
    const { id, name, file } = entry;
    // EXIF קודם — ממדי המקור מאפשרים פענוח מוקטן מהיר ב-createDerivatives
    const dateInfo = await extractDateInfo(file);
    const sizeHint =
      dateInfo.pixelWidth && dateInfo.pixelHeight
        ? { width: dateInfo.pixelWidth, height: dateInfo.pixelHeight }
        : null;
    const derived = slot
      ? await runOnWorker(slot, nextIndex, file, sizeHint)
      : await createDerivatives(file, sizeHint);
    if (!derived) return; // קובץ שלא ניתן לפענוח — מדלגים

    const record: PhotoRecord = {
      id,
      name,
      takenAt: dateInfo.takenAt,
      hasExif: dateInfo.hasExif,
      // ממדי המקור המלאים מ-EXIF כשקיימים (עתידית: שומר איכות הדפסה); אחרת מהפענוח
      width: dateInfo.pixelWidth ?? derived.width,
      height: dateInfo.pixelHeight ?? derived.height,
      thumbnail: derived.thumbnail,
      preview: derived.preview,
      phash: derived.phash,
      phashCenter: derived.phashCenter,
      decision: null,
      sharpness: derived.quality.sharpness,
      brightness: derived.quality.brightness,
      flags: computeFlags({
        metrics: derived.quality,
        hasExif: dateInfo.hasExif,
        fileName: name,
        fileType: file.type,
        width: derived.width,
        height: derived.height,
      }),
      filtered: false,
      faceCount: null,
      colorSig: derived.quality.colorSig,
      faceSigs: [],
      embedding: null,
      bestShotScore: null,
      hasClosedEyes: false,
      subjectSig: null,
      personCount: null,
      personBoxes: [],
    };
    await savePhoto(record);

    processed += 1;
    latest.unshift(derived.thumbnail);
    if (latest.length > LATEST_THUMBS_SHOWN) latest.pop();
    // הערכת זמן: קצב ממוצע עד כה × מה שנותר (מתייצבת אחרי ~10 תמונות)
    const etaSeconds =
      processed >= 10
        ? Math.round(((performance.now() - startedAt) / processed / 1000) * (total - processed))
        : null;
    onProgress({ processed, total, etaSeconds, latestThumbnails: [...latest] });
  };

  if (pool.length > 0) {
    // כל worker מריץ "צרכן" שמושך את המשימה הבאה מהתור עד שנגמר
    await Promise.all(
      pool.map(async (slot) => {
        while (nextIndex < files.length) {
          const entry = files[nextIndex];
          nextIndex += 1;
          await processOne(entry, slot);
        }
      }),
    );
    for (const slot of pool) slot.worker.terminate();
  } else {
    // נסיגה: עיבוד סדרתי בחוט הראשי
    for (const entry of files) {
      await processOne(entry, null);
      if (processed % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  await saveProjectState({ id: 'current', createdAt: Date.now(), scanCompleted: true });
  return processed;
}
