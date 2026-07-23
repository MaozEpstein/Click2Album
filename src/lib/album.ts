/**
 * מודל האלבום — JSON טהור של עמודים ושיבוצים.
 * עמוד הוא יחידה עצמאית (תבנית + שיבוצים) — הבסיס לעריכה ידנית
 * ול"הרכבה מכמה אלבומים" בעתיד, וגם ליצוא PDF.
 */

export interface SlotAssignment {
  photoId: string;
}

export interface AlbumPage {
  id: string;
  templateId: string;
  slots: SlotAssignment[];
  /** היום שאליו שייך העמוד (מפתח מ-days.ts) */
  dayKey: string;
  /** כותרת תאריך בעברית — רק בעמוד פותח-יום */
  dayTitle?: string;
}

export interface AlbumLayout {
  pages: AlbumPage[];
}

/** מזהה משבצת בודדת באלבום — לעריכה (swap וכו') */
export interface SlotRef {
  pageId: string;
  slotIndex: number;
}

/** טביעת אצבע של סט תמונות נבחרות — לזיהוי אם האלבום השמור עדכני */
export function selectionFingerprint(photoIds: string[]): string {
  return [...photoIds].sort().join('|');
}
