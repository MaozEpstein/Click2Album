/**
 * dHash דו-כיווני — perceptual hash של 128 ביט לזיהוי "כמעט כפולות".
 * התמונה מוקטנת ל-9×9 בגווני אפור; 64 ביטים משווים שכנים אופקית
 * ו-64 נוספים אנכית. הכיוון האנכי קריטי לתמונות "רכות" (שמיים, שקיעות):
 * שם הגרדיאנט האופקי כמעט שטוח (רעש), אבל האנכי יציב.
 */

const GRID = 9;

export function computePHash(bitmap: ImageBitmap, centerCrop = 1): string {
  const canvas = new OffscreenCanvas(GRID, GRID);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  // centerCrop < 1: נדגם רק הריבוע המרכזי — מנטרל הבדלי מסגור/זום בשוליים
  const sw = bitmap.width * centerCrop;
  const sh = bitmap.height * centerCrop;
  const sx = (bitmap.width - sw) / 2;
  const sy = (bitmap.height - sh) / 2;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, GRID, GRID);
  const { data } = ctx.getImageData(0, 0, GRID, GRID);

  // המרה לבהירות (luma)
  const gray: number[] = new Array(GRID * GRID);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }

  let hash = '';
  let nibble = 0;
  let bits = 0;
  const pushBit = (bit: number) => {
    nibble = (nibble << 1) | bit;
    bits += 1;
    if (bits === 4) {
      hash += nibble.toString(16);
      nibble = 0;
      bits = 0;
    }
  };

  // 64 ביטים אופקיים: 8 שורות × 8 השוואות שכנים
  for (let y = 0; y < GRID - 1; y++) {
    for (let x = 0; x < GRID - 1; x++) {
      pushBit(gray[y * GRID + x] < gray[y * GRID + x + 1] ? 1 : 0);
    }
  }
  // 64 ביטים אנכיים: 8 עמודות × 8 השוואות שכנים
  for (let x = 0; x < GRID - 1; x++) {
    for (let y = 0; y < GRID - 1; y++) {
      pushBit(gray[y * GRID + x] < gray[(y + 1) * GRID + x] ? 1 : 0);
    }
  }
  return hash;
}

const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** מרחק המינג בין שני hashes בפורמט hex — כמה ביטים שונים */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    distance += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return distance;
}
