import type { PhotoSource, SourcePhotoFile } from './types';

// השלמת טיפוס שחסר ב-lib.dom של TypeScript: איטרציה על תוכן תיקייה
interface IterableDirectoryHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif',
]);

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext !== undefined && IMAGE_EXTENSIONS.has(ext);
}

/** מקור תיקייה מקומית מבוסס File System Access API (Chrome / Edge) */
class DirectoryHandleSource implements PhotoSource {
  readonly kind = 'local-folder' as const;

  constructor(private root: FileSystemDirectoryHandle) {}

  async *listPhotos(): AsyncGenerator<SourcePhotoFile> {
    yield* this.walk(this.root, '');
  }

  private async *walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
  ): AsyncGenerator<SourcePhotoFile> {
    for await (const entry of (dir as IterableDirectoryHandle).values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        yield* this.walk(entry as FileSystemDirectoryHandle, path);
      } else if (isImageFile(entry.name)) {
        const file = await (entry as FileSystemFileHandle).getFile();
        yield { id: path, name: entry.name, file };
      }
    }
  }
}

/** Fallback לדפדפנים ללא File System Access API — <input webkitdirectory> */
class FileListSource implements PhotoSource {
  readonly kind = 'local-folder' as const;

  constructor(private files: File[]) {}

  async *listPhotos(): AsyncGenerator<SourcePhotoFile> {
    for (const file of this.files) {
      if (!isImageFile(file.name)) continue;
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      yield { id: path, name: file.name, file };
    }
  }
}

export interface PickedFolder {
  source: PhotoSource;
  /** קיים רק ב-File System Access API — נשמר ליצוא באיכות מקור */
  handle: FileSystemDirectoryHandle | null;
}

/**
 * פותח דיאלוג בחירת תיקייה ומחזיר PhotoSource + handle (אם נתמך).
 * מחזיר null אם המשתמש ביטל.
 */
export async function pickLocalFolder(): Promise<PickedFolder | null> {
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await (window as unknown as {
        showDirectoryPicker(options?: { mode?: string }): Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ mode: 'read' });
      return { source: new DirectoryHandleSource(handle), handle };
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return null;
      throw err;
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      resolve(files.length ? { source: new FileListSource(files), handle: null } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

interface PermissionCapableHandle extends FileSystemDirectoryHandle {
  queryPermission(desc: { mode: string }): Promise<PermissionState>;
  requestPermission(desc: { mode: string }): Promise<PermissionState>;
}

/** מוודא הרשאת קריאה על ה-handle (פרומפט דפדפן אם צריך) */
export async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as PermissionCapableHandle;
  if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true;
  return (await h.requestPermission({ mode: 'read' })) === 'granted';
}

/**
 * קורא קובץ מקור לפי הנתיב היחסי (ה-id של התמונה).
 * מחזיר null אם הקובץ הוזז/נמחק.
 */
export async function getOriginalFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<File | null> {
  try {
    const parts = relativePath.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part);
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}
