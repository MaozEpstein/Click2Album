import { setFaceData, type PhotoRecord } from './db';
import { embedAlignedFace } from './faceEngine';

/**
 * ניתוח פנים היברידי:
 * face-api מאתר פנים ונקודות ציון; ArcFace (512-d) מחשב חתימת זהות מיושרת.
 * הכל במכשיר. faceCount משמש לקטגוריות; faceSigs — לוטו זהות בקיבוץ.
 */

export type PhotoCategory = 'background' | 'person' | 'group';

export function categoryOf(faceCount: number | null): PhotoCategory | null {
  if (faceCount === null) return null;
  if (faceCount === 0) return 'background';
  if (faceCount === 1) return 'person';
  return 'group';
}

export interface FacesProgress {
  done: number;
  total: number;
}

/** פנים קטנות מזה (בפיקסלים של ה-preview) לא מקבלות חתימת זהות — לא אמינות */
const MIN_FACE_HEIGHT_PX = 48;

let running = false;

/** סטטוס גלוי לאבחון — מוצג במסך בזמן פיתוח */
export interface FaceEngineStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  processed: number;
  withSigs: number;
  lastError: string | null;
}

export const faceStatus: FaceEngineStatus = {
  state: 'idle',
  processed: 0,
  withSigs: 0,
  lastError: null,
};

/** קוסינוס בין חתימות מנורמלות */
export function faceCosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** הדמיון המקסימלי בין שתי קבוצות פנים — "האם יש אדם משותף" (קוסינוס, גבוה=דומה) */
export function bestFaceSimilarity(a: number[][], b: number[][]): number {
  let best = -1;
  for (const fa of a) {
    for (const fb of b) {
      best = Math.max(best, faceCosine(fa, fb));
    }
  }
  return best;
}

/** ממוצע 5 נקודות זהות מתוך 68 ה-landmarks של face-api */
function fivePointsFrom68(
  positions: Array<{ x: number; y: number }>,
): Array<[number, number]> {
  const mean = (indices: number[]): [number, number] => {
    let x = 0;
    let y = 0;
    for (const i of indices) {
      x += positions[i].x;
      y += positions[i].y;
    }
    return [x / indices.length, y / indices.length];
  };
  return [
    mean([36, 37, 38, 39, 40, 41]), // עין שמאל
    mean([42, 43, 44, 45, 46, 47]), // עין ימין
    mean([30]), // קצה האף
    mean([48]), // זווית פה שמאל
    mean([54]), // זווית פה ימין
  ];
}

/**
 * מנתח את כל התמונות שטרם נותחו (faceCount === null): ספירה + חתימות זהות.
 * בטוח לקריאה חוזרת; מעדכן DB ואובייקטים in-place.
 */
export async function facesPending(
  photos: PhotoRecord[],
  onProgress: (progress: FacesProgress) => void,
): Promise<void> {
  if (running) return;
  const pending = photos.filter((p) => p.faceCount === null && !p.filtered);
  if (pending.length === 0) return;
  running = true;
  faceStatus.state = 'running';
  faceStatus.lastError = null;

  try {
    const faceapi = await import('@vladmandic/face-api');
    await faceapi.nets.tinyFaceDetector.loadFromUri('/face-models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('/face-models');
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 640,
      scoreThreshold: 0.55, // מסנן זיהויי-פנים מדומים (שיחים, אוכל, טקסטורות)
    });

    let done = 0;
    for (const photo of pending) {
      try {
        // preview (1280px) — פנים קטנות/רחוקות נתפסות טוב יותר
        const bitmap = await createImageBitmap(photo.preview);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        bitmap.close();

        const detections = await faceapi
          .detectAllFaces(canvas, options)
          .withFaceLandmarks();

        const faceSigs: number[][] = [];
        for (const d of detections) {
          if (d.detection.box.height < MIN_FACE_HEIGHT_PX) continue;
          try {
            const points = fivePointsFrom68(d.landmarks.positions);
            faceSigs.push(await embedAlignedFace(canvas, { points }));
          } catch (err) {
            faceStatus.lastError = `embed: ${String(err).slice(0, 400)}`;
            console.warn('[faces] embedding failed for one face', err);
          }
        }

        photo.faceCount = detections.length;
        photo.faceSigs = faceSigs;
        await setFaceData(photo.id, detections.length, faceSigs);
        faceStatus.processed += 1;
        if (faceSigs.length > 0) faceStatus.withSigs += 1;
      } catch (err) {
        faceStatus.lastError = `photo: ${String(err).slice(0, 120)}`;
        console.warn('[faces] analysis failed for', photo.name, err);
      }
      done += 1;
      onProgress({ done, total: pending.length });
      if (done % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    faceStatus.state = 'done';
  } catch (err) {
    faceStatus.state = 'error';
    faceStatus.lastError = `load: ${String(err).slice(0, 160)}`;
    console.error('[faces] engine failed to load', err);
    throw err;
  } finally {
    running = false;
  }
}
