/** הגדרות האלבום — נשמרות ב-localStorage ומשפיעות על העימוד */

export interface AlbumSettings {
  /** נופים שנבחרו משמשים כרקעי עמודים (מתחת לתמונות האנשים) */
  sceneryAsBackgrounds: boolean;
  /** יעד עמודים לאלבום; null = ללא תקציב */
  targetPages: number | null;
}

import { getActiveProjectId } from './projects';

/** הגדרות פר-פרויקט — כל אלבום עם ההעדפות שלו */
function storageKey(): string {
  const id = getActiveProjectId();
  return id ? `click2album-settings-${id}` : 'click2album-settings';
}

const DEFAULTS: AlbumSettings = {
  sceneryAsBackgrounds: true,
  targetPages: null,
};

export function getSettings(): AlbumSettings {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AlbumSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: AlbumSettings): void {
  localStorage.setItem(storageKey(), JSON.stringify(settings));
}

/** מזהה ייחודי של ההגדרות המשפיעות על העימוד — חלק מ-fingerprint האלבום */
export function layoutSettingsKey(settings: AlbumSettings): string {
  return `scenery:${settings.sceneryAsBackgrounds ? 1 : 0}`;
}
