import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { setDecision, type PhotoRecord } from '../lib/db';
import type { AlbumLayout, AlbumPage, SlotRef } from '../lib/album';
import { swapSlots, changeTemplate, removePhotoFromPage } from '../lib/layoutEngine';
import { getTemplate, generalTemplates } from '../lib/templates';
import { useObjectUrl } from '../lib/useObjectUrl';
import { getSettings, saveSettings, type AlbumSettings } from '../lib/settings';
import type { ExportProgress } from '../lib/exportPdf';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import './Album.css';

interface AlbumProps {
  layout: AlbumLayout;
  photosById: Map<string, PhotoRecord>;
  onBack: () => void;
  onLayoutChange: (layout: AlbumLayout) => void;
  onRebuild: () => void;
}

/** תמונה בתוך משבצת עמוד */
function SlotImage({ photo }: { photo: PhotoRecord }) {
  const url = useObjectUrl(photo.preview);
  return url ? <img src={url} alt="" draggable={false} /> : null;
}

/** תמונה מוקטנת לרצועת העמודים */
function StripThumb({ photo }: { photo: PhotoRecord }) {
  const url = useObjectUrl(photo.thumbnail);
  return url ? <img src={url} alt="" loading="lazy" draggable={false} /> : null;
}

/**
 * רינדור עמוד אלבום: תבנית + שיבוצים → מיקום מוחלט לפי המלבנים היחסיים.
 * אותה קומפוננטה תשמש בעתיד את יצוא ה-PDF ואת העורך הידני.
 */
export function PageView({
  page,
  photosById,
  editMode = false,
  selectedSlot = null,
  onSlotClick,
  onRemovePhoto,
  onRemoveBackground,
}: {
  page: AlbumPage;
  photosById: Map<string, PhotoRecord>;
  editMode?: boolean;
  selectedSlot?: SlotRef | null;
  onSlotClick?: (ref: SlotRef) => void;
  onRemovePhoto?: (pageId: string, photoId: string) => void;
  onRemoveBackground?: (pageId: string) => void;
}) {
  const template = getTemplate(page.templateId);
  const bgPhoto = page.backgroundPhotoId ? photosById.get(page.backgroundPhotoId) : undefined;
  return (
    <div className="album-page">
      {bgPhoto && (
        <div className="album-page-bg">
          <SlotImage photo={bgPhoto} />
          <div className="album-page-bg-veil" />
        </div>
      )}
      {editMode && bgPhoto && onRemoveBackground && (
        <button
          className="album-bg-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveBackground(page.id);
          }}
        >
          ✕ רקע
        </button>
      )}
      {page.dayTitle && <div className="album-page-day-title">{page.dayTitle}</div>}
      {template.slots.map((slot, i) => {
        const photo = photosById.get(page.slots[i]?.photoId ?? '');
        if (!photo) return null;
        const isSelected =
          selectedSlot?.pageId === page.id && selectedSlot.slotIndex === i;
        return (
          <div
            key={i}
            className={`album-slot${editMode ? ' album-slot-editable' : ''}${isSelected ? ' album-slot-selected' : ''}`}
            style={{
              insetInlineStart: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.w * 100}%`,
              height: `${slot.h * 100}%`,
            }}
            onClick={editMode ? () => onSlotClick?.({ pageId: page.id, slotIndex: i }) : undefined}
          >
            <SlotImage photo={photo} />
            {editMode && onRemovePhoto && (
              <button
                className="album-slot-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemovePhoto(page.id, photo.id);
                }}
                aria-label="✕"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** צ'יפ תבנית — תצוגה סכמטית מוקטנת של מלבני התבנית */
function TemplateChip({
  templateId,
  active,
  onClick,
}: {
  templateId: string;
  active: boolean;
  onClick: () => void;
}) {
  const template = getTemplate(templateId);
  return (
    <button
      className={`template-chip${active ? ' template-chip-active' : ''}`}
      onClick={onClick}
      title={templateId}
    >
      {template.slots.map((slot, i) => (
        <span
          key={i}
          className="template-chip-rect"
          style={{
            insetInlineStart: `${slot.x * 100}%`,
            top: `${slot.y * 100}%`,
            width: `${slot.w * 100}%`,
            height: `${slot.h * 100}%`,
          }}
        />
      ))}
    </button>
  );
}

export function Album({ layout, photosById, onBack, onLayoutChange, onRebuild }: AlbumProps) {
  const t = useT();
  const pages = layout.pages;

  // תצוגת כפולה במסך רחב, עמוד בודד בצר
  const [singlePageMode, setSinglePageMode] = useState(
    () => window.innerWidth < 760,
  );
  useEffect(() => {
    const onResize = () => setSinglePageMode(window.innerWidth < 760);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const step = singlePageMode ? 1 : 2;
  const [spreadStart, setSpreadStart] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AlbumSettings>(getSettings);

  const applySettings = useCallback(
    (next: AlbumSettings) => {
      const layoutChanged = next.sceneryAsBackgrounds !== settings.sceneryAsBackgrounds;
      setSettings(next);
      saveSettings(next);
      // בנייה מחדש רק כשההגדרה משפיעה על העימוד (תקציב לא דורס עריכות)
      if (layoutChanged) onRebuild();
    },
    [onRebuild, settings],
  );

  const [editMode, setEditMode] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SlotRef | null>(null);

  const handleSlotClick = useCallback(
    (ref: SlotRef) => {
      if (!selectedSlot) {
        setSelectedSlot(ref);
        return;
      }
      if (selectedSlot.pageId === ref.pageId && selectedSlot.slotIndex === ref.slotIndex) {
        setSelectedSlot(null); // ביטול בחירה
        return;
      }
      onLayoutChange(swapSlots(layout, selectedSlot, ref));
      setSelectedSlot(null);
    },
    [selectedSlot, layout, onLayoutChange],
  );

  const handleRemovePhoto = useCallback(
    async (pageId: string, photoId: string) => {
      if (!window.confirm(t.removePhotoConfirm)) return;
      // עקביות עם הסווייפ: התמונה נדחית ב-DB (וה-fingerprint יתעדכן בשמירה)
      await setDecision(photoId, 'reject');
      const photo = photosById.get(photoId);
      if (photo) photo.decision = 'reject';
      onLayoutChange(removePhotoFromPage(layout, pageId, photoId, photosById));
      setSelectedSlot(null);
    },
    [layout, photosById, onLayoutChange, t],
  );

  const handleRemoveBackground = useCallback(
    (pageId: string) => {
      onLayoutChange({
        pages: layout.pages.map((p) =>
          p.id === pageId ? { ...p, backgroundPhotoId: undefined } : p,
        ),
      });
    },
    [layout, onLayoutChange],
  );

  const handleRebuildClick = useCallback(() => {
    if (window.confirm(t.rebuildConfirm)) {
      setSelectedSlot(null);
      onRebuild();
    }
  }, [onRebuild, t]);

  const [exportState, setExportState] = useState<
    | { phase: 'idle' }
    | { phase: 'working'; progress: ExportProgress }
    | { phase: 'done'; usedFallback: boolean }
  >({ phase: 'idle' });

  const handleExport = useCallback(async () => {
    if (exportState.phase === 'working') return;
    setExportState({ phase: 'working', progress: { page: 0, totalPages: pages.length } });
    try {
      // טעינה עצלה — pdf-lib נטען רק כשמייצאים
      const { exportAlbumToPdf, downloadPdf } = await import('../lib/exportPdf');
      const result = await exportAlbumToPdf(layout, photosById, (progress) => {
        setExportState({ phase: 'working', progress });
      });
      downloadPdf(result.blob);
      setExportState({ phase: 'done', usedFallback: result.usedFallback });
    } catch (err) {
      console.error('PDF export failed', err);
      setExportState({ phase: 'idle' });
    }
  }, [exportState.phase, layout, photosById, pages.length]);
  const [slideDirection, setSlideDirection] = useState<'next' | 'prev' | null>(null);
  const touchStartX = useRef<number | null>(null);

  const maxStart = Math.max(0, Math.ceil((pages.length - step) / step) * step);

  const go = useCallback(
    (direction: 'next' | 'prev') => {
      setSpreadStart((s) => {
        const next = direction === 'next' ? s + step : s - step;
        if (next < 0 || next > maxStart || next >= pages.length) return s;
        setSlideDirection(direction);
        return next;
      });
    },
    [step, maxStart, pages.length],
  );

  // איפוס אנימציית הכניסה אחרי שהסתיימה
  useEffect(() => {
    if (!slideDirection) return;
    const timer = window.setTimeout(() => setSlideDirection(null), 350);
    return () => window.clearTimeout(timer);
  }, [slideDirection, spreadStart]);

  // מקלדת — חצים בכיוון דפדוף טבעי לעברית: שמאלה=קדימה
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go('next');
      else if (e.key === 'ArrowRight') go('prev');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // סווייפ מגע אופקי
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 60) return;
    // בעברית: גרירה ימינה = קדימה (כמו הפיכת דף באלבום עברי)
    go(dx > 0 ? 'next' : 'prev');
  };

  const visible = pages.slice(spreadStart, spreadStart + step);
  const currentSpreadIndex = Math.floor(spreadStart / step);
  const totalSpreads = Math.ceil(pages.length / step);

  const spreadLabel = useMemo(() => {
    if (pages.length === 0) return '';
    const first = spreadStart + 1;
    const last = Math.min(spreadStart + step, pages.length);
    return t.albumPageOf(first === last ? first : last, pages.length);
  }, [spreadStart, step, pages.length, t]);

  if (pages.length === 0) {
    return (
      <div className="screen album">
        <header className="album-header">
          <button className="btn-ghost" onClick={onBack}>
            {t.back}
          </button>
          <h1 className="album-title">{t.albumTitle}</h1>
          <ThemeSwitcher />
        </header>
        <div className="album-empty">{t.albumEmpty}</div>
      </div>
    );
  }

  return (
    <div className="screen album">
      <header className="album-header">
        <button className="btn-ghost" onClick={onBack}>
          {t.back}
        </button>
        <div className="album-header-center">
          <h1 className="album-title">{t.albumTitle}</h1>
          <span className="album-page-counter">{spreadLabel}</span>
        </div>
        <div className="album-header-actions">
          {editMode && (
            <button className="btn-ghost" onClick={handleRebuildClick}>
              {t.rebuildAlbum}
            </button>
          )}
          <button
            className={editMode ? 'btn-primary album-export-btn' : 'btn-ghost'}
            onClick={() => {
              setEditMode((e) => !e);
              setSelectedSlot(null);
            }}
          >
            {editMode ? t.editDone : t.editMode}
          </button>
          {!editMode && (
            <button className="btn-primary album-export-btn" onClick={handleExport}>
              {t.exportPdf}
            </button>
          )}
          <button
            className="btn-ghost album-settings-btn"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label={t.settingsTitle}
            title={t.settingsTitle}
          >
            ⚙
          </button>
          <ThemeSwitcher />
        </div>
      </header>

      <div className="album-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button
          className="album-nav album-nav-prev"
          onClick={() => go('prev')}
          disabled={spreadStart === 0}
          aria-label={t.back}
        >
          ›
        </button>

        <div
          key={spreadStart}
          className={`album-spread${slideDirection ? ` slide-${slideDirection}` : ''}`}
        >
          {visible.map((page) => (
            <PageView
              key={page.id}
              page={page}
              photosById={photosById}
              editMode={editMode}
              selectedSlot={selectedSlot}
              onSlotClick={handleSlotClick}
              onRemovePhoto={handleRemovePhoto}
              onRemoveBackground={handleRemoveBackground}
            />
          ))}
          {!singlePageMode && visible.length === 2 && <div className="album-spine" />}
        </div>

        <button
          className="album-nav album-nav-next"
          onClick={() => go('next')}
          disabled={spreadStart >= maxStart || spreadStart + step >= pages.length}
          aria-label=""
        >
          ‹
        </button>
      </div>

      {settingsOpen && (
        <div className="album-settings-panel">
          <span className="album-settings-title">{t.settingsTitle}</span>
          <label className="album-settings-row">
            <input
              type="checkbox"
              checked={settings.sceneryAsBackgrounds}
              onChange={(e) =>
                applySettings({ ...settings, sceneryAsBackgrounds: e.target.checked })
              }
            />
            {t.settingsSceneryBg}
          </label>
          <label className="album-settings-row">
            {t.settingsTargetPages}
            <input
              type="number"
              min={4}
              max={200}
              placeholder="—"
              value={settings.targetPages ?? ''}
              onChange={(e) =>
                applySettings({
                  ...settings,
                  targetPages: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <span className="album-settings-note">{t.settingsRebuildNote}</span>
        </div>
      )}

      {editMode && (
        <div className="album-edit-bar">
          <p className="album-edit-hint">{t.editHint}</p>
          <div className="album-edit-templates">
            {visible
              .filter((page) => !getTemplate(page.templateId).role)
              .map((page) => (
                <div key={page.id} className="album-template-group">
                  <span className="album-template-label">
                    {t.pageNumber(layout.pages.indexOf(page) + 1)}
                  </span>
                  <div className="album-template-row">
                    {generalTemplates(page.slots.length).map((option) => (
                      <TemplateChip
                        key={option.id}
                        templateId={option.id}
                        active={option.id === page.templateId}
                        onClick={() => onLayoutChange(changeTemplate(layout, page.id, option.id))}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {exportState.phase !== 'idle' && (
        <div className="export-overlay">
          <div className="export-modal">
            {exportState.phase === 'working' ? (
              <>
                <div className="export-spinner" aria-hidden />
                <h2 className="export-title">{t.exportingTitle}</h2>
                <p className="export-progress-text">
                  {t.exportingPage(exportState.progress.page, exportState.progress.totalPages)}
                </p>
                <div className="export-progress-bar">
                  <div
                    className="export-progress-fill"
                    style={{
                      width: `${(exportState.progress.page / Math.max(1, exportState.progress.totalPages)) * 100}%`,
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="export-done-emoji" aria-hidden>📖</div>
                <h2 className="export-title">{t.exportDone}</h2>
                {exportState.usedFallback && (
                  <p className="export-warning">{t.exportFallbackWarning}</p>
                )}
                <button
                  className="btn-primary"
                  onClick={() => setExportState({ phase: 'idle' })}
                >
                  {t.exportClose}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="album-strip">
        {Array.from({ length: totalSpreads }, (_, i) => {
          const page = pages[i * step];
          const coverPhoto = photosById.get(page.slots[0]?.photoId ?? '');
          return (
            <button
              key={page.id}
              className={`album-strip-item${i === currentSpreadIndex ? ' album-strip-active' : ''}`}
              onClick={() => {
                setSlideDirection(i > currentSpreadIndex ? 'next' : 'prev');
                setSpreadStart(i * step);
              }}
            >
              {coverPhoto && <StripThumb photo={coverPhoto} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
