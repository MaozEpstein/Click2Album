import { setEmbedding, type PhotoRecord } from './db';

/**
 * דמיון סמנטי — MobileNet ממיר כל תמונה לווקטור "מה יש בתמונה".
 * רץ ברקע על ה-thumbnails, אחרי סיווג הפנים. עמיד לזום/זווית/אוריינטציה.
 */

export interface EmbedProgress {
  done: number;
  total: number;
}

let running = false;

let modelPromise: Promise<import('@tensorflow-models/mobilenet').MobileNet> | null = null;

async function getModel() {
  modelPromise ??= (async () => {
    const tf = await import('@tensorflow/tfjs');
    const mobilenet = await import('@tensorflow-models/mobilenet');
    await tf.ready();
    return mobilenet.load({ version: 2, alpha: 0.5 });
  })();
  return modelPromise;
}

/** חתימה סמנטית מנורמלת ל-ImageData כלשהו — משמש גם את חתימת הנושא הבולט */
export async function embedImageData(imageData: ImageData): Promise<number[]> {
  const model = await getModel();
  const activation = model.infer(imageData, true);
  const raw = (await activation.data()) as Float32Array;
  activation.dispose();
  let norm = 0;
  for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(raw, (v) => v / norm);
}

/** דמיון קוסינוס בין שני וקטורים מנורמלים */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * מחשב embedding לכל תמונה שטרם חושבה. בטוח לקריאה חוזרת.
 * מעדכן את הרשומות ב-DB ואת האובייקטים שהועברו (in-place).
 */
export async function embedPending(
  photos: PhotoRecord[],
  onProgress: (progress: EmbedProgress) => void,
): Promise<void> {
  if (running) return;
  const pending = photos.filter((p) => p.embedding === null && !p.filtered);
  if (pending.length === 0) return;
  running = true;

  try {
    let done = 0;
    for (const photo of pending) {
      try {
        const bitmap = await createImageBitmap(photo.thumbnail);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        bitmap.close();

        const embedding = await embedImageData(imageData);
        photo.embedding = embedding;
        await setEmbedding(photo.id, embedding);
      } catch {
        // תמונה שנכשלה — ננסה שוב בריצה הבאה
      }
      done += 1;
      onProgress({ done, total: pending.length });
      if (done % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    running = false;
  }
}
