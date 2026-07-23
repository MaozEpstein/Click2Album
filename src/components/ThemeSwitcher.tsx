import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { applyTheme, getStoredTheme, THEMES, THEME_SWATCHES, type Theme } from '../lib/theme';
import './ThemeSwitcher.css';

export function ThemeSwitcher() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const rootRef = useRef<HTMLDivElement>(null);

  // סגירה בלחיצה מחוץ לבורר
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const select = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
    setOpen(false);
  };

  return (
    <div className="theme-switcher" ref={rootRef}>
      <button
        className="theme-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label={t.themeTitle}
        title={t.themeTitle}
      >
        <span className="theme-trigger-swatch" style={{ background: THEME_SWATCHES[theme] }} />
      </button>

      {open && (
        <div className="theme-popover">
          <span className="theme-popover-title">{t.themeTitle}</span>
          <div className="theme-options">
            {THEMES.map((option) => (
              <button
                key={option}
                className={`theme-option${option === theme ? ' theme-option-active' : ''}`}
                onClick={() => select(option)}
              >
                <span
                  className="theme-option-swatch"
                  style={{ background: THEME_SWATCHES[option] }}
                />
                <span className="theme-option-name">{t.themeNames[option]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
