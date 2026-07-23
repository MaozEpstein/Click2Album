import type { PhotoSource, SourcePhotoFile } from '../sources/types';
import { extractDateInfo } from './exif';
import { createDerivatives } from './thumbnails';
import { savePhoto, saveProjectState, type PhotoRecord } from './db';
import { computeFlags } from './quality';

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

  for (const { id, name, file } of files) {
    const [dateInfo, derived] = await Promise.all([extractDateInfo(file), createDerivatives(file)]);
    if (!derived) continue; // קובץ שלא ניתן לפענוח — מדלגים

    const record: PhotoRecord = {
      id,
      name,
      takenAt: dateInfo.takenAt,
      hasExif: dateInfo.hasExif,
      width: derived.width,
      height: derived.height,
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

    // מפנה את ה-main thread לרינדור בין תמונות
    if (processed % 5 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  await saveProjectState({ id: 'current', createdAt: Date.now(), scanCompleted: true });
  return processed;
}
