import exifr from 'exifr';

export interface PhotoDateInfo {
  /** חותמת זמן במילישניות, או null כשאין שום מקור תאריך אמין */
  takenAt: number | null;
  /** true רק כשהתאריך הגיע מ-EXIF אמיתי (ולא מתאריך הקובץ) */
  hasExif: boolean;
}

/**
 * מחלץ את מועד הצילום: EXIF DateTimeOriginal קודם,
 * ואם אין — תאריך שינוי הקובץ כ-fallback (מסומן hasExif=false).
 */
export async function extractDateInfo(file: File): Promise<PhotoDateInfo> {
  try {
    const exif = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate'],
    });
    const date: Date | undefined = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return { takenAt: date.getTime(), hasExif: true };
    }
  } catch {
    // קובץ בלי EXIF תקין — נמשיך ל-fallback
  }

  if (file.lastModified > 0) {
    return { takenAt: file.lastModified, hasExif: false };
  }
  return { takenAt: null, hasExif: false };
}
