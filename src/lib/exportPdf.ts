import { PDFDocument, rgb } from 'pdf-lib';
import type { AlbumLayout } from './album';
import type { PhotoRecord } from './db';
import { getSourceHandle } from './db';
import { getTemplate } from './templates';
import { ensureReadPermission, getOriginalFile } from '../sources/localFolder';

/**
 * יצוא האלבום ל-PDF באיכות דפוס.
 * לכל תמונה מנסים לקרוא את קובץ המקור (דרך ה-handle השמור);
 * אם אין — נופלים ל-preview של 1280px. היצוא לעולם לא נכשל בגלל תמונה בודדת.
 */

/** גודל עמוד: 25×25 ס"מ בנקודות PDF (72pt לאינץ') */
const PAGE_SIZE_PT = 709;
/** רזולוציית תמונה מרבית ביצוא — ~300DPI לרוחב עמוד מלא */
const MAX_EXPORT_PX = 3000;
const JPEG_QUALITY = 0.92;
/** גובה פס כותרת התאריך בתחתית עמוד פותח-יום (יחסי) */
const DAY_TITLE_AREA = 0.12;

export interface ExportProgress {
  page: number;
  totalPages: number;
}

export interface ExportResult {
  blob: Blob;
  /** true אם תמונה אחת לפחות יוצאה מה-preview במקום מהמקור */
  usedFallback: boolean;
}

/** חיתוך cover ליחס המשבצת + הקטנה לגבול היצוא → JPEG bytes */
async function renderSlotJpeg(
  file: Blob,
  slotRatio: number,
): Promise<Uint8Array | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    // חיתוך מרכזי ליחס המשבצת — זהה ל-object-fit: cover במסך
    const srcRatio = bitmap.width / bitmap.height;
    let sx = 0;
    let sy = 0;
    let sw = bitmap.width;
    let sh = bitmap.height;
    if (srcRatio > slotRatio) {
      sw = bitmap.height * slotRatio;
      sx = (bitmap.width - sw) / 2;
    } else {
      sh = bitmap.width / slotRatio;
      sy = (bitmap.height - sh) / 2;
    }

    const scale = Math.min(1, MAX_EXPORT_PX / Math.max(sw, sh));
    const outW = Math.max(1, Math.round(sw * scale));
    const outH = Math.max(1, Math.round(sh * scale));

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** מרנדר כותרת עברית ל-PNG שקוף דרך canvas — עוקף בעיות פונט/bidi ב-PDF */
async function renderTitlePng(text: string, widthPx: number, heightPx: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d')!;
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = heightPx * 0.06;
  ctx.font = `700 ${Math.round(heightPx * 0.34)}px Heebo, sans-serif`;
  ctx.fillText(text, widthPx / 2, heightPx / 2);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportAlbumToPdf(
  layout: AlbumLayout,
  photosById: Map<string, PhotoRecord>,
  onProgress: (progress: ExportProgress) => void,
): Promise<ExportResult> {
  // ניסיון גישה למקורות — אם נכשל, כל האלבום ייוצא מה-previews
  let sourceRoot: FileSystemDirectoryHandle | null = null;
  try {
    const handle = await getSourceHandle();
    if (handle && (await ensureReadPermission(handle))) {
      sourceRoot = handle;
    }
  } catch {
    sourceRoot = null;
  }

  const doc = await PDFDocument.create();
  let usedFallback = false;
  const totalPages = layout.pages.length;

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
    const albumPage = layout.pages[pageIndex];
    onProgress({ page: pageIndex + 1, totalPages });

    const template = getTemplate(albumPage.templateId);
    const page = doc.addPage([PAGE_SIZE_PT, PAGE_SIZE_PT]);
    // רקע נייר לבן מגיע כברירת מחדל של PDF — אין צורך לצייר

    for (let slotIndex = 0; slotIndex < template.slots.length; slotIndex++) {
      const slot = template.slots[slotIndex];
      const photo = photosById.get(albumPage.slots[slotIndex]?.photoId ?? '');
      if (!photo) continue;

      // מקור באיכות מלאה, או preview כ-fallback
      let sourceBlob: Blob | null = null;
      if (sourceRoot) {
        sourceBlob = await getOriginalFile(sourceRoot, photo.id);
      }
      if (!sourceBlob) {
        sourceBlob = photo.preview;
        usedFallback = true;
      }

      const slotRatio = slot.w / slot.h;
      let jpegBytes = await renderSlotJpeg(sourceBlob, slotRatio);
      // מקור שלא ניתן לפענוח (HEIC וכו') — ניסיון נוסף מה-preview
      if (!jpegBytes && sourceBlob !== photo.preview) {
        usedFallback = true;
        jpegBytes = await renderSlotJpeg(photo.preview, slotRatio);
      }
      if (!jpegBytes) continue;

      const image = await doc.embedJpg(jpegBytes);
      page.drawImage(image, {
        x: slot.x * PAGE_SIZE_PT,
        // מערכת הצירים של PDF מתחילה מלמטה
        y: (1 - slot.y - slot.h) * PAGE_SIZE_PT,
        width: slot.w * PAGE_SIZE_PT,
        height: slot.h * PAGE_SIZE_PT,
      });
    }

    // כותרת תאריך בעמוד פותח-יום — פס כהה שקוף בתחתית + טקסט לבן (כמו במסך)
    if (albumPage.dayTitle) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: PAGE_SIZE_PT,
        height: DAY_TITLE_AREA * PAGE_SIZE_PT,
        color: rgb(0, 0, 0),
        opacity: 0.45,
      });
      const titleW = Math.round(PAGE_SIZE_PT * 2); // פי 2 לחדות
      const titleH = Math.round(PAGE_SIZE_PT * DAY_TITLE_AREA * 2);
      const pngBytes = await renderTitlePng(albumPage.dayTitle, titleW, titleH);
      const png = await doc.embedPng(pngBytes);
      page.drawImage(png, {
        x: 0,
        y: 0,
        width: PAGE_SIZE_PT,
        height: DAY_TITLE_AREA * PAGE_SIZE_PT,
      });
    }
  }

  const bytes = await doc.save();
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    usedFallback,
  };
}

/** מוריד את ה-PDF לקובץ */
export function downloadPdf(blob: Blob): void {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `album-${stamp}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
