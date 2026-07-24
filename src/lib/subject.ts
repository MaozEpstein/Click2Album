import { setSubjectSig, type PhotoRecord } from './db';
import { embedImageData } from './embed';
import { assetUrl } from './assetUrl';

/**
 * חתימת הנושא הבולט — לנופים בלבד (faceCount === 0):
 * U2Netp מאתר את האובייקט המרכזי (מסכת בולטות) → שער ביטחון →
 * חיתוך הנושא מה-preview → חתימה סמנטית (MobileNet הקיים).
 * בקיבוץ: משמש כמחבר בלבד (שלב א') — לא וטו.
 */

// ===== ספי שער הביטחון — מסכה מפוקפקת עדיפה על חתימה מזהמת =====
const MASK_THRESHOLD = 0.5;
const MIN_AREA_FRACTION = 0.05;
const MAX_AREA_FRACTION = 0.65;
/** ריכוז: שטח המסכה חלקי שטח ה-bbox — נמוך = מסכה מפוזרת, לא נושא מובהק */
const MIN_CONCENTRATION = 0.35;
/** שוליים סביב ה-bbox בחיתוך */
const CROP_MARGIN = 0.15;

const SALIENCY_SIZE = 320;

export interface SubjectProgress {
  done: number;
  total: number;
}

let running = false;

let saliencyPromise: Promise<{
  ort: typeof import('onnxruntime-web');
  session: import('onnxruntime-web').InferenceSession;
}> | null = null;

function getSaliencySession() {
  saliencyPromise ??= (async () => {
    const ort = await import('onnxruntime-web/wasm');
    const session = await ort.InferenceSession.create(assetUrl('models/u2netp.onnx'), {
      executionProviders: ['wasm'],
    });
    return { ort: ort as typeof import('onnxruntime-web'), session };
  })();
  return saliencyPromise;
}

interface SubjectBox {
  /** יחסי (0-1) */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** מריץ saliency ומחזיר bbox של הנושא — או null כשאין נושא מובהק */
async function detectSubject(bitmap: ImageBitmap): Promise<SubjectBox | null> {
  const { ort, session } = await getSaliencySession();
  const canvas = new OffscreenCanvas(SALIENCY_SIZE, SALIENCY_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, SALIENCY_SIZE, SALIENCY_SIZE);
  const { data } = ctx.getImageData(0, 0, SALIENCY_SIZE, SALIENCY_SIZE);

  // נרמול ImageNet (כמו באימון U2Net)
  const plane = SALIENCY_SIZE * SALIENCY_SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = (data[i * 4] / 255 - 0.485) / 0.229;
    input[plane + i] = (data[i * 4 + 1] / 255 - 0.456) / 0.224;
    input[2 * plane + i] = (data[i * 4 + 2] / 255 - 0.406) / 0.225;
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, SALIENCY_SIZE, SALIENCY_SIZE]);
  const results = await session.run({ [session.inputNames[0]]: tensor });
  const mask = results[session.outputNames[0]].data as Float32Array;

  // נרמול min-max של המסכה
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < plane; i++) {
    if (mask[i] < min) min = mask[i];
    if (mask[i] > max) max = mask[i];
  }
  const range = max - min || 1;

  // bbox + שטח מעל הסף
  let minX = SALIENCY_SIZE;
  let minY = SALIENCY_SIZE;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  for (let y = 0; y < SALIENCY_SIZE; y++) {
    for (let x = 0; x < SALIENCY_SIZE; x++) {
      const v = (mask[y * SALIENCY_SIZE + x] - min) / range;
      if (v > MASK_THRESHOLD) {
        area += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const areaFraction = area / plane;
  const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
  const concentration = area / bboxArea;

  // שער הביטחון — מסכה ריקה/ענקית/מפוזרת = אין נושא מובהק
  if (
    areaFraction < MIN_AREA_FRACTION ||
    areaFraction > MAX_AREA_FRACTION ||
    concentration < MIN_CONCENTRATION
  ) {
    return null;
  }

  return {
    x: minX / SALIENCY_SIZE,
    y: minY / SALIENCY_SIZE,
    w: (maxX - minX + 1) / SALIENCY_SIZE,
    h: (maxY - minY + 1) / SALIENCY_SIZE,
  };
}

/**
 * מחשב חתימת נושא לכל תמונות הנוף שטרם נבדקו.
 * subjectSig: [] = נבדק ואין נושא מובהק; מערך מלא = חתימה.
 */
export async function subjectPending(
  photos: PhotoRecord[],
  onProgress: (progress: SubjectProgress) => void,
): Promise<void> {
  if (running) return;
  // נוף אמיתי = אפס דמויות (הגלאי החדש); נסיגה לפנים כשהדמויות טרם נותחו
  const pending = photos.filter(
    (p) => p.subjectSig === null && (p.personCount ?? p.faceCount) === 0 && !p.filtered,
  );
  if (pending.length === 0) return;
  running = true;

  try {
    let done = 0;
    for (const photo of pending) {
      try {
        const thumbBitmap = await createImageBitmap(photo.thumbnail);
        const box = await detectSubject(thumbBitmap);
        thumbBitmap.close();

        let sig: number[] = [];
        if (box) {
          // חיתוך הנושא מה-preview עם שוליים
          const previewBitmap = await createImageBitmap(photo.preview);
          const mx = box.w * CROP_MARGIN;
          const my = box.h * CROP_MARGIN;
          const sx = Math.max(0, (box.x - mx) * previewBitmap.width);
          const sy = Math.max(0, (box.y - my) * previewBitmap.height);
          const sw = Math.min(previewBitmap.width - sx, (box.w + 2 * mx) * previewBitmap.width);
          const sh = Math.min(previewBitmap.height - sy, (box.h + 2 * my) * previewBitmap.height);

          const canvas = new OffscreenCanvas(Math.round(sw), Math.round(sh));
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(previewBitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          previewBitmap.close();
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          sig = await embedImageData(imageData);
        }

        photo.subjectSig = sig;
        await setSubjectSig(photo.id, sig);
      } catch (err) {
        console.warn('[subject] failed for', photo.name, err);
      }
      done += 1;
      onProgress({ done, total: pending.length });
      if (done % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    running = false;
  }
}
