import { setPersonData, type PhotoRecord } from './db';

/**
 * גלאי אנשים (COCO-SSD) — עונה "האם יש בן אדם בתמונה", כולל גב, פרופיל ורחוק —
 * המקרים שגלאי הפנים עיוור להם. הבסיס לקטגוריות נוף/אדם/קבוצה אמינות.
 * התיבות נשמרות — מתנה לחיתוך חכם עתידי.
 */

export interface PersonBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ספירת האנשים האמינה: הדמויות אם נותחו, אחרת הפנים */
export function effectivePeople(photo: PhotoRecord): number | null {
  return photo.personCount ?? photo.faceCount;
}

export interface PersonsProgress {
  done: number;
  total: number;
}

/** דמות נספרת רק בביטחון סביר ושטח מינימלי — מסנן רעש.
 * הסף נמוך בכוונה: "אדם קטן בנוף גדול" הוא בדיוק מה שרוצים לתפוס. */
const MIN_SCORE = 0.5;
const MIN_AREA_FRACTION = 0.008;

let running = false;

export const personStatus = {
  state: 'idle' as 'idle' | 'running' | 'done' | 'error',
  detected: 0,
  lastError: null as string | null,
};

let modelPromise: Promise<import('@tensorflow-models/coco-ssd').ObjectDetection> | null = null;

function getModel() {
  modelPromise ??= (async () => {
    const tf = await import('@tensorflow/tfjs');
    const cocoSsd = await import('@tensorflow-models/coco-ssd');
    await tf.ready();
    return cocoSsd.load({ base: 'lite_mobilenet_v2' });
  })();
  return modelPromise;
}

/** מנתח את כל התמונות שטרם נותחו (personCount === null) */
export async function personsPending(
  photos: PhotoRecord[],
  onProgress: (progress: PersonsProgress) => void,
): Promise<void> {
  if (running) return;
  const pending = photos.filter((p) => p.personCount === null && !p.filtered);
  if (pending.length === 0) return;
  running = true;
  personStatus.state = 'running';

  try {
    const model = await getModel();
    let done = 0;
    for (const photo of pending) {
      try {
        // preview (1280px) — דמויות רחוקות/קטנות נתפסות; בממוזערת הן נעלמות
        const bitmap = await createImageBitmap(photo.preview);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        const imageArea = bitmap.width * bitmap.height;
        bitmap.close();

        const detections = await model.detect(canvas, 20, MIN_SCORE);
        const boxes: PersonBox[] = detections
          .filter(
            (d) =>
              d.class === 'person' &&
              (d.bbox[2] * d.bbox[3]) / imageArea >= MIN_AREA_FRACTION,
          )
          .map((d) => ({
            x: d.bbox[0] / canvas.width,
            y: d.bbox[1] / canvas.height,
            w: d.bbox[2] / canvas.width,
            h: d.bbox[3] / canvas.height,
          }));

        photo.personCount = boxes.length;
        photo.personBoxes = boxes;
        await setPersonData(photo.id, boxes.length, boxes);
        if (boxes.length > 0) personStatus.detected += 1;
      } catch (err) {
        personStatus.lastError = String(err).slice(0, 300);
        console.warn('[persons] detection failed for', photo.name, err);
      }
      done += 1;
      onProgress({ done, total: pending.length });
      if (done % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    personStatus.state = 'done';
  } catch (err) {
    personStatus.state = 'error';
    personStatus.lastError = String(err).slice(0, 300);
    throw err;
  } finally {
    running = false;
  }
}
