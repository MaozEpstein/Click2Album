import type { PhotoRecord } from './db';
import { hammingDistance } from './phash';
import { cosineSimilarity } from './embed';
import { faceCosine } from './faces';
import { pickBest } from './bestShot';

/** ערימת תמונות דומות (צילומי רצף). תמונה בודדת = ערימה של אחת. */
export interface PhotoStack {
  id: string;
  photos: PhotoRecord[];
  /** התמונה המייצגת שמוצגת בקלף הסווייפ */
  cover: PhotoRecord;
}

/**
 * ספי דמיון מדורגים: ככל שהתמונות קרובות יותר בזמן, מרשים שוני ויזואלי גדול יותר
 * (סשן צילום מול אותה סצנה נמשך גם דקות, עם שינויי זום ומסגור). מתוך 64 ביט.
 */
/**
 * הספים מכוילים ל-hash של 128 ביט (מקסימום אקראי ≈ 64); minCosine — סף הדמיון הסמנטי.
 * הודקו אחרי כיול "צילום בתנועה" (שייט): סצנות מתחלפות בשניות עם אותה תאורה/צבעוניות
 * נבלעו בספים הנדיבים. הזום/מסגור עדיין נתפסים דרך ה-hash המרכזי והסמנטיקה הגבוהה.
 */
const TIERS: Array<{ maxGapMs: number; maxDistance: number; minCosine: number }> = [
  { maxGapMs: 30_000, maxDistance: 44, minCosine: 0.85 }, // רצף צמוד
  { maxGapMs: 180_000, maxDistance: 32, minCosine: 0.87 }, // עד 3 דקות — סשן מול אותה סצנה
  { maxGapMs: 600_000, maxDistance: 18, minCosine: 0.9 }, // עד 10 דקות
  { maxGapMs: 3_600_000, maxDistance: 10, minCosine: 0.94 }, // עד שעה — כמעט זהות בלבד
];

/** וטו סמנטי: מתחת לזה — סצנות שונות גם אם הטביעות דומות במקרה */
const COSINE_VETO = 0.55;
/**
 * נופים (בלי אנשים): "מבנה על נהר בשקיעה" נותן קוסינוס ~0.8 בין סצנות שונות —
 * רעש, לא אות. המסלול הסמנטי מאחד נופים רק בדמיון גבוה מאוד (כמעט אותו אובייקט).
 * החיבורים האמינים לנופים עוברים דרך הטביעות, כולל ההתאמה הצולבת לזום.
 */
const LANDSCAPE_MIN_COSINE = 0.9;
/** חתימת נושא בולט: מעל זה — אותו אובייקט מרכזי → איחוד (מחבר בלבד, שלב א') */
const SUBJECT_MATCH_COSINE = 0.88;
/**
 * ראיות משולבות לנופים: סמנטיקה בינונית-גבוהה + טביעות קרובות-בינוני ביחד —
 * שני אותות חלשים שמסכימים. סוגר את "אותו הר שהמסגור זז" בלי לפתוח את "גשר-טירה".
 */
const COMBINED_MIN_COSINE = 0.85;
const COMBINED_DISTANCE_SLACK = 10;
/** וטו צבע: מרחק L1 בין חתימות צבע מעל הסף — רגעים שונים (שקיעה מול צהריים) */
const COLOR_VETO_DISTANCE = 0.9;

/**
 * אשכולות זהות (ArcFace, קוסינוס): כל חתימות הפנים של היום מקובצות לאנשים.
 * השוואה מול centroid (ממוצע מנורמל) מדכאת רעש של פנים קטנות —
 * הרבה יותר אמין מהשוואה זוגית בין שתי חתימות בודדות.
 */
const CLUSTER_LINK_COSINE = 0.32;
/** מעבר שני: אשכולות שמרכזיהם קרובים מזה — אותו אדם שהתפצל (פרופיל/תאורה) */
const CENTROID_MERGE_COSINE = 0.34;
/** שיפוט בין תמונות לפי מרכזי אשכולות: מעל = אותו אדם, מתחת לתחתון = אנשים שונים */
const VERDICT_SAME_COSINE = 0.35;
const VERDICT_DIFFERENT_COSINE = 0.2;

interface IdentityIndex {
  byPhoto: Map<string, Set<number>>;
  centroids: number[][];
}

type PersonClusters = IdentityIndex;

/** חשיפה לאבחון — אשכולות האנשים של קבוצת תמונות (dev בלבד) */
export function getPersonClusters(photos: PhotoRecord[]): Map<string, Set<number>> {
  return clusterIdentities(photos).byPhoto;
}

function normalizeVec(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** אשכול greedy-centroid + מעבר מיזוג; מחזיר שיוך פר-תמונה ואת מרכזי האשכולות */
function clusterIdentities(photos: PhotoRecord[]): PersonClusters {
  const centroids: number[][] = [];
  const counts: number[] = [];
  const byPhoto = new Map<string, Set<number>>();

  for (const photo of photos) {
    if (!photo.faceSigs?.length) continue;
    const clusters = new Set<number>();
    for (const sig of photo.faceSigs) {
      let bestIdx = -1;
      let bestSim = -1;
      for (let c = 0; c < centroids.length; c++) {
        const sim = faceCosine(centroids[c], sig);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = c;
        }
      }
      if (bestIdx >= 0 && bestSim >= CLUSTER_LINK_COSINE) {
        const c = centroids[bestIdx];
        const k = counts[bestIdx];
        for (let i = 0; i < c.length; i++) c[i] = (c[i] * k + sig[i]) / (k + 1);
        centroids[bestIdx] = normalizeVec(c);
        counts[bestIdx] = k + 1;
        clusters.add(bestIdx);
      } else {
        centroids.push([...sig]);
        counts.push(1);
        clusters.add(centroids.length - 1);
      }
    }
    if (clusters.size > 0) byPhoto.set(photo.id, clusters);
  }

  // מעבר מיזוג: אשכולות של אותו אדם שהתפצלו (פרופיל/תאורה) מתאחדים לפי קרבת מרכזים
  const remap = centroids.map((_, i) => i);
  for (let i = 0; i < centroids.length; i++) {
    for (let j = i + 1; j < centroids.length; j++) {
      if (remap[j] !== j) continue;
      if (faceCosine(centroids[i], centroids[j]) >= CENTROID_MERGE_COSINE) {
        remap[j] = remap[i];
      }
    }
  }
  for (const set of byPhoto.values()) {
    const merged = [...set].map((c) => remap[c]);
    set.clear();
    for (const c of merged) set.add(c);
  }

  return { byPhoto, centroids };
}

/**
 * שיפוט זהות לפי קרבת מרכזי אשכולות (עמיד לפיצולי אשכול):
 * 'same' = יש זוג מרכזים קרובים; 'different' = כל הזוגות רחוקים מאוד; אחרת 'unknown'.
 */
function identityVerdict(
  a: PhotoRecord,
  b: PhotoRecord,
  clusters: PersonClusters,
): 'same' | 'different' | 'unknown' {
  const ca = clusters.byPhoto.get(a.id);
  const cb = clusters.byPhoto.get(b.id);
  if (!ca || !cb) return 'unknown';
  let best = -1;
  for (const i of ca) {
    for (const j of cb) {
      if (i === j) return 'same';
      best = Math.max(best, faceCosine(clusters.centroids[i], clusters.centroids[j]));
    }
  }
  if (best >= VERDICT_SAME_COSINE) return 'same';
  if (best < VERDICT_DIFFERENT_COSINE) return 'different';
  return 'unknown';
}

/** וטו מספר פנים: נוף (0) מול אנשים (1+), או אדם (1) מול קבוצה גדולה (3+) */
function faceCountVeto(a: PhotoRecord, b: PhotoRecord): boolean {
  if (a.faceCount === null || b.faceCount === null) return false;
  const [lo, hi] = a.faceCount <= b.faceCount ? [a.faceCount, b.faceCount] : [b.faceCount, a.faceCount];
  if (lo === 0 && hi >= 1) return true;
  if (lo === 1 && hi >= 3) return true;
  return false;
}

/** וטו צבע: הפרש L1 בין חתימות (12 גוונים + בהירות) */
function colorVeto(a: PhotoRecord, b: PhotoRecord): boolean {
  if (!a.colorSig?.length || !b.colorSig?.length || a.colorSig.length !== b.colorSig.length) {
    return false;
  }
  let distance = 0;
  for (let i = 0; i < a.colorSig.length; i++) {
    distance += Math.abs(a.colorSig[i] - b.colorSig[i]);
  }
  return distance > COLOR_VETO_DISTANCE;
}

/** כמה תמונות אחרונות בערימה משוות מול מועמדת חדשה */
const COMPARE_WINDOW = 3;

/**
 * האם המועמדת שייכת לערימה: משווים מול כמה מהתמונות האחרונות (לא רק האחרונה) —
 * כך תמונה חריגה אחת (זום שונה) לא שוברת את השרשרת.
 */
function belongsToStack(
  stack: PhotoRecord[],
  candidate: PhotoRecord,
  clusters: PersonClusters,
): boolean {
  if (!candidate.phash || candidate.takenAt === null) return false;
  const last = stack[stack.length - 1];
  if (last.takenAt === null) return false;
  const gap = Math.abs(candidate.takenAt - last.takenAt);

  const tier = TIERS.find((t) => gap <= t.maxGapMs);
  if (!tier) return false;

  const window = stack.slice(-COMPARE_WINDOW);

  // ===== וטו זהות (החוק החזק): אנשים שונים לא מתאחדים, בכל פער זמן =====
  // "עמדת צילום" — חברים מתחלפים מול אותו נוף — חייבת להתפצל פר-אדם.
  let sameIdentity = false;
  for (const p of window) {
    const verdict = identityVerdict(p, candidate, clusters);
    if (verdict === 'different') return false;
    if (verdict === 'same') sameIdentity = true;
  }

  // ===== שומרי דיוק משניים: רק בפערים ארוכים וכשאין הכרעת זהות =====
  const VETO_MIN_GAP_MS = 60_000;
  if (gap > VETO_MIN_GAP_MS && !sameIdentity) {
    if (window.some((p) => faceCountVeto(p, candidate))) return false;
    if (window.some((p) => colorVeto(p, candidate))) return false;
  }

  // דמיון פיקסלי: המינימום על פני כל צירופי הטביעות —
  // מלא↔מלא, מרכז↔מרכז, וגם *צולב* מלא↔מרכז: זום-אין של סצנה = המרכז של הזום-אאוט.
  // מנורמל לסקאלת 128 ביט — טביעות ישנות (64 ביט) מוכפלות.
  let minDistance = Infinity;
  // דמיון סמנטי: המקסימום מול חלון ההשוואה
  let maxCosine = -1;
  const compare = (a: string | undefined, b: string | undefined) => {
    if (a && b && a.length === b.length) {
      const scale = 32 / a.length;
      minDistance = Math.min(minDistance, hammingDistance(a, b) * scale);
    }
  };
  // דמיון נושא בולט (נופים): המקסימום מול חלון ההשוואה
  let maxSubjectCosine = -1;
  for (const p of window) {
    compare(p.phash, candidate.phash);
    compare(p.phashCenter, candidate.phashCenter);
    compare(p.phash, candidate.phashCenter); // המועמדת מקורבת, בערימה — הרחבה
    compare(p.phashCenter, candidate.phash); // המועמדת רחבה, בערימה — מקורבת
    if (p.embedding && candidate.embedding) {
      maxCosine = Math.max(maxCosine, cosineSimilarity(p.embedding, candidate.embedding));
    }
    if (p.subjectSig?.length && candidate.subjectSig?.length) {
      maxSubjectCosine = Math.max(
        maxSubjectCosine,
        cosineSimilarity(p.subjectSig, candidate.subjectSig),
      );
    }
  }

  // וטו סמנטי: המודל בטוח שאלה סצנות שונות — גם טביעות דומות לא מאחדות
  if (maxCosine >= 0 && maxCosine < COSINE_VETO) return false;

  // הקשחת נופים: כשאין אנשים מזוהים באף אחד מהצדדים, המסלול הסמנטי דורש
  // דמיון כמעט-זהה. עם אנשים — הספים הרגילים (וטו הזהות כבר שומר שם).
  const facelessPair =
    !candidate.faceSigs?.length && window.every((p) => !p.faceSigs?.length);
  const semanticThreshold = facelessPair
    ? Math.max(tier.minCosine, LANDSCAPE_MIN_COSINE)
    : tier.minCosine;

  // איחוד: טביעות קרובות, או דמיון סמנטי גבוה למדרגה, או אותו אדם + סצנה סבירה
  const hashMatch = minDistance <= tier.maxDistance;
  const semanticMatch = maxCosine >= semanticThreshold;
  // אותו אדם מזוהה בוודאות — מקילים על סף הסצנה (זום/זווית שונים של אותו רגע)
  const identityMatch = sameIdentity && maxCosine >= tier.minCosine - 0.08;
  // אותו נושא בולט (נופים) — ערוץ איחוד נוסף, שלב א': מחבר בלבד
  const subjectMatch = maxSubjectCosine >= SUBJECT_MATCH_COSINE;
  // ראיות משולבות (נופים): שני אותות בינוניים שמסכימים
  const combinedMatch =
    facelessPair &&
    maxCosine >= COMBINED_MIN_COSINE &&
    minDistance <= tier.maxDistance + COMBINED_DISTANCE_SLACK;
  return hashMatch || semanticMatch || identityMatch || subjectMatch || combinedMatch;
}

/**
 * מקבץ תמונות (ממוינות לפי זמן, בתוך יום אחד) לערימות של צילומי רצף:
 * תמונה מצטרפת לערימה אם היא דומה לתמונה האחרונה בה — גם ויזואלית וגם בזמן.
 * ה-cover הוא האמצעית ברצף (קירוב סביר לצילום המוצלח; חדות אמיתית — בשלב עתידי).
 */
/** יומן אבחון לכיול הקיבוץ — מרחקים ופערי זמן בין תמונות עוקבות (קונסול, dev בלבד) */
function debugLogDistances(photos: PhotoRecord[]): void {
  if (!import.meta.env.DEV || photos.length < 2) return;
  const rows = photos.slice(1).map((photo, i) => {
    const prev = photos[i];
    const gapSec =
      photo.takenAt !== null && prev.takenAt !== null
        ? Math.round((photo.takenAt - prev.takenAt) / 1000)
        : null;
    return {
      photo: photo.name,
      'gap(sec)': gapSec,
      dFull: prev.phash && photo.phash ? hammingDistance(prev.phash, photo.phash) : null,
      dCenter:
        prev.phashCenter && photo.phashCenter
          ? hammingDistance(prev.phashCenter, photo.phashCenter)
          : null,
      faces: photo.faceSigs?.length ?? 0,
      subjCos:
        prev.subjectSig?.length && photo.subjectSig?.length
          ? Number(cosineSimilarity(prev.subjectSig, photo.subjectSig).toFixed(3))
          : null,
      faceSim:
        prev.faceSigs?.length && photo.faceSigs?.length
          ? Number(
              Math.max(
                ...prev.faceSigs.flatMap((a) => photo.faceSigs.map((b) => faceCosine(a, b))),
              ).toFixed(3),
            )
          : null,
    };
  });
  console.groupCollapsed(`[stacks] ניתוח דמיון — ${photos.length} תמונות`);
  console.table(rows);
  console.groupEnd();
}

export function buildStacks(photos: PhotoRecord[]): PhotoStack[] {
  debugLogDistances(photos);
  // אשכולות זהות לכל היום — הבסיס לוטו "אנשים שונים"
  const clusters = clusterIdentities(photos);
  if (import.meta.env.DEV && clusters.byPhoto.size > 0) {
    console.debug(
      '[stacks] אשכולות זהות:',
      [...clusters.byPhoto.entries()]
        .map(([id, set]) => `${id.split('/').pop()}→[${[...set]}]`)
        .join(' '),
    );
  }
  const stacks: PhotoStack[] = [];
  let current: PhotoRecord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    // המייצגת: ציון מוצלחוּת מלא (עם חוקי האמינות), נסיגה לחדות כשאין ציונים
    stacks.push({ id: current[0].id, photos: current, cover: pickBest(current) });
    current = [];
  };

  for (const photo of photos) {
    if (current.length > 0 && belongsToStack(current, photo, clusters)) {
      current.push(photo);
    } else {
      flush();
      current = [photo];
    }
  }
  flush();

  return mergeInterruptedStacks(stacks, clusters);
}

/** כמה ערימות אחורה בודקים במיזוג — כמה צילומים מפריעים באמצע לא מפצלים סצנה */
const MERGE_LOOKAHEAD = 5;

/**
 * מעבר שני: מיזוג ערימות של אותה סצנה שהופרדו על ידי צילום ביניים
 * (למשל: פנורמה → תמונה של חבר → שוב אותה פנורמה).
 */
function mergeInterruptedStacks(
  stacks: PhotoStack[],
  clusters: PersonClusters,
): PhotoStack[] {
  const merged: PhotoStack[] = [];

  for (const stack of stacks) {
    let absorbed = false;
    // מנסים לצרף לאחת מהערימות האחרונות שכבר נאספו
    for (let back = 1; back <= MERGE_LOOKAHEAD && back <= merged.length; back++) {
      const target = merged[merged.length - back];
      if (
        belongsToStack(target.photos, stack.photos[0], clusters) ||
        (stack.cover !== stack.photos[0] &&
          belongsToStack(target.photos, stack.cover, clusters))
      ) {
        target.photos.push(...stack.photos);
        target.cover = pickBest(target.photos);
        absorbed = true;
        break;
      }
    }
    if (!absorbed) merged.push(stack);
  }

  return merged;
}
