/**
 * נתיב לנכס סטטי (מודלים וכו') שמכבד את בסיס הפריסה —
 * עובד גם ב-localhost (בסיס '/') וגם ב-GitHub Pages (בסיס '/Click2Album/').
 */
export function assetUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}
