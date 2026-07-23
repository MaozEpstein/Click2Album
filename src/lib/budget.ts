import type { PhotoRecord } from './db';
import { groupByDay } from './days';

/** ממוצע תמונות לעמוד — לגזירת יעד תמונות מיעד עמודים */
const PHOTOS_PER_PAGE = 3.5;

/**
 * מחלק יעד עמודים ליעדי תמונות פר-יום, פרופורציונלית לכמות שצולמה בכל יום.
 * יום עמוס מקבל יעד גדול יותר; מינימום 1 לכל יום.
 */
export function computeDayTargets(
  photos: PhotoRecord[],
  targetPages: number,
): Map<string, number> {
  const targets = new Map<string, number>();
  const days = groupByDay(photos);
  const totalPhotos = photos.length;
  if (totalPhotos === 0 || days.length === 0) return targets;

  const totalTarget = Math.max(days.length, Math.round(targetPages * PHOTOS_PER_PAGE));
  for (const day of days) {
    const share = day.photos.length / totalPhotos;
    targets.set(day.key, Math.max(1, Math.round(totalTarget * share)));
  }
  return targets;
}
