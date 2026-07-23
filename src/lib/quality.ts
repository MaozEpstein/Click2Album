/**
 * גלאי איכות — רצים על ה-bitmap שכבר פוענח בסריקה.
 * התוצאה היא *הצעה* בלבד: המשתמש מאשר במסך הניקוי, האפליקציה לא זורקת לבד.
 */

export type QualityFlag = 'blurry' | 'dark' | 'screenshot';

export interface QualityMetrics {
  /** שונות Laplacian — גבוה = חד */
  sharpness: number;
  /** חציון בהירות 0-255 */
  brightness: number;
  /** אחוזון-95 של הבהירות — לזיהוי "אין שום אזור בהיר" */
  brightP95: number;
  /**
   * חתימת צבע: 12 סלי גוון (משוקללי רוויה, מנורמלים) + בהירות ממוצעת (0-1).
   * משמשת כווטו בקיבוץ דומות — צבעוניות שונה בבוטה = רגעים שונים.
   */
  colorSig: number[];
}

// ===== ספים — שמרניים בכוונה: עדיף לפספס מטושטשת מלסמן תמונה טובה =====
const BLUR_THRESHOLD = 28;
/** תמונה נחשבת חשוכה רק אם גם החציון וגם אחוזון-95 נמוכים (אין אזור בהיר) */
const DARK_MEDIAN_THRESHOLD = 38;
const DARK_P95_THRESHOLD = 90;

const ANALYSIS_SIZE = 128;

/** רזולוציות מסך נפוצות (בשני הכיוונים) לזיהוי צילומי מסך */
const SCREEN_DIMENSIONS = new Set([
  '1080x1920', '1080x2340', '1080x2400', '1170x2532', '1179x2556', '1284x2778',
  '1290x2796', '1440x2960', '1440x3040', '1440x3200', '720x1280', '720x1600',
  '750x1334', '828x1792', '1125x2436', '1242x2688', '1242x2208',
  '1920x1080', '2560x1440', '3840x2160', '1366x768', '1536x864', '2880x1800',
]);

/** מחשב חדות ובהירות מ-bitmap (מוקטן ל-128px — מהיר) */
export function computeQualityMetrics(bitmap: ImageBitmap): QualityMetrics {
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(8, Math.round(bitmap.width * scale));
  const h = Math.max(8, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { sharpness: 999, brightness: 128, brightP95: 255, colorSig: [] };
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  // גרייסקייל
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }

  // Laplacian: לכל פיקסל פנימי — 4*מרכז פחות שכנים; שונות התוצאה = מדד חדות.
  // נמדד בנפרד גם באזור המרכזי (שליש אמצעי) — בוקה עם מרכז חד שורד.
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let centerSum = 0;
  let centerSumSq = 0;
  let centerCount = 0;
  const cx0 = Math.floor(w / 3);
  const cx1 = Math.floor((2 * w) / 3);
  const cy0 = Math.floor(h / 3);
  const cy1 = Math.floor((2 * h) / 3);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      count += 1;
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
        centerSum += lap;
        centerSumSq += lap * lap;
        centerCount += 1;
      }
    }
  }
  const variance = sumSq / count - (sum / count) ** 2;
  const centerVariance =
    centerCount > 0 ? centerSumSq / centerCount - (centerSum / centerCount) ** 2 : variance;
  // התמונה חדה אם *או* הכלל *או* המרכז חדים
  const sharpness = Math.max(variance, centerVariance);

  // בהירות: חציון
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const brightness = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  // חתימת צבע: היסטוגרמת 12 גווני hue משוקללת רוויה + בהירות ממוצעת
  const hueBins = new Array(12).fill(0);
  let lumaSum = 0;
  const pixels = w * h;
  for (let i = 0; i < pixels; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    lumaSum += (r + g + b) / 3;
    if (delta < 0.03) continue; // אפור — בלי גוון
    let hue: number;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    const saturation = max === 0 ? 0 : delta / max;
    hueBins[Math.min(11, Math.floor(hue / 30))] += saturation;
  }
  const total = hueBins.reduce((a, v) => a + v, 0);
  const colorSig =
    total > 0 ? hueBins.map((v) => v / total) : hueBins.map(() => 0);
  colorSig.push(lumaSum / pixels);

  return { sharpness, brightness, brightP95: p95, colorSig };
}

export interface FlagInput {
  metrics: QualityMetrics;
  hasExif: boolean;
  fileName: string;
  fileType: string;
  width: number;
  height: number;
}

/** מסיק דגלים מהמדדים והמטא-דאטה */
export function computeFlags(input: FlagInput): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const { metrics, hasExif, fileName, fileType, width, height } = input;

  if (metrics.sharpness < BLUR_THRESHOLD) flags.push('blurry');
  if (metrics.brightness < DARK_MEDIAN_THRESHOLD && metrics.brightP95 < DARK_P95_THRESHOLD) {
    flags.push('dark');
  }

  // צילום מסך: ללא EXIF + לפחות שני סימנים תומכים
  if (!hasExif) {
    let signals = 0;
    if (fileType === 'image/png') signals += 1;
    if (SCREEN_DIMENSIONS.has(`${width}x${height}`)) signals += 1;
    if (/screenshot|screen[ _-]?shot|צילום[ _-]?מסך/i.test(fileName)) signals += 2;
    if (signals >= 2) flags.push('screenshot');
  }

  return flags;
}
