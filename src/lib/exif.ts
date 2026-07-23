import exifr from 'exifr';

export interface PhotoDateInfo {
  /** חותמת זמן במילישניות, או null כשאין שום מקור תאריך אמין */
  takenAt: number | null;
  /** true רק כשהתאריך הגיע מ-EXIF אמיתי (ולא מתאריך הקובץ) */
  hasExif: boolean;
  /** ממדי המקור המלאים מה-EXIF (מתוקנים לסיבוב); null כשלא ידועים */
  pixelWidth: number | null;
  pixelHeight: number | null;
}

/**
 * מחלץ מ-EXIF: מועד הצילום (DateTimeOriginal, עם fallback לתאריך הקובץ)
 * וממדי המקור — בלי לפענח את הפיקסלים (זול מאוד).
 */
export async function extractDateInfo(file: File): Promise<PhotoDateInfo> {
  let takenAt: number | null = null;
  let hasExif = false;
  let pixelWidth: number | null = null;
  let pixelHeight: number | null = null;

  try {
    const exif = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ExifImageWidth', 'ExifImageHeight', 'Orientation'],
    });
    const date: Date | undefined = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      takenAt = date.getTime();
      hasExif = true;
    }
    if (typeof exif?.ExifImageWidth === 'number' && typeof exif?.ExifImageHeight === 'number') {
      // אוריינטציות 5-8 = סיבוב 90° — הרוחב והגובה מתחלפים בתצוגה
      const rotated = typeof exif?.Orientation === 'number' && exif.Orientation >= 5;
      pixelWidth = rotated ? exif.ExifImageHeight : exif.ExifImageWidth;
      pixelHeight = rotated ? exif.ExifImageWidth : exif.ExifImageHeight;
    }
  } catch {
    // קובץ בלי EXIF תקין — נמשיך ל-fallback
  }

  if (takenAt === null && file.lastModified > 0) {
    takenAt = file.lastModified;
  }
  return { takenAt, hasExif, pixelWidth, pixelHeight };
}
