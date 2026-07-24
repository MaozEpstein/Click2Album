/**
 * מנוע חתימות זהות — ArcFace (InsightFace w600k_mbf, 512-d) דרך onnxruntime-web.
 * רץ ב-WASM במכשיר; המודל וקבצי הריצה מוגשים מהאתר עצמו (public/).
 *
 * הצנרת לכל פנים: 5 נקודות ציון → יישור Umeyama לתבנית הקנונית של ArcFace
 * (112×112) → הרצת המודל → וקטור מנורמל L2. היישור קריטי לדיוק.
 */

import type * as OrtTypes from 'onnxruntime-web';
import { assetUrl } from './assetUrl';
// קובצי הריצה של ONNX — עותקים מקומיים שנארזים על ידי Vite (עובד זהה בפיתוח ובפרסום)
import ortWasmUrl from '../assets/ort/ort-wasm-simd-threaded.wasm?url';
import ortMjsUrl from '../assets/ort/ort-wasm-simd-threaded.mjs?url';

/** תבנית 5 הנקודות הקנונית של ArcFace ב-112×112 (עין-שמאל, עין-ימין, אף, פה-שמאל, פה-ימין) */
const ARCFACE_TEMPLATE: Array<[number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

const INPUT_SIZE = 112;

let sessionPromise: Promise<{
  ort: typeof OrtTypes;
  session: OrtTypes.InferenceSession;
}> | null = null;

function getSession() {
  sessionPromise ??= (async () => {
    // גרסת ה-WASM הטהורה — בלי רכיבי webgpu/jsep שמסבכים את הטעינה
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(assetUrl('models/w600k_mbf.onnx'), {
      executionProviders: ['wasm'],
    });
    return { ort, session };
  })();
  return sessionPromise;
}

export interface FacePoints {
  /** 5 נקודות: עין-שמאל, עין-ימין, אף, זווית-פה-שמאל, זווית-פה-ימין (בקואורדינטות התמונה) */
  points: Array<[number, number]>;
}

/**
 * טרנספורמציית דמיון (Umeyama, ללא שיקוף): מוצאת scale+rotation+translation
 * שממפים את נקודות המקור לתבנית. מחזירה [a, b, tx, ty] כך ש:
 * x' = a*x - b*y + tx ; y' = b*x + a*y + ty
 */
function similarityTransform(
  src: Array<[number, number]>,
  dst: Array<[number, number]>,
): [number, number, number, number] {
  const n = src.length;
  let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
  for (let i = 0; i < n; i++) {
    srcMeanX += src[i][0]; srcMeanY += src[i][1];
    dstMeanX += dst[i][0]; dstMeanY += dst[i][1];
  }
  srcMeanX /= n; srcMeanY /= n; dstMeanX /= n; dstMeanY /= n;

  let sxx = 0, sxy = 0, syx = 0, syy = 0, srcVar = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - srcMeanX;
    const sy = src[i][1] - srcMeanY;
    const dx = dst[i][0] - dstMeanX;
    const dy = dst[i][1] - dstMeanY;
    sxx += sx * dx; sxy += sx * dy; syx += sy * dx; syy += sy * dy;
    srcVar += sx * sx + sy * sy;
  }
  // עבור טרנספורמציית דמיון 2D: a = (sxx+syy)/var, b = (sxy-syx)/var
  const a = (sxx + syy) / srcVar;
  const b = (sxy - syx) / srcVar;
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);
  return [a, b, tx, ty];
}

/**
 * מיישר פנים מתוך תמונת מקור ל-112×112 לפי 5 נקודות, ומחזיר חתימת זהות מנורמלת.
 */
export async function embedAlignedFace(
  source: CanvasImageSource,
  face: FacePoints,
): Promise<number[]> {
  const [a, b, tx, ty] = similarityTransform(face.points, ARCFACE_TEMPLATE);

  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // setTransform(m11, m12, m21, m22, dx, dy): x' = m11*x + m21*y + dx
  ctx.setTransform(a, b, -b, a, tx, ty);
  ctx.drawImage(source, 0, 0);

  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  // קלט המודל: NCHW, BGR? w600k של insightface מאומן על BGR עם נרמול (x-127.5)/128
  const input = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const bl = data[i * 4 + 2];
    input[i] = (bl - 127.5) / 128; // B
    input[plane + i] = (g - 127.5) / 128; // G
    input[2 * plane + i] = (r - 127.5) / 128; // R
  }

  const { ort, session } = await getSession();
  const tensor = new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const results = await session.run({ [session.inputNames[0]]: tensor });
  const raw = results[session.outputNames[0]].data as Float32Array;

  let norm = 0;
  for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(raw, (v) => v / norm);
}
