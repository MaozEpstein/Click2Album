import type { PhotoRecord } from './db';

export const NO_DATE_KEY = 'no-date';

export interface DayGroup {
  /** 'YYYY-MM-DD' לפי זמן מקומי, או NO_DATE_KEY */
  key: string;
  /** חצות של אותו יום במילישניות; null עבור "ללא תאריך" */
  dayStart: number | null;
  photos: PhotoRecord[];
}

function dayKeyOf(takenAt: number): string {
  const d = new Date(takenAt);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * מקבץ תמונות לימים לפי זמן מקומי, ממוין כרונולוגית.
 * בתוך כל יום התמונות ממוינות לפי שעת צילום.
 * דלי "ללא תאריך" תמיד אחרון.
 */
export function groupByDay(photos: PhotoRecord[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();

  for (const photo of photos) {
    const key = photo.takenAt === null ? NO_DATE_KEY : dayKeyOf(photo.takenAt);
    let group = groups.get(key);
    if (!group) {
      const dayStart =
        photo.takenAt === null ? null : new Date(photo.takenAt).setHours(0, 0, 0, 0);
      group = { key, dayStart, photos: [] };
      groups.set(key, group);
    }
    group.photos.push(photo);
  }

  for (const group of groups.values()) {
    group.photos.sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0));
  }

  return [...groups.values()].sort((a, b) => {
    if (a.dayStart === null) return 1;
    if (b.dayStart === null) return -1;
    return a.dayStart - b.dayStart;
  });
}

const dayFormatter = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function formatDayTitle(group: DayGroup): string | null {
  return group.dayStart === null ? null : dayFormatter.format(group.dayStart);
}
