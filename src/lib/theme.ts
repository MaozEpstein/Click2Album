/** מערכת ערכות נושא — הבחירה נשמרת ב-localStorage ומוחלת כ-data-theme על ה-root */

export const THEMES = ['night', 'ocean', 'cream', 'mist'] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = 'click2album-theme';
const DEFAULT_THEME: Theme = 'night';

/** צבע ייצוגי לכל ערכה — לעיגולי הבחירה בבורר */
export const THEME_SWATCHES: Record<Theme, string> = {
  night: 'linear-gradient(135deg, #0f1117 40%, #7c6cf6)',
  ocean: 'linear-gradient(135deg, #0a141d 40%, #2dd4bf)',
  cream: 'linear-gradient(135deg, #f3efe7 40%, #c2703d)',
  mist: 'linear-gradient(135deg, #e9edf3 40%, #5b74d6)',
};

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(stored as Theme) ? (stored as Theme) : DEFAULT_THEME;
}

export function applyTheme(theme: Theme): void {
  if (theme === DEFAULT_THEME) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem(STORAGE_KEY, theme);
}

/** מחיל את הערכה השמורה — נקרא פעם אחת בעליית האפליקציה */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}
