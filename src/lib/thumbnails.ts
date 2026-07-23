import { computePHash } from './phash';
import { computeQualityMetrics, type QualityMetrics } from './quality';

const THUMB_MAX_SIZE = 320;
const PREVIEW_MAX_SIZE = 1280;
const THUMB_QUALITY = 0.8;
const PREVIEW_QUALITY = 0.82;

export interface DerivativesResult {
  /** תמונה ממוזערת לרשתות ולכרטיסים */
  thumbnail: Blob;
  /** תמונה גדולה למסך הסווייפ ולתצוגה מלאה */
  preview: Blob;
  width: number;
  height: number;
  /** perceptual hash לזיהוי כמעט-כפולות */
  phash: string;
  /** hash של הריבוע המרכזי — עמיד להבדלי מסגור/זום */
  phashCenter: string;
  /** מדדי איכות — לסינון מטושטשות/חשוכות */
  quality: QualityMetrics;
}

function scaleTo(bitmap: ImageBitmap, maxSize: number): { width: number; height: number } {
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  return {
    width: Math.max(1, Math.round(bitmap.width * scale)),
    height: Math.max(1, Math.round(bitmap.height * scale)),
  };
}

async function renderWebP(bitmap: ImageBitmap, maxSize: number, quality: number): Promise<Blob | null> {
  const { width, height } = scaleTo(bitmap, maxSize);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/webp', quality });
}

/**
 * יוצר משני פענוח אחד של הקובץ שני נגזרים: thumbnail (320px) ו-preview (1280px).
 * createImageBitmap מטפל בתיקון אוריינטציית EXIF אוטומטית.
 */
export async function createDerivatives(file: File): Promise<DerivativesResult | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // פורמט שהדפדפן לא יודע לפענח (למשל HEIC בחלק מהדפדפנים)
    return null;
  }

  try {
    const [thumbnail, preview] = await Promise.all([
      renderWebP(bitmap, THUMB_MAX_SIZE, THUMB_QUALITY),
      renderWebP(bitmap, PREVIEW_MAX_SIZE, PREVIEW_QUALITY),
    ]);
    if (!thumbnail || !preview) return null;
    const phash = computePHash(bitmap);
    const phashCenter = computePHash(bitmap, 0.6);
    const quality = computeQualityMetrics(bitmap);
    return {
      thumbnail,
      preview,
      width: bitmap.width,
      height: bitmap.height,
      phash,
      phashCenter,
      quality,
    };
  } finally {
    bitmap.close();
  }
}
