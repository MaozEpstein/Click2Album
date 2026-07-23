import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AlbumLayout } from './album';
import type { QualityFlag } from './quality';

/** החלטת המשתמש על תמונה בסווייפ */
export type Decision = 'keep' | 'reject' | 'favorite';

/** רשומת תמונה כפי שנשמרת ב-IndexedDB — מטא-דאטה + נגזרות בלבד */
export interface PhotoRecord {
  id: string;
  name: string;
  takenAt: number | null;
  hasExif: boolean;
  width: number;
  height: number;
  thumbnail: Blob;
  preview: Blob;
  /** perceptual hash לזיהוי כמעט-כפולות */
  phash: string;
  /** hash של הריבוע המרכזי — עמיד להבדלי מסגור/זום ('' בסריקות ישנות) */
  phashCenter: string;
  decision: Decision | null;
  /** מדדי איכות (0 = לא נמדד, סריקות ישנות) */
  sharpness: number;
  brightness: number;
  /** חשדות הגלאים — הצעות למסך הניקוי */
  flags: QualityFlag[];
  /** סוננה במסך הניקוי — לא מוצגת בסווייפ/ימים/אלבום */
  filtered: boolean;
  /** מספר פנים שזוהו; null = טרם סווג. 0=נוף/רקע, 1=אדם, 2+=קבוצה */
  faceCount: number | null;
  /** חתימת צבע (12 גוונים + בהירות) — וטו בקיבוץ; [] בסריקות ישנות */
  colorSig: number[];
  /** חתימות זהות פנים (descriptor 128 לכל פנים דומיננטיות) — וטו זהות בקיבוץ */
  faceSigs: number[][];
  /** וקטור דמיון סמנטי (MobileNet, מנורמל); null = טרם חושב */
  embedding: number[] | null;
  /** ציון "המוצלחת ביותר" 0-100 (NIMA+הבעות+חדות); null = טרם דורג */
  bestShotScore: number | null;
  /** זוהתה עין עצומה/מצמוץ — וטו בבחירת המייצגת */
  hasClosedEyes: boolean;
  /** חתימת הנושא הבולט (נופים): null=טרם נבדק, []=אין נושא מובהק, אחרת חתימה */
  subjectSig: number[] | null;
}

/** מצב הפרויקט הפעיל — הבסיס לשמירה רציפה של התקדמות */
export interface ProjectState {
  id: 'current';
  createdAt: number;
  scanCompleted: boolean;
}

/** handle של תיקיית המקור — לקריאת הקבצים המקוריים ביצוא PDF */
export interface SourceRecord {
  id: 'current';
  handle: FileSystemDirectoryHandle;
}

/** האלבום השמור — כולל עריכות ידניות */
export interface AlbumRecord {
  id: 'current';
  layout: AlbumLayout;
  /** טביעת אצבע של סט התמונות הנבחרות — לזיהוי שינויי בחירה מאז השמירה */
  selectionFingerprint: string;
}

interface Click2AlbumDB extends DBSchema {
  photos: {
    key: string;
    value: PhotoRecord;
    indexes: { 'by-takenAt': number };
  };
  project: {
    key: string;
    value: ProjectState;
  };
  source: {
    key: string;
    value: SourceRecord;
  };
  album: {
    key: string;
    value: AlbumRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<Click2AlbumDB>> | null = null;
let dbName = 'click2album';

/** מעבר פרויקט: סוגר את החיבור הנוכחי ופותח את מסד הפרויקט החדש */
export function resetDbConnection(newDbName: string): void {
  if (newDbName === dbName && dbPromise) return;
  dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  dbName = newDbName;
}

function getDB(): Promise<IDBPDatabase<Click2AlbumDB>> {
  dbPromise ??= openDB<Click2AlbumDB>(dbName, 22, {
    upgrade(db, oldVersion, _newVersion, tx) {
      // עד גרסה 3 שינויי הסכימה דרשו סריקה מחדש; מגרסה 3 והלאה משמרים נתונים
      if (oldVersion < 3) {
        if (db.objectStoreNames.contains('photos')) db.deleteObjectStore('photos');
        if (db.objectStoreNames.contains('project')) db.deleteObjectStore('project');
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('by-takenAt', 'takenAt');
        db.createObjectStore('project', { keyPath: 'id' });
      }
      if (oldVersion < 4) {
        db.createObjectStore('source', { keyPath: 'id' });
      }
      if (oldVersion < 5) {
        db.createObjectStore('album', { keyPath: 'id' });
      }
      if (oldVersion >= 3 && oldVersion < 22) {
        // מיגרציה: רשומות קיימות מקבלות ערכי ברירת מחדל (בלי דגלים)
        tx.objectStore('photos')
          .openCursor()
          .then(function fill(cursor): Promise<unknown> | void {
            if (!cursor) return;
            const record = cursor.value as PhotoRecord;
            record.sharpness ??= 0;
            record.brightness ??= 0;
            record.flags ??= [];
            record.filtered ??= false;
            record.faceCount ??= null;
            record.phashCenter ??= '';
            record.colorSig ??= [];
            record.embedding ??= null;
            if (oldVersion < 18) {
              // עד v18: מנוע זהות ArcFace — איפוס לניתוח מחדש ברקע
              record.faceSigs = [];
              record.faceCount = null;
            }
            if (oldVersion < 21) {
              // v21: כיול דירוג (מצמוץ-חיוך, פנים קטנות, בונוס) — חישוב מחדש
              record.bestShotScore = null;
              record.hasClosedEyes = false;
            }
            // v22: חתימת נושא בולט — שדה חדש בלבד
            record.subjectSig ??= null;
            cursor.update(record);
            return cursor.continue().then(fill);
          });
      }
    },
  });
  return dbPromise;
}

export async function savePhoto(record: PhotoRecord): Promise<void> {
  const db = await getDB();
  await db.put('photos', record);
}

export async function getAllPhotos(): Promise<PhotoRecord[]> {
  const db = await getDB();
  return db.getAll('photos');
}

/** שמירת החלטת סווייפ — נקראת על כל סווייפ, מיידית */
export async function setDecision(id: string, decision: Decision | null): Promise<void> {
  const db = await getDB();
  const record = await db.get('photos', id);
  if (!record) return;
  record.decision = decision;
  await db.put('photos', record);
}

export async function getProjectState(): Promise<ProjectState | undefined> {
  const db = await getDB();
  return db.get('project', 'current');
}

export async function saveProjectState(state: ProjectState): Promise<void> {
  const db = await getDB();
  await db.put('project', state);
}

export async function saveSourceHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await getDB();
  await db.put('source', { id: 'current', handle });
}

export async function getSourceHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await getDB();
  const record = await db.get('source', 'current');
  return record?.handle ?? null;
}

/** שמירת חתימת נושא בולט */
export async function setSubjectSig(id: string, subjectSig: number[]): Promise<void> {
  const db = await getDB();
  const record = await db.get('photos', id);
  if (!record) return;
  record.subjectSig = subjectSig;
  await db.put('photos', record);
}

/** שמירת ציון מוצלחוּת */
export async function setBestShot(
  id: string,
  score: number,
  hasClosedEyes: boolean,
): Promise<void> {
  const db = await getDB();
  const record = await db.get('photos', id);
  if (!record) return;
  record.bestShotScore = score;
  record.hasClosedEyes = hasClosedEyes;
  await db.put('photos', record);
}

/** שמירת וקטור דמיון סמנטי */
export async function setEmbedding(id: string, embedding: number[]): Promise<void> {
  const db = await getDB();
  const record = await db.get('photos', id);
  if (!record) return;
  record.embedding = embedding;
  await db.put('photos', record);
}

/** שמירת תוצאת ניתוח פנים: ספירה + חתימות זהות */
export async function setFaceData(
  id: string,
  faceCount: number,
  faceSigs: number[][],
): Promise<void> {
  const db = await getDB();
  const record = await db.get('photos', id);
  if (!record) return;
  record.faceCount = faceCount;
  record.faceSigs = faceSigs;
  await db.put('photos', record);
}

/** סימון/ביטול סינון בכמות — ממסך הניקוי */
export async function setFilteredBulk(ids: string[], filtered: boolean): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('photos', 'readwrite');
  for (const id of ids) {
    const record = await tx.store.get(id);
    if (record) {
      record.filtered = filtered;
      await tx.store.put(record);
    }
  }
  await tx.done;
}

export async function saveAlbumLayout(
  layout: AlbumLayout,
  selectionFingerprint: string,
): Promise<void> {
  const db = await getDB();
  await db.put('album', { id: 'current', layout, selectionFingerprint });
}

export async function getSavedAlbum(): Promise<AlbumRecord | undefined> {
  const db = await getDB();
  return db.get('album', 'current');
}

export async function clearAlbum(): Promise<void> {
  const db = await getDB();
  await db.clear('album');
}

/** מוחק את כל נתוני הפרויקט — לתחילת פרויקט חדש */
export async function clearProject(): Promise<void> {
  const db = await getDB();
  await db.clear('photos');
  await db.clear('project');
  await db.clear('source');
  await db.clear('album');
}
