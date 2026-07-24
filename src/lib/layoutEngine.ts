import type { PhotoRecord } from './db';
import { groupByDay, formatDayTitle } from './days';
import type { AlbumLayout, AlbumPage, SlotRef } from './album';
import { generalTemplates, getTemplate, type PageTemplate, type TemplateSlot } from './templates';

/**
 * מנוע העימוד האוטומטי:
 * לכל יום — עמוד פותח עם תאריך, עמודי hero למועדפות,
 * והשאר בקבוצות של 2-4 עם בחירת תבנית לפי ציון התאמה.
 */

// ===== משקלי ציון — כיול במקום אחד (מבוסס כללי העיצוב מהמחקר) =====
/** בונוס כשאוריינטציית התמונה תואמת את העדפת המשבצת */
const ORIENTATION_MATCH_BONUS = 10;
/** עונש כשהאוריינטציה הפוכה (portrait במשבצת landscape וכו') */
const ORIENTATION_MISMATCH_PENALTY = -8;
/** משקל עונש החיתוך: הפרש יחסי הממדים (log) כפול המשקל */
const CROP_PENALTY_WEIGHT = -4;
/** מהמחקר: חיתוך שגוזר יותר מ-15% מהתמונה — עונש חד נוסף */
const HARD_CROP_THRESHOLD = 0.15;
const HARD_CROP_PENALTY = -40;
/** עונש על שימוש באותה תבנית פעמיים ברצף — שומר על גיוון */
const REPEAT_TEMPLATE_PENALTY = -6;
/** קצב: עמוד עשיר אחרי עמוד עשיר — עייף; שקט אחרי עשיר — נשימה */
const RICH_AFTER_RICH_PENALTY = -5;
const QUIET_AFTER_RICH_BONUS = 3;
/** עלות קבועה לעמוד — איזון עדין נגד התפרקות לעמודים בודדים רבים מדי */
const PAGE_COST = -2;
/** סף היחס שמעליו תמונה נחשבת אופקית/אנכית (סביבו — "ריבועית") */
const SQUARE_TOLERANCE = 0.08;

type Orientation = 'portrait' | 'landscape' | 'square';

function orientationOf(photo: PhotoRecord): Orientation {
  const ratio = photo.width / photo.height;
  if (ratio > 1 + SQUARE_TOLERANCE) return 'landscape';
  if (ratio < 1 - SQUARE_TOLERANCE) return 'portrait';
  return 'square';
}

/** ציון התאמה של תמונה בודדת למשבצת */
function slotScore(photo: PhotoRecord, slot: TemplateSlot): number {
  const orientation = orientationOf(photo);
  let score = 0;

  if (slot.prefer !== 'any' && orientation !== 'square') {
    score += orientation === slot.prefer ? ORIENTATION_MATCH_BONUS : ORIENTATION_MISMATCH_PENALTY;
  }

  // עונש חיתוך: כמה רחוק יחס התמונה מיחס המשבצת (בסקאלה לוגריתמית — סימטרי)
  const photoRatio = photo.width / photo.height;
  const slotRatio = slot.w / slot.h;
  score += Math.abs(Math.log(photoRatio / slotRatio)) * CROP_PENALTY_WEIGHT;

  // כלל ה-15%: חלק התמונה שנגזר בחיתוך cover
  const cropLoss = 1 - Math.min(photoRatio, slotRatio) / Math.max(photoRatio, slotRatio);
  if (cropLoss > HARD_CROP_THRESHOLD) {
    score += (cropLoss - HARD_CROP_THRESHOLD) * HARD_CROP_PENALTY;
  }
  return score;
}

/**
 * מציב קבוצת תמונות בתבנית בהתאמה הטובה ביותר (הצמדה חמדנית של
 * התמונה ה"קשה" ביותר קודם), ומחזיר ציון + סדר השיבוץ.
 */
function bestAssignment(
  photos: PhotoRecord[],
  template: PageTemplate,
): { score: number; order: PhotoRecord[] } {
  // עבור 2-4 תמונות אפשר לבדוק את כל התמורות — זול ומדויק
  const permutations = permute(photos);
  let best: { score: number; order: PhotoRecord[] } = { score: -Infinity, order: photos };
  for (const order of permutations) {
    let score = 0;
    for (let i = 0; i < order.length; i++) {
      score += slotScore(order[i], template.slots[i]);
    }
    if (score > best.score) best = { score, order };
  }
  return best;
}

function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permute(rest)) result.push([items[i], ...p]);
  }
  return result;
}

/** בחירת התבנית הטובה ביותר לקבוצה, בהתחשב בתבנית הקודמת (גיוון + קצב) */
function bestTemplateFor(
  photos: PhotoRecord[],
  previousTemplate: PageTemplate | null,
): { template: PageTemplate; order: PhotoRecord[]; score: number } {
  const candidates = generalTemplates(photos.length);
  let best: { template: PageTemplate; order: PhotoRecord[]; score: number } | null = null;
  for (const template of candidates) {
    const { score, order } = bestAssignment(photos, template);
    let total = score;
    if (previousTemplate) {
      if (template.id === previousTemplate.id) total += REPEAT_TEMPLATE_PENALTY;
      // קצב: עשיר אחרי עשיר מעייף; שקט אחרי עשיר נותן נשימה
      if (previousTemplate.density === 'rich') {
        if (template.density === 'rich') total += RICH_AFTER_RICH_PENALTY;
        else if (template.density === 'quiet') total += QUIET_AFTER_RICH_BONUS;
      }
    }
    if (!best || total > best.score) best = { template, order, score: total };
  }
  if (!best) throw new Error(`No template for group of ${photos.length}`);
  return best;
}

/**
 * חלוקת רצף תמונות לקבוצות של 1-4 באמצעות תכנות דינמי:
 * dp[i] = החלוקה הטובה ביותר של i התמונות הראשונות, לפי סכום ציוני התבניות.
 */
function partitionIntoPages(
  photos: PhotoRecord[],
  startTemplate: PageTemplate | null,
): AlbumPage[] {
  const n = photos.length;
  if (n === 0) return [];

  interface DPEntry {
    score: number;
    prev: number;
    template: PageTemplate;
    order: PhotoRecord[];
  }
  const dp: (DPEntry | null)[] = new Array(n + 1).fill(null);
  dp[0] = { score: 0, prev: -1, template: null as unknown as PageTemplate, order: [] };

  for (let i = 1; i <= n; i++) {
    for (let size = 1; size <= Math.min(4, i); size++) {
      const prevEntry = dp[i - size];
      if (!prevEntry) continue;
      const group = photos.slice(i - size, i);
      const prevTemplate = i - size === 0 ? startTemplate : prevEntry.template ?? null;
      const { template, order, score } = bestTemplateFor(group, prevTemplate);
      const total = prevEntry.score + score + PAGE_COST;
      if (!dp[i] || total > dp[i]!.score) {
        dp[i] = { score: total, prev: i - size, template, order };
      }
    }
  }

  // שחזור הפתרון
  const pages: AlbumPage[] = [];
  let i = n;
  while (i > 0) {
    const entry = dp[i]!;
    pages.unshift({
      id: `page-${entry.order[0].id}`,
      templateId: entry.template.id,
      slots: entry.order.map((p) => ({ photoId: p.id })),
      dayKey: '', // מולא על ידי הקורא
    });
    i = entry.prev;
  }
  return pages;
}

// ===== פעולות עריכה ידנית — טהורות, מחזירות layout חדש =====

/** החלפת שתי תמונות בין משבצות (באותו עמוד או בין עמודים) */
export function swapSlots(layout: AlbumLayout, a: SlotRef, b: SlotRef): AlbumLayout {
  const pages = layout.pages.map((page) => {
    if (page.id !== a.pageId && page.id !== b.pageId) return page;
    const slots = page.slots.map((slot, i) => {
      if (page.id === a.pageId && i === a.slotIndex) {
        const other = layout.pages.find((p) => p.id === b.pageId)!.slots[b.slotIndex];
        return { photoId: other.photoId };
      }
      if (page.id === b.pageId && i === b.slotIndex) {
        const other = layout.pages.find((p) => p.id === a.pageId)!.slots[a.slotIndex];
        return { photoId: other.photoId };
      }
      return slot;
    });
    return { ...page, slots };
  });
  return { pages };
}

/** החלפת תבנית עמוד (חייבת אותו מספר משבצות) */
export function changeTemplate(
  layout: AlbumLayout,
  pageId: string,
  templateId: string,
): AlbumLayout {
  return {
    pages: layout.pages.map((page) =>
      page.id === pageId ? { ...page, templateId } : page,
    ),
  };
}

/**
 * הסרת תמונה מעמוד: העמוד עובר לתבנית המתאימה ביותר למספר החדש,
 * או נמחק אם התרוקן.
 */
export function removePhotoFromPage(
  layout: AlbumLayout,
  pageId: string,
  photoId: string,
  photosById: Map<string, PhotoRecord>,
): AlbumLayout {
  const pages: AlbumPage[] = [];
  for (const page of layout.pages) {
    if (page.id !== pageId) {
      pages.push(page);
      continue;
    }
    const remaining = page.slots.filter((s) => s.photoId !== photoId);
    if (remaining.length === 0) continue; // עמוד ריק — נמחק

    const currentTemplate = getTemplate(page.templateId);
    if (currentTemplate.role) {
      // עמוד מיוחד (hero / פותח יום) עם משבצת אחת לא מגיע לכאן עם remaining>0,
      // אבל ליתר ביטחון — משאירים את התבנית
      pages.push({ ...page, slots: remaining });
      continue;
    }

    const photos = remaining
      .map((s) => photosById.get(s.photoId))
      .filter((p): p is PhotoRecord => p !== undefined);
    const { template, order } = bestTemplateFor(photos, null);
    pages.push({
      ...page,
      templateId: template.id,
      slots: order.map((p) => ({ photoId: p.id })),
    });
  }
  return { pages };
}

export interface BuildOptions {
  /** נופים שנבחרו הופכים לרקעי עמודים (מתחת לתמונות האנשים) */
  sceneryAsBackgrounds?: boolean;
}

/** בונה את האלבום המלא מהתמונות שנבחרו (keep/favorite) */
export function buildAlbum(allPhotos: PhotoRecord[], options: BuildOptions = {}): AlbumLayout {
  const { sceneryAsBackgrounds = false } = options;
  const selected = allPhotos.filter(
    (p) => p.decision === 'keep' || p.decision === 'favorite',
  );
  const days = groupByDay(selected);
  const pages: AlbumPage[] = [];

  for (const day of days) {
    const dayTitle = formatDayTitle(day);
    let photos = day.photos;
    if (photos.length === 0) continue;

    /**
     * נופים כרקעים: נופים לא-מועדפים (0 דמויות) יוצאים מהזרם והופכים
     * לבריכת רקעי עמודים. נוף מועדף (★) הוא רגע — נשאר בזרם ומקבל hero.
     * תמונות שטרם נותחו נשארות בזרם הרגיל.
     */
    let backgroundPool: PhotoRecord[] = [];
    if (sceneryAsBackgrounds) {
      const isScenery = (p: PhotoRecord) =>
        (p.personCount ?? p.faceCount) === 0 && p.decision !== 'favorite';
      backgroundPool = photos.filter(isScenery);
      photos = photos.filter((p) => !isScenery(p));
      // אם היום כולו נופים — הם הזרם הראשי (אין את מי להניח עליהם)
      if (photos.length === 0) {
        photos = backgroundPool;
        backgroundPool = [];
      }
    }

    // 1. עמוד פותח יום: מועדפת אם יש, אחרת הראשונה
    const openerPhoto = photos.find((p) => p.decision === 'favorite') ?? photos[0];
    pages.push({
      id: `opener-${day.key}`,
      templateId: 'day-opener',
      slots: [{ photoId: openerPhoto.id }],
      dayKey: day.key,
      dayTitle: dayTitle ?? undefined,
    });

    // 2. מועדפות (חוץ מזו שבפותח) — עמוד hero לכל אחת, בסדר כרונולוגי
    const rest = photos.filter((p) => p.id !== openerPhoto.id);
    const favorites = rest.filter((p) => p.decision === 'favorite');
    const regular = rest.filter((p) => p.decision !== 'favorite');

    for (const fav of favorites) {
      const heroTemplate = orientationOf(fav) === 'portrait' ? 'hero-framed' : 'hero-full';
      pages.push({
        id: `hero-${fav.id}`,
        templateId: heroTemplate,
        slots: [{ photoId: fav.id }],
        dayKey: day.key,
      });
    }

    // 3. שאר התמונות — חלוקה אופטימלית לעמודים של 1-4
    const lastTemplate =
      pages.length > 0 ? getTemplate(pages[pages.length - 1].templateId) : null;
    const regularPages = partitionIntoPages(regular, lastTemplate);

    // 4. שיוך רקעים: לכל עמוד — הנוף הקרוב כרונולוגית לתמונותיו
    //    (הנוף שצולם באותו מעמד). כל נוף משמש רקע אחד לכל היותר.
    const availableBg = [...backgroundPool];
    for (const page of regularPages) {
      page.dayKey = day.key;
      if (availableBg.length > 0) {
        const pageTime =
          page.slots
            .map((s) => day.photos.find((p) => p.id === s.photoId)?.takenAt ?? 0)
            .reduce((a, v) => a + v, 0) / Math.max(1, page.slots.length);
        let bestIdx = 0;
        let bestGap = Infinity;
        for (let i = 0; i < availableBg.length; i++) {
          const gap = Math.abs((availableBg[i].takenAt ?? 0) - pageTime);
          if (gap < bestGap) {
            bestGap = gap;
            bestIdx = i;
          }
        }
        page.backgroundPhotoId = availableBg[bestIdx].id;
        availableBg.splice(bestIdx, 1);
      }
      pages.push(page);
    }

    // 5. נופים שלא שימשו כרקע — לא הולכים לאיבוד: עמודים רגילים בסוף היום
    if (availableBg.length > 0) {
      const prevTemplate =
        pages.length > 0 ? getTemplate(pages[pages.length - 1].templateId) : null;
      const leftoverPages = partitionIntoPages(availableBg, prevTemplate);
      for (const page of leftoverPages) {
        page.dayKey = day.key;
        page.id = `bg-${page.id}`;
        pages.push(page);
      }
    }
  }

  return { pages };
}
