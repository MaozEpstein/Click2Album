import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * ניהול ריבוי פרויקטים: מסד אינדקס קטן + מסד IndexedDB נפרד לכל פרויקט.
 * הפרויקט הוותיק (מלפני הפיצ'ר) נשאר במסד המקורי — נרשם באינדקס בלי להזיז ביט.
 */

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  lastOpenedAt: number;
  photoCount: number;
  coverThumb: Blob | null;
  /** בארכיון מאז (מחיקה רכה); null/חסר = פעיל. נמחק לצמיתות אחרי 30 יום */
  archivedAt?: number | null;
}

/** משך השהות בארכיון לפני מחיקה סופית אוטומטית */
export const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface ProjectsIndexDB extends DBSchema {
  projects: {
    key: string;
    value: ProjectMeta;
  };
}

const INDEX_DB = 'click2album-index';
/** המסד ההיסטורי מלפני ריבוי הפרויקטים */
const LEGACY_DB = 'click2album';
const LEGACY_ID = 'legacy';
const ACTIVE_KEY = 'click2album-active-project';

let indexDbPromise: Promise<IDBPDatabase<ProjectsIndexDB>> | null = null;

function getIndexDB() {
  indexDbPromise ??= openDB<ProjectsIndexDB>(INDEX_DB, 1, {
    upgrade(db) {
      db.createObjectStore('projects', { keyPath: 'id' });
    },
  });
  return indexDbPromise;
}

/** שם מסד הנתונים של פרויקט */
export function projectDbName(id: string): string {
  return id === LEGACY_ID ? LEGACY_DB : `click2album-p-${id}`;
}

export function getActiveProjectId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveProjectId(id: string | null): void {
  if (id === null) localStorage.removeItem(ACTIVE_KEY);
  else localStorage.setItem(ACTIVE_KEY, id);
}

/**
 * הגירה חד-פעמית: אם קיים המסד הישן עם תמונות והוא לא רשום באינדקס —
 * נרשם כפרויקט הראשון. הנתונים לא מועתקים ולא נדרסים.
 */
async function migrateLegacyIfNeeded(): Promise<void> {
  const index = await getIndexDB();
  const existing = await index.get('projects', LEGACY_ID);
  if (existing) return;

  try {
    const databases = await indexedDB.databases?.();
    const legacyExists = databases?.some((d) => d.name === LEGACY_DB);
    if (!legacyExists) return;

    await index.put('projects', {
      id: LEGACY_ID,
      name: 'האלבום שלי',
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      photoCount: 0,
      coverThumb: null,
    });
    if (!getActiveProjectId()) setActiveProjectId(LEGACY_ID);
  } catch {
    // indexedDB.databases לא נתמך — נוותר על ההגירה האוטומטית
  }
}

/** ניקוי אוטומטי: פרויקטים שבארכיון מעל 30 יום נמחקים לצמיתות */
async function purgeExpiredArchive(): Promise<void> {
  const index = await getIndexDB();
  const all = await index.getAll('projects');
  const cutoff = Date.now() - ARCHIVE_RETENTION_MS;
  for (const p of all) {
    if (p.archivedAt && p.archivedAt < cutoff) {
      await deleteProject(p.id);
    }
  }
}

/** הפרויקטים הפעילים (לא בארכיון) */
export async function listProjects(): Promise<ProjectMeta[]> {
  await migrateLegacyIfNeeded();
  await purgeExpiredArchive();
  const index = await getIndexDB();
  const all = await index.getAll('projects');
  return all.filter((p) => !p.archivedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

/** הפרויקטים שבארכיון, מהחדש לישן */
export async function listArchivedProjects(): Promise<ProjectMeta[]> {
  const index = await getIndexDB();
  const all = await index.getAll('projects');
  return all
    .filter((p) => !!p.archivedAt)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
}

/** מחיקה רכה: הפרויקט עובר לארכיון (הנתונים נשמרים) */
export async function archiveProject(id: string): Promise<void> {
  const index = await getIndexDB();
  const meta = await index.get('projects', id);
  if (!meta) return;
  meta.archivedAt = Date.now();
  await index.put('projects', meta);
  if (getActiveProjectId() === id) setActiveProjectId(null);
}

/** שחזור מהארכיון חזרה לרשימת הפרויקטים */
export async function restoreProject(id: string): Promise<void> {
  const index = await getIndexDB();
  const meta = await index.get('projects', id);
  if (!meta) return;
  meta.archivedAt = null;
  meta.lastOpenedAt = Date.now();
  await index.put('projects', meta);
}

export async function createProject(name: string): Promise<ProjectMeta> {
  const index = await getIndexDB();
  const meta: ProjectMeta = {
    id: Math.random().toString(36).slice(2, 10),
    name,
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    photoCount: 0,
    coverThumb: null,
  };
  await index.put('projects', meta);
  return meta;
}

export async function openProject(id: string): Promise<void> {
  const index = await getIndexDB();
  const meta = await index.get('projects', id);
  if (meta) {
    meta.lastOpenedAt = Date.now();
    await index.put('projects', meta);
  }
  setActiveProjectId(id);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const index = await getIndexDB();
  const meta = await index.get('projects', id);
  if (!meta) return;
  meta.name = name;
  await index.put('projects', meta);
}

/** מחיקה סופית: מסד הפרויקט + הרשומה באינדקס. תמונות המקור בדיסק לא נגעו. */
export async function deleteProject(id: string): Promise<void> {
  const index = await getIndexDB();
  await index.delete('projects', id);
  localStorage.removeItem(`click2album-settings-${id}`);
  if (getActiveProjectId() === id) setActiveProjectId(null);
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(projectDbName(id));
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export async function updateProjectMeta(
  id: string,
  patch: Partial<Pick<ProjectMeta, 'photoCount' | 'coverThumb' | 'name'>>,
): Promise<void> {
  const index = await getIndexDB();
  const meta = await index.get('projects', id);
  if (!meta) return;
  Object.assign(meta, patch);
  await index.put('projects', meta);
}
