import { setBestShot, type PhotoRecord } from './db';

/**
 * ציון "המוצלחת ביותר" — לפי המפרט המאושר:
 * 40% אסתטיקה (NIMA, גוגל 2018) + 40% מצב פנים (MediaPipe blendshapes) + 20% חדות.
 * בלי פנים: 65% אסתטיקה + 35% חדות. הכל במכשיר.
 */

// ===== פרמטרי המפרט — כיול במקום אחד =====
const NIMA_FLOOR = 3.5; // נרמול: (score-3.5)/3.5
const NIMA_RANGE = 3.5;
const SHARPNESS_LOG_CAP = Math.log(500);
const SMILE_THRESHOLD = 0.3;
/** מצמוץ נמדד בממוצע שתי העיניים (קריצה/צל על עין אחת לא פוסלים) */
const BLINK_THRESHOLD = 0.6;
/** "מצמוץ החיוך": חיוך גדול מצמצם עיניים טבעית — הסף עולה כדי לא לפסול */
const STRONG_SMILE = 0.5;
const BLINK_THRESHOLD_SMILING = 0.8;
const FACE_BASE = 0.7;
const SMILE_BONUS = 0.2;
const BLINK_SCORE = 0.15;
/** פנים קיימות אך קטנות משיפוט — רכיב פנים ניטרלי (לא עונש על צילום רחב) */
const NEUTRAL_FACE_SCORE = 0.7;
/** פנים קטנות מזה (יחסית לגובה התמונה) לא נשפטות */
const MIN_FACE_RATIO = 0.038; // ≈48px ב-1280
/** חוק אמינות: המנצחת מחליפה את החדה-ביותר רק בהפרש הזה ומעלה */
const MIN_SCORE_MARGIN = 8;

export interface ScoreProgress {
  done: number;
  total: number;
}

let running = false;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

let nimaSessionPromise: Promise<{
  ort: typeof import('onnxruntime-web');
  session: import('onnxruntime-web').InferenceSession;
}> | null = null;

function getNimaSession() {
  nimaSessionPromise ??= (async () => {
    const ort = await import('onnxruntime-web/wasm');
    const session = await ort.InferenceSession.create('/models/nima_aesthetic.onnx', {
      executionProviders: ['wasm'],
    });
    return { ort: ort as typeof import('onnxruntime-web'), session };
  })();
  return nimaSessionPromise;
}

/** ציון NIMA (1-10): ממוצע התפלגות עשרת הציונים */
async function nimaScore(bitmap: ImageBitmap): Promise<number> {
  const { ort, session } = await getNimaSession();
  const SIZE = 224;
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d')!;
  // letterbox: שימור יחס הממדים עם ריפוד אפור — פנורמות לא נמעכות לריבוע
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  ctx.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

  // MobileNet preprocessing: NHWC, נרמול (x/127.5 - 1)
  const input = new Float32Array(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    input[i * 3] = data[i * 4] / 127.5 - 1;
    input[i * 3 + 1] = data[i * 4 + 1] / 127.5 - 1;
    input[i * 3 + 2] = data[i * 4 + 2] / 127.5 - 1;
  }
  const tensor = new ort.Tensor('float32', input, [1, SIZE, SIZE, 3]);
  const results = await session.run({ [session.inputNames[0]]: tensor });
  const dist = results[session.outputNames[0]].data as Float32Array;
  // התפלגות על ציונים 1..10 → ממוצע
  let mean = 0;
  let sum = 0;
  for (let i = 0; i < dist.length; i++) sum += dist[i];
  for (let i = 0; i < dist.length; i++) mean += ((dist[i] / (sum || 1)) * (i + 1));
  return mean;
}

let landmarkerPromise: Promise<import('@mediapipe/tasks-vision').FaceLandmarker> | null = null;

function getLandmarker() {
  landmarkerPromise ??= (async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe-wasm');
    return vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/face_landmarker.task' },
      runningMode: 'IMAGE',
      numFaces: 6,
      outputFaceBlendshapes: true,
    });
  })();
  return landmarkerPromise;
}

interface FaceExpressionResult {
  /** ציון הבעות 0-1 לפי המפרט, או null אם אין פנים נשפטות */
  score: number | null;
  hasClosedEyes: boolean;
}

function blendValue(
  shapes: Array<{ categoryName: string; score: number }>,
  name: string,
): number {
  return shapes.find((s) => s.categoryName === name)?.score ?? 0;
}

/** ציון מצב הפנים: בסיס 0.7, חיוך +0.3, מצמוץ → 0.15; שקלול (2·min+mean)/3 */
async function faceExpressionScore(bitmap: ImageBitmap): Promise<FaceExpressionResult> {
  const landmarker = await getLandmarker();
  const result = landmarker.detect(bitmap);

  const faceScores: number[] = [];
  let hasClosedEyes = false;
  let smallFacesExist = false;

  for (let f = 0; f < result.faceBlendshapes.length; f++) {
    const shapes = result.faceBlendshapes[f].categories;
    // גובה הפנים מתוך ה-landmarks (יחסי לתמונה)
    const lm = result.faceLandmarks[f];
    let minY = 1;
    let maxY = 0;
    for (const p of lm) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (maxY - minY < MIN_FACE_RATIO) {
      smallFacesExist = true; // פנים קטנות — לא נשפטות, אבל נספרות לניטרליות
      continue;
    }

    // מצמוץ: ממוצע שתי העיניים — שתיהן צריכות להיראות עצומות
    const blink =
      (blendValue(shapes, 'eyeBlinkLeft') + blendValue(shapes, 'eyeBlinkRight')) / 2;
    const smile = Math.max(
      blendValue(shapes, 'mouthSmileLeft'),
      blendValue(shapes, 'mouthSmileRight'),
    );
    // "מצמוץ החיוך": חיוך גדול מצמצם עיניים — סף פסילה גבוה יותר
    const blinkThreshold = smile > STRONG_SMILE ? BLINK_THRESHOLD_SMILING : BLINK_THRESHOLD;

    if (blink > blinkThreshold) {
      faceScores.push(BLINK_SCORE);
      hasClosedEyes = true;
    } else {
      faceScores.push(clamp01(FACE_BASE + (smile > SMILE_THRESHOLD ? SMILE_BONUS : 0)));
    }
  }

  // רק פנים קטנות בתמונה (אדם קטן בנוף גדול) — רכיב פנים ניטרלי, לא עונש
  if (faceScores.length === 0 && smallFacesExist) {
    return { score: NEUTRAL_FACE_SCORE, hasClosedEyes: false };
  }
  if (faceScores.length === 0) return { score: null, hasClosedEyes: false };
  const min = Math.min(...faceScores);
  const mean = faceScores.reduce((a, v) => a + v, 0) / faceScores.length;
  // תמונה קבוצתית נשפטת לפי החלש ביותר — משקל כפול למינימום
  return { score: (2 * min + mean) / 3, hasClosedEyes };
}

/**
 * מדרג את כל התמונות שטרם דורגו. בטוח לקריאה חוזרת; שומר DB + in-place.
 * כשל בתמונה בודדת לא עוצר; כשל טעינת מודל נרשם והשרשרת ממשיכה (נסיגה לחדות).
 */
export async function scorePending(
  photos: PhotoRecord[],
  onProgress: (progress: ScoreProgress) => void,
): Promise<void> {
  if (running) return;
  const pending = photos.filter((p) => p.bestShotScore === null && !p.filtered);
  if (pending.length === 0) return;
  running = true;

  try {
    let done = 0;
    for (const photo of pending) {
      try {
        const thumbBitmap = await createImageBitmap(photo.thumbnail);
        const aestheticRaw = await nimaScore(thumbBitmap);
        thumbBitmap.close();
        const aesthetic = clamp01((aestheticRaw - NIMA_FLOOR) / NIMA_RANGE);

        const previewBitmap = await createImageBitmap(photo.preview);
        const faces = await faceExpressionScore(previewBitmap);
        previewBitmap.close();

        const sharp = clamp01(Math.log(Math.max(1, photo.sharpness)) / SHARPNESS_LOG_CAP);

        const score =
          faces.score !== null
            ? 40 * aesthetic + 40 * faces.score + 20 * sharp
            : 65 * aesthetic + 35 * sharp;

        photo.bestShotScore = Math.round(score * 10) / 10;
        photo.hasClosedEyes = faces.hasClosedEyes;
        await setBestShot(photo.id, photo.bestShotScore, faces.hasClosedEyes);
      } catch (err) {
        console.warn('[bestShot] scoring failed for', photo.name, err);
      }
      done += 1;
      onProgress({ done, total: pending.length });
      if (done % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    running = false;
  }
}

/**
 * בחירת המוצלחת מתוך ערימה, לפי חוקי האמינות:
 * וטו מצמוץ; החלפה של החדה-ביותר רק בהפרש ≥ 8 נק'; נסיגה לחדות כשאין ציונים.
 */
export function pickBest(photos: PhotoRecord[]): PhotoRecord {
  const bySharpness = photos.filter((p) => p.sharpness > 0);
  const sharpest =
    bySharpness.length > 0
      ? bySharpness.reduce((b, p) => (p.sharpness > b.sharpness ? p : b))
      : photos[Math.floor((photos.length - 1) / 2)];

  const scored = photos.filter((p) => p.bestShotScore !== null);
  if (scored.length === 0) return sharpest;

  // וטו מצמוץ: אם יש מועמדות בלי עיניים עצומות — הממצמצות מחוץ למשחק
  const open = scored.filter((p) => !p.hasClosedEyes);
  const pool = open.length > 0 ? open : scored;
  const best = pool.reduce((b, p) => (p.bestShotScore! > b.bestShotScore! ? p : b));

  // סף אמינות מול החדה-ביותר (אם גם לה יש ציון וללא וטו נגדה)
  if (
    sharpest.bestShotScore !== null &&
    !(!best.hasClosedEyes && sharpest.hasClosedEyes) &&
    best.bestShotScore! - sharpest.bestShotScore! < MIN_SCORE_MARGIN
  ) {
    return sharpest;
  }
  return best;
}
