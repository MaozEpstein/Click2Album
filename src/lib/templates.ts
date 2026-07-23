/**
 * ספריית תבניות עמוד — פרימיום, מבוסס מחקר של אלבומי היוקרה
 * (Artifact Uprising, MILK, Align Album Design, גרידים עריכתיים).
 *
 * מערכת קבועה: שוליים M=0.08, מרווח אחיד G=0.025 בכל מקום,
 * משקל לובן תחתון (מרכז אופטי), היררכיה ברורה או שוויון מוחלט.
 * עמוד ריבועי; מלבנים יחסיים (0-1).
 */

export type SlotOrientation = 'portrait' | 'landscape' | 'any';

export interface TemplateSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  prefer: SlotOrientation;
}

/** קצב עמוד — למנוע: אחרי עמוד עשיר מעדיפים עמוד שקט */
export type PageDensity = 'quiet' | 'normal' | 'rich';

export interface PageTemplate {
  id: string;
  photoCount: number;
  slots: TemplateSlot[];
  density: PageDensity;
  /** תבניות מיוחדות שהמנוע בוחר במפורש (לא בבחירה הכללית) */
  role?: 'hero' | 'day-opener';
}

const M = 0.08; // שוליים חיצוניים
const G = 0.015; // מרווח אחיד בין תמונות

// רוחבים נגזרים — עקביים בכל הקטלוג
const PAIR_W = (1 - 2 * M - G) / 2; // 0.4075
const TRI_W = (1 - 2 * M - 2 * G) / 3; // 0.2633
const QUAD_W = (1 - 2 * M - 3 * G) / 4; // 0.1913

export const TEMPLATES: PageTemplate[] = [
  // ===== Hero (מועדפות) =====
  {
    id: 'hero-full',
    photoCount: 1,
    density: 'quiet',
    role: 'hero',
    slots: [{ x: 0, y: 0, w: 1, h: 1, prefer: 'any' }],
  },
  {
    id: 'hero-framed',
    photoCount: 1,
    density: 'quiet',
    role: 'hero',
    slots: [{ x: M, y: M, w: 1 - 2 * M, h: 1 - 2 * M, prefer: 'any' }],
  },

  // ===== פותח יום — full-bleed עם כותרת על גרדיאנט בתחתית =====
  {
    id: 'day-opener',
    photoCount: 1,
    density: 'quiet',
    role: 'day-opener',
    slots: [{ x: 0, y: 0, w: 1, h: 1, prefer: 'landscape' }],
  },

  // ===== בודדות — לובן נדיב, מרכז אופטי =====
  {
    id: 'gallery-single',
    photoCount: 1,
    density: 'quiet',
    slots: [{ x: M, y: M, w: 0.84, h: 0.84, prefer: 'any' }],
  },
  {
    id: 'intimate-single',
    photoCount: 1,
    density: 'quiet',
    slots: [{ x: 0.2, y: 0.17, w: 0.6, h: 0.6, prefer: 'any' }],
  },
  {
    id: 'portrait-optical',
    photoCount: 1,
    density: 'quiet',
    slots: [{ x: 0.275, y: 0.1, w: 0.45, h: 0.72, prefer: 'portrait' }],
  },
  {
    id: 'landscape-lower',
    photoCount: 1,
    density: 'quiet',
    slots: [{ x: 0.1, y: 0.22, w: 0.8, h: 0.56, prefer: 'landscape' }],
  },
  {
    id: 'pano-band',
    photoCount: 1,
    density: 'quiet',
    slots: [{ x: 0, y: 0.3, w: 1, h: 0.4, prefer: 'landscape' }],
  },
  {
    id: 'editorial-offcenter',
    photoCount: 1,
    density: 'quiet',
    slots: [{ x: 0.42, y: M, w: 0.5, h: 0.62, prefer: 'portrait' }],
  },

  // ===== זוגות =====
  {
    id: 'portrait-pair',
    photoCount: 2,
    density: 'normal',
    slots: [
      { x: M, y: 0.14, w: PAIR_W, h: 0.72, prefer: 'portrait' },
      { x: M + PAIR_W + G, y: 0.14, w: PAIR_W, h: 0.72, prefer: 'portrait' },
    ],
  },
  {
    id: 'stacked-landscapes',
    photoCount: 2,
    density: 'normal',
    slots: [
      { x: 0.14, y: M, w: 0.72, h: PAIR_W, prefer: 'landscape' },
      { x: 0.14, y: M + PAIR_W + G, w: 0.72, h: PAIR_W, prefer: 'landscape' },
    ],
  },
  {
    id: 'hero-companion',
    photoCount: 2,
    density: 'normal',
    slots: [
      { x: M, y: M, w: 0.55, h: 0.84, prefer: 'portrait' },
      { x: M + 0.55 + G, y: 0.35, w: 0.265, h: 0.3, prefer: 'any' },
    ],
  },
  {
    id: 'diagonal-squares',
    photoCount: 2,
    density: 'normal',
    slots: [
      { x: M, y: M, w: 0.395, h: 0.395, prefer: 'any' },
      { x: 0.525, y: 0.525, w: 0.395, h: 0.395, prefer: 'any' },
    ],
  },
  {
    id: 'double-pano',
    photoCount: 2,
    density: 'normal',
    slots: [
      { x: M, y: 0.14, w: 0.84, h: 0.345, prefer: 'landscape' },
      { x: M, y: 0.14 + 0.345 + G, w: 0.84, h: 0.345, prefer: 'landscape' },
    ],
  },

  // ===== שלשות =====
  {
    id: 'hero-side-stack',
    photoCount: 3,
    density: 'normal',
    slots: [
      { x: M, y: M, w: 0.545, h: 0.84, prefer: 'portrait' },
      { x: M + 0.545 + G, y: M, w: 1 - 2 * M - 0.545 - G, h: PAIR_W, prefer: 'any' },
      { x: M + 0.545 + G, y: M + PAIR_W + G, w: 1 - 2 * M - 0.545 - G, h: PAIR_W, prefer: 'any' },
    ],
  },
  {
    id: 'hero-top-pair',
    photoCount: 3,
    density: 'normal',
    slots: [
      { x: M, y: M, w: 0.84, h: 0.52, prefer: 'landscape' },
      { x: M, y: M + 0.52 + G, w: PAIR_W, h: 0.295, prefer: 'landscape' },
      { x: M + PAIR_W + G, y: M + 0.52 + G, w: PAIR_W, h: 0.295, prefer: 'landscape' },
    ],
  },
  {
    id: 'lower-third-triptych',
    photoCount: 3,
    density: 'normal',
    slots: [
      { x: M, y: 0.55, w: TRI_W, h: 0.3, prefer: 'any' },
      { x: M + TRI_W + G, y: 0.55, w: TRI_W, h: 0.3, prefer: 'any' },
      { x: M + 2 * (TRI_W + G), y: 0.55, w: TRI_W, h: 0.3, prefer: 'any' },
    ],
  },
  {
    id: 'centered-triptych',
    photoCount: 3,
    density: 'normal',
    slots: [
      { x: M, y: 0.35, w: TRI_W, h: 0.3, prefer: 'any' },
      { x: M + TRI_W + G, y: 0.35, w: TRI_W, h: 0.3, prefer: 'any' },
      { x: M + 2 * (TRI_W + G), y: 0.35, w: TRI_W, h: 0.3, prefer: 'any' },
    ],
  },
  {
    id: 'vertical-triptych',
    photoCount: 3,
    density: 'normal',
    slots: [
      { x: M, y: 0.2, w: TRI_W, h: 0.6, prefer: 'portrait' },
      { x: M + TRI_W + G, y: 0.2, w: TRI_W, h: 0.6, prefer: 'portrait' },
      { x: M + 2 * (TRI_W + G), y: 0.2, w: TRI_W, h: 0.6, prefer: 'portrait' },
    ],
  },
  {
    id: 'l-composition',
    photoCount: 3,
    density: 'normal',
    slots: [
      { x: M, y: M, w: 0.6, h: 0.6, prefer: 'any' },
      { x: M + 0.6 + G, y: M, w: 1 - 2 * M - 0.6 - G, h: 0.6, prefer: 'portrait' },
      { x: M, y: M + 0.6 + G, w: 0.6, h: 1 - 2 * M - 0.6 - G, prefer: 'landscape' },
    ],
  },
  {
    id: 'pano-pair-below',
    photoCount: 3,
    density: 'normal',
    slots: [
      { x: M, y: M, w: 0.84, h: 0.36, prefer: 'landscape' },
      { x: M, y: M + 0.36 + G, w: PAIR_W, h: 0.32, prefer: 'landscape' },
      { x: M + PAIR_W + G, y: M + 0.36 + G, w: PAIR_W, h: 0.32, prefer: 'landscape' },
    ],
  },

  // ===== רביעיות =====
  {
    id: 'grid-2x2',
    photoCount: 4,
    density: 'rich',
    slots: [
      { x: M, y: M, w: PAIR_W, h: PAIR_W, prefer: 'any' },
      { x: M + PAIR_W + G, y: M, w: PAIR_W, h: PAIR_W, prefer: 'any' },
      { x: M, y: M + PAIR_W + G, w: PAIR_W, h: PAIR_W, prefer: 'any' },
      { x: M + PAIR_W + G, y: M + PAIR_W + G, w: PAIR_W, h: PAIR_W, prefer: 'any' },
    ],
  },
  {
    id: 'compact-2x2',
    photoCount: 4,
    density: 'rich',
    slots: [
      { x: 0.16, y: 0.16, w: 0.3275, h: 0.3275, prefer: 'any' },
      { x: 0.16 + 0.3275 + G, y: 0.16, w: 0.3275, h: 0.3275, prefer: 'any' },
      { x: 0.16, y: 0.16 + 0.3275 + G, w: 0.3275, h: 0.3275, prefer: 'any' },
      { x: 0.16 + 0.3275 + G, y: 0.16 + 0.3275 + G, w: 0.3275, h: 0.3275, prefer: 'any' },
    ],
  },
  {
    id: 'hero-bottom-triptych',
    photoCount: 4,
    density: 'rich',
    slots: [
      { x: M, y: M, w: 0.84, h: 0.545, prefer: 'landscape' },
      { x: M, y: M + 0.545 + G, w: TRI_W, h: 0.27, prefer: 'any' },
      { x: M + TRI_W + G, y: M + 0.545 + G, w: TRI_W, h: 0.27, prefer: 'any' },
      { x: M + 2 * (TRI_W + G), y: M + 0.545 + G, w: TRI_W, h: 0.27, prefer: 'any' },
    ],
  },
  {
    id: 'hero-side-3stack',
    photoCount: 4,
    density: 'rich',
    slots: [
      { x: M, y: M, w: 0.545, h: 0.84, prefer: 'portrait' },
      { x: M + 0.545 + G, y: M, w: 1 - 2 * M - 0.545 - G, h: TRI_W, prefer: 'landscape' },
      {
        x: M + 0.545 + G,
        y: M + TRI_W + G,
        w: 1 - 2 * M - 0.545 - G,
        h: TRI_W,
        prefer: 'landscape',
      },
      {
        x: M + 0.545 + G,
        y: M + 2 * (TRI_W + G),
        w: 1 - 2 * M - 0.545 - G,
        h: TRI_W,
        prefer: 'landscape',
      },
    ],
  },
  {
    id: 'pinwheel',
    photoCount: 4,
    density: 'rich',
    slots: [
      { x: M, y: M, w: 0.545, h: PAIR_W, prefer: 'landscape' },
      { x: M + 0.545 + G, y: M, w: 1 - 2 * M - 0.545 - G, h: PAIR_W, prefer: 'portrait' },
      { x: M, y: M + PAIR_W + G, w: 1 - 2 * M - 0.545 - G, h: PAIR_W, prefer: 'portrait' },
      {
        x: M + (1 - 2 * M - 0.545 - G) + G,
        y: M + PAIR_W + G,
        w: 0.545,
        h: PAIR_W,
        prefer: 'landscape',
      },
    ],
  },
  {
    id: 'filmstrip-4',
    photoCount: 4,
    density: 'rich',
    slots: [
      { x: M, y: 0.3725, w: QUAD_W, h: 0.255, prefer: 'portrait' },
      { x: M + QUAD_W + G, y: 0.3725, w: QUAD_W, h: 0.255, prefer: 'portrait' },
      { x: M + 2 * (QUAD_W + G), y: 0.3725, w: QUAD_W, h: 0.255, prefer: 'portrait' },
      { x: M + 3 * (QUAD_W + G), y: 0.3725, w: QUAD_W, h: 0.255, prefer: 'portrait' },
    ],
  },
];

export function hasTemplate(id: string): boolean {
  return TEMPLATES.some((t) => t.id === id);
}

export function getTemplate(id: string): PageTemplate {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Unknown template: ${id}`);
  return template;
}

/** תבניות שהמנוע בוחר מהן חופשית לפי מספר תמונות (ללא hero/day-opener) */
export function generalTemplates(photoCount: number): PageTemplate[] {
  return TEMPLATES.filter((t) => t.photoCount === photoCount && !t.role);
}
