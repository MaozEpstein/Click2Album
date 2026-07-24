import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { setDecision, type Decision, type PhotoRecord } from '../lib/db';
import { formatDayTitle, type DayGroup } from '../lib/days';
import { buildStacks, getPersonClusters, type PhotoStack } from '../lib/stacks';
import { categoryOfPhoto, type PhotoCategory } from '../lib/faces';
import { useObjectUrl } from '../lib/useObjectUrl';
import './Swipe.css';

interface SwipeProps {
  day: DayGroup;
  /** יעד תמונות ליום זה (מהתקציב); null = בלי תקציב */
  budgetTarget: number | null;
  onBack: () => void;
}

/** מצב גרירה נוכחי של הקלף העליון */
interface DragState {
  dx: number;
  dy: number;
  dragging: boolean;
}

/** ההחלטה שהגרירה הנוכחית "מכוונת" אליה, אם עברה את הסף */
function decisionFromDrag(dx: number, dy: number, threshold: number): Decision | null {
  if (dy < -threshold && Math.abs(dy) > Math.abs(dx)) return 'favorite';
  if (dx > threshold) return 'keep';
  if (dx < -threshold) return 'reject';
  return null;
}

/** תמונה ברשת ההרחבה של ערימה */
function StackGridItem({
  photo,
  selected,
  recommended,
  onToggle,
}: {
  photo: PhotoRecord;
  selected: boolean;
  recommended: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  // preview מלא (1280px) — השוואה בין דומות דורשת פרטים, לא ממוזערת
  const url = useObjectUrl(photo.preview);
  return (
    <button
      className={`stack-grid-item${selected ? ' stack-grid-item-selected' : ''}`}
      onClick={onToggle}
    >
      {url && <img src={url} alt={photo.name} loading="lazy" />}
      {recommended && <span className="stack-recommended">{t.recommended}</span>}
      {import.meta.env.DEV && photo.bestShotScore !== null && (
        <span className="stack-score-debug" dir="ltr">
          {photo.bestShotScore}
          {photo.hasClosedEyes ? ' 😑' : ''}
        </span>
      )}
      <span className="stack-grid-check">{selected ? '✓' : ''}</span>
    </button>
  );
}

const galleryTimeFormatter = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** מידע ערימה עבור תמונה בגלריה */
interface GalleryStackInfo {
  size: number;
  /** גוון ייחודי לערימה — מסגרת צבעונית מבדילה בין ערימות סמוכות */
  hue: number;
}

/** תמונה בגלריית היום — כפתורי החלטה מהירים + תמיכה בבחירה מרובה */
function GalleryItem({
  photo,
  stackInfo,
  personLabel,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onDecide,
}: {
  photo: PhotoRecord;
  stackInfo: GalleryStackInfo | undefined;
  personLabel?: string;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDecide: (decision: Decision) => void;
}) {
  const url = useObjectUrl(photo.thumbnail);
  const decision = photo.decision;
  return (
    <div
      className={`gallery-item${selectMode ? ' gallery-item-selectable' : ''}${selected ? ' gallery-item-selected' : ''}`}
      style={stackInfo ? { borderColor: `hsl(${stackInfo.hue} 70% 55%)` } : undefined}
      onClick={selectMode ? onToggleSelect : onOpen}
      role="button"
    >
      {url && <img src={url} alt={photo.name} loading="lazy" />}
      {photo.takenAt !== null && (
        <span className="gallery-timestamp">
          {galleryTimeFormatter.format(photo.takenAt)}
        </span>
      )}
      {personLabel && <span className="gallery-person-badge">{personLabel}</span>}
      {/* זמני לבחינת מנוע הדירוג — יוסר לבקשת המשתמש */}
      {photo.bestShotScore !== null && (
        <span className="gallery-score-badge" dir="ltr">
          {photo.bestShotScore}
          {photo.hasClosedEyes ? ' 😑' : ''}
          {import.meta.env.DEV && photo.subjectSig && photo.subjectSig.length > 0 ? ' 🎯' : ''}
        </span>
      )}
      {decision && (
        <span className={`gallery-badge gallery-badge-${decision}`}>
          {decision === 'keep' ? '✓' : decision === 'favorite' ? '★' : '✕'}
        </span>
      )}
      {stackInfo && (
        <span
          className="gallery-stack-badge"
          style={{ background: `hsl(${stackInfo.hue} 70% 45%)` }}
        >
          ×{stackInfo.size}
        </span>
      )}
      {selectMode ? (
        <span className={`gallery-select-check${selected ? ' gallery-select-check-on' : ''}`}>
          {selected ? '✓' : ''}
        </span>
      ) : (
        <div className="gallery-actions">
          <button
            className="gallery-action gallery-action-keep"
            onClick={(e) => {
              e.stopPropagation();
              onDecide('keep');
            }}
            aria-label="✓"
          >
            ✓
          </button>
          <button
            className="gallery-action gallery-action-fav"
            onClick={(e) => {
              e.stopPropagation();
              onDecide('favorite');
            }}
            aria-label="★"
          >
            ★
          </button>
          <button
            className="gallery-action gallery-action-reject"
            onClick={(e) => {
              e.stopPropagation();
              onDecide('reject');
            }}
            aria-label="✕"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/** תצוגה גדולה של תמונה בודדת מהגלריה — עם פעולות החלטה */
function Lightbox({
  photo,
  onDecide,
  onPrev,
  onNext,
  onClose,
}: {
  photo: PhotoRecord;
  onDecide: (decision: Decision) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
}) {
  const t = useT();
  const url = useObjectUrl(photo.preview);
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        {url && <img src={url} alt={photo.name} />}
        {photo.takenAt !== null && (
          <span className="swipe-card-timestamp">
            {galleryTimeFormatter.format(photo.takenAt)}
          </span>
        )}
        {photo.decision && (
          <span className={`swipe-decided-badge decided-${photo.decision}`}>
            {photo.decision === 'keep'
              ? t.decidedKeep
              : photo.decision === 'favorite'
                ? t.decidedFavorite
                : t.decidedReject}
          </span>
        )}
      </div>
      {onPrev && (
        <button
          className="lightbox-nav lightbox-nav-prev"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
        >
          ›
        </button>
      )}
      {onNext && (
        <button
          className="lightbox-nav lightbox-nav-next"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
        >
          ‹
        </button>
      )}
      <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="swipe-btn swipe-btn-reject"
          onClick={() => onDecide('reject')}
          aria-label={t.swipeReject}
        >
          ✕
        </button>
        <button
          className="swipe-btn swipe-btn-fav"
          onClick={() => onDecide('favorite')}
          aria-label={t.swipeFavorite}
        >
          ★
        </button>
        <button
          className="swipe-btn swipe-btn-keep"
          onClick={() => onDecide('keep')}
          aria-label={t.swipeKeep}
        >
          ✓
        </button>
        <button className="btn-ghost" onClick={onClose}>
          {t.back}
        </button>
      </div>
    </div>
  );
}

/** מעבר חלק (View Transitions) כשנתמך; אחרת עדכון רגיל */
function withViewTransition(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
  if (doc.startViewTransition) doc.startViewTransition(update);
  else update();
}

/** קונפטי עדין לסיום יום — פתיתים דטרמיניסטיים (בלי random ברינדור) */
function Confetti() {
  const COLORS = ['#7c6cf6', '#c86cf6', '#f66cb1', '#fbbf24', '#4ade80'];
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            insetInlineStart: `${(i * 53) % 100}%`,
            background: COLORS[i % COLORS.length],
            animationDelay: `${(i % 6) * 90}ms`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}

const DRAG_THRESHOLD = 110;

/** מחליט האם ערימה כולה כבר הוכרעה */
function isStackDecided(stack: PhotoStack): boolean {
  return stack.photos.every((p) => p.decision !== null);
}

export function Swipe({ day, budgetTarget, onBack }: SwipeProps) {
  const t = useT();

  // הערימות נבנות פעם אחת מהתמונות של היום (סדר כרונולוגי כבר מובטח)
  const allStacks = useMemo(() => buildStacks(day.photos), [day.photos]);
  const totalPhotos = day.photos.length;

  // סינון לפי קטגוריה (נוף/אדם/קבוצה) — לפי תמונת ה-cover של הערימה
  const [category, setCategory] = useState<'all' | PhotoCategory>('all');
  // סינון לפי מצב החלטה — מאפשר לעבור רק על מה שנשאר, או לבקר את מה שהוחלט
  const [decisionFilter, setDecisionFilter] = useState<'all' | 'undecided' | 'decided'>('all');
  const stacks = useMemo(() => {
    let result: PhotoStack[];
    if (category !== 'all') {
      result = allStacks.filter((s) => categoryOfPhoto(s.cover) === category);
    } else {
      // "הכל": קודם כל התמונות עם אנשים (כרונולוגי), ואז תמונות הנוף (כרונולוגי)
      const people = allStacks.filter((s) => categoryOfPhoto(s.cover) !== 'background');
      const backgrounds = allStacks.filter(
        (s) => categoryOfPhoto(s.cover) === 'background',
      );
      result = [...people, ...backgrounds];
    }
    if (decisionFilter === 'undecided') result = result.filter((s) => !isStackDecided(s));
    else if (decisionFilter === 'decided') result = result.filter((s) => isStackDecided(s));
    return result;
  }, [allStacks, category, decisionFilter]);
  const categoryCounts = useMemo(() => {
    const counts: Record<PhotoCategory, number> = { background: 0, person: 0, group: 0 };
    for (const s of allStacks) {
      const c = categoryOfPhoto(s.cover);
      if (c) counts[c] += 1;
    }
    return counts;
  }, [allStacks]);
  const hasCategories = categoryCounts.background + categoryCounts.person + categoryCounts.group > 0;

  const [index, setIndex] = useState(() => {
    const first = stacks.findIndex((s) => !isStackDecided(s));
    return first === -1 ? stacks.length : first;
  });

  // החלפת סינון — קפיצה לערימה הראשונה שטרם הוכרעה (או לתחילת הרשימה בסינון "הוחלט")
  useEffect(() => {
    if (decisionFilter === 'decided') {
      setIndex(0);
    } else {
      const first = stacks.findIndex((s) => !isStackDecided(s));
      setIndex(first === -1 ? stacks.length : first);
    }
    setHistory([]);
    setDrag({ dx: 0, dy: 0, dragging: false });
    setExpanded(false);
  }, [category, decisionFilter, stacks]);
  const [drag, setDrag] = useState<DragState>({ dx: 0, dy: 0, dragging: false });
  const [flyOut, setFlyOut] = useState<Decision | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'kept' | 'rejected' | 'undecided'>('all');
  const [galleryCategory, setGalleryCategory] = useState<'all' | PhotoCategory>('all');
  const [, forceRender] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const busy = useRef(false);

  const current: PhotoStack | undefined = stacks[index];
  const next1 = stacks[index + 1];
  const next2 = stacks[index + 2];

  const currentUrl = useObjectUrl(current?.cover.preview);
  const next1Url = useObjectUrl(next1?.cover.preview);
  const next2Url = useObjectUrl(next2?.cover.preview);

  const stats = useMemo(() => {
    let kept = 0;
    let favorites = 0;
    let rejected = 0;
    for (const p of day.photos) {
      if (p.decision === 'keep') kept += 1;
      else if (p.decision === 'favorite') favorites += 1;
      else if (p.decision === 'reject') rejected += 1;
    }
    return { kept, favorites, rejected };
  }, [day.photos, index, flyOut]); // מתעדכן אחרי כל החלטה

  /** שומר החלטות לכל תמונות הערימה: ה-cover מקבל את ההחלטה, השאר נדחות */
  const persistStackDecision = useCallback(async (stack: PhotoStack, decision: Decision) => {
    for (const photo of stack.photos) {
      const photoDecision: Decision =
        decision === 'reject' ? 'reject' : photo.id === stack.cover.id ? decision : 'reject';
      photo.decision = photoDecision;
      await setDecision(photo.id, photoDecision);
    }
  }, []);

  const advance = useCallback(() => {
    window.setTimeout(() => {
      setHistory((h) => [...h, index]);
      setIndex((i) => i + 1);
      setDrag({ dx: 0, dy: 0, dragging: false });
      setFlyOut(null);
      busy.current = false;
    }, 280);
  }, [index]);

  const applyDecision = useCallback(
    async (decision: Decision) => {
      if (!current || busy.current || expanded) return;
      busy.current = true;
      setFlyOut(decision);
      await persistStackDecision(current, decision);
      advance();
    },
    [current, expanded, persistStackDecision, advance],
  );

  /** אישור בחירה מרובה מתוך ערימה מורחבת */
  const confirmStackSelection = useCallback(async () => {
    if (!current || busy.current) return;
    busy.current = true;
    setExpanded(false);
    setFlyOut(selectedIds.size > 0 ? 'keep' : 'reject');
    for (const photo of current.photos) {
      const decision: Decision = selectedIds.has(photo.id) ? 'keep' : 'reject';
      photo.decision = decision;
      await setDecision(photo.id, decision);
    }
    advance();
  }, [current, selectedIds, advance]);

  const undo = useCallback(async () => {
    if (busy.current || history.length === 0) return;
    const prevIndex = history[history.length - 1];
    for (const photo of stacks[prevIndex].photos) {
      photo.decision = null;
      await setDecision(photo.id, null);
    }
    setHistory((h) => h.slice(0, -1));
    setIndex(prevIndex);
    setDrag({ dx: 0, dy: 0, dragging: false });
    setExpanded(false);
  }, [history, stacks]);

  const openExpanded = useCallback(() => {
    if (!current) return;
    setSelectedIds(new Set([current.cover.id]));
    setExpanded(true);
  }, [current]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [selectMode, setSelectMode] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<Set<string>>(new Set());

  /** החלטה ישירה מהגלריה — שמירה מיידית */
  const decideGallery = useCallback(async (photo: PhotoRecord, decision: Decision) => {
    photo.decision = decision;
    await setDecision(photo.id, decision);
    forceRender((n) => n + 1);
  }, []);

  /** החלטה קבוצתית על כל הנבחרות */
  const decideSelected = useCallback(
    async (decision: Decision) => {
      for (const photo of day.photos) {
        if (!selectedGalleryIds.has(photo.id)) continue;
        photo.decision = decision;
        await setDecision(photo.id, decision);
      }
      setSelectedGalleryIds(new Set());
      forceRender((n) => n + 1);
    },
    [day.photos, selectedGalleryIds],
  );

  const toggleGallerySelect = useCallback((id: string) => {
    setSelectedGalleryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // מקלדת: חצים בכיוון הפיזי — ימינה=באלבום, שמאלה=לא, למעלה=מועדפת
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (galleryOpen) {
        if (e.key === 'Escape') {
          setLightboxIndex((idx) => {
            if (idx !== null) return null;
            setGalleryOpen(false);
            return null;
          });
        } else if (e.key === 'ArrowRight') {
          setLightboxIndex((idx) => (idx !== null && idx > 0 ? idx - 1 : idx));
        } else if (e.key === 'ArrowLeft') {
          setLightboxIndex((idx) => (idx !== null ? idx + 1 : idx));
        }
        return;
      }
      if (expanded) {
        if (e.key === 'Escape') setExpanded(false);
        return;
      }
      if (e.key === 'ArrowRight') applyDecision('keep');
      else if (e.key === 'ArrowLeft') applyDecision('reject');
      else if (e.key === 'ArrowUp') applyDecision('favorite');
      else if (e.key === 'Backspace' || e.key === 'z') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyDecision, undo, expanded, galleryOpen]);

  // ===== גלריית היום — תצוגה, סינון ותיקון החלטות =====
  // אבחון dev: אשכולות זהות — איזה "אדם" זוהה בכל תמונה
  const personClusters = useMemo(
    () => (import.meta.env.DEV ? getPersonClusters(day.photos) : null),
    [day.photos],
  );

  // מיפוי תמונה → ערימה (רק ערימות אמיתיות, 2+), עם גוון ייחודי לכל ערימה
  const galleryStackInfo = useMemo(() => {
    const map = new Map<string, GalleryStackInfo>();
    let stackIndex = 0;
    for (const stack of allStacks) {
      if (stack.photos.length < 2) continue;
      const hue = (stackIndex * 67) % 360; // קפיצות גוון גדולות — צבעים מובחנים
      for (const photo of stack.photos) {
        map.set(photo.id, { size: stack.photos.length, hue });
      }
      stackIndex += 1;
    }
    return map;
  }, [allStacks]);

  const galleryPhotos = day.photos.filter((p) => {
    if (galleryCategory !== 'all' && categoryOfPhoto(p) !== galleryCategory) return false;
    if (galleryFilter === 'kept') return p.decision === 'keep' || p.decision === 'favorite';
    if (galleryFilter === 'rejected') return p.decision === 'reject';
    if (galleryFilter === 'undecided') return p.decision === null;
    return true;
  });

  const galleryOverlay = galleryOpen ? (
    <div className="gallery-overlay">
      <div className="gallery-header">
        <div className="gallery-filters">
          {(
            [
              ['all', t.galleryFilterAll],
              ['kept', t.galleryFilterKept],
              ['rejected', t.galleryFilterRejected],
              ['undecided', t.galleryFilterUndecided],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`swipe-category-chip${galleryFilter === key ? ' swipe-category-active' : ''}`}
              onClick={() => setGalleryFilter(key)}
            >
              {label}
            </button>
          ))}
          <span className="swipe-filter-divider" aria-hidden />
          {(
            [
              ['all', t.categoryAll],
              ['background', t.categoryBackground],
              ['person', t.categoryPerson],
              ['group', t.categoryGroup],
            ] as const
          ).map(([key, label]) => (
            <button
              key={`c-${key}`}
              className={`swipe-category-chip${galleryCategory === key ? ' swipe-category-active' : ''}`}
              onClick={() => setGalleryCategory(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="gallery-header-actions">
          <button
            className={`btn-ghost${selectMode ? ' gallery-select-active' : ''}`}
            onClick={() => {
              setSelectMode((m) => !m);
              setSelectedGalleryIds(new Set());
            }}
          >
            {selectMode ? t.gallerySelectExit : t.gallerySelectMode}
          </button>
          <button className="btn-ghost" onClick={() => setGalleryOpen(false)}>
            {t.back}
          </button>
        </div>
      </div>
      <p className="gallery-hint">
        {t.galleryHint}
        {import.meta.env.DEV && (
          <span dir="ltr">
            {' · '}id-sigs: {day.photos.filter((p) => p.faceSigs?.length > 0).length}/
            {day.photos.length}
          </span>
        )}
      </p>
      <div className="gallery-grid">
        {galleryPhotos.map((photo, i) => (
          <GalleryItem
            key={photo.id}
            photo={photo}
            stackInfo={galleryStackInfo.get(photo.id)}
            personLabel={
              personClusters?.get(photo.id)
                ? `P${[...personClusters.get(photo.id)!].join(',')}`
                : undefined
            }
            selectMode={selectMode}
            selected={selectedGalleryIds.has(photo.id)}
            onToggleSelect={() => toggleGallerySelect(photo.id)}
            onOpen={() => withViewTransition(() => setLightboxIndex(i))}
            onDecide={(decision) => decideGallery(photo, decision)}
          />
        ))}
      </div>

      {lightboxIndex !== null && galleryPhotos.length > 0 && (() => {
        const idx = Math.min(lightboxIndex, galleryPhotos.length - 1);
        const photo = galleryPhotos[idx];
        return (
          <Lightbox
            photo={photo}
            onDecide={(decision) => decideGallery(photo, decision)}
            onPrev={idx > 0 ? () => setLightboxIndex(idx - 1) : null}
            onNext={idx < galleryPhotos.length - 1 ? () => setLightboxIndex(idx + 1) : null}
            onClose={() => setLightboxIndex(null)}
          />
        );
      })()}

      {selectMode && selectedGalleryIds.size > 0 && (
        <div className="gallery-bulk-bar">
          <span className="gallery-bulk-count">
            {t.gallerySelectedCount(selectedGalleryIds.size)}
          </span>
          <button
            className="swipe-btn swipe-btn-keep gallery-bulk-btn"
            onClick={() => decideSelected('keep')}
            aria-label={t.swipeKeep}
          >
            ✓
          </button>
          <button
            className="swipe-btn swipe-btn-fav gallery-bulk-btn"
            onClick={() => decideSelected('favorite')}
            aria-label={t.swipeFavorite}
          >
            ★
          </button>
          <button
            className="swipe-btn swipe-btn-reject gallery-bulk-btn"
            onClick={() => decideSelected('reject')}
            aria-label={t.swipeReject}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  ) : null;

  // ===== Pointer events — גרירת הקלף =====
  const onPointerDown = (e: React.PointerEvent) => {
    if (busy.current || expanded) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    setDrag({ dx: 0, dy: 0, dragging: true });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current || dragStart.current.pointerId !== e.pointerId) return;
    setDrag({
      dx: e.clientX - dragStart.current.x,
      dy: e.clientY - dragStart.current.y,
      dragging: true,
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragStart.current || dragStart.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    dragStart.current = null;
    const decision = decisionFromDrag(dx, dy, DRAG_THRESHOLD);
    if (decision) {
      applyDecision(decision);
    } else {
      setDrag({ dx: 0, dy: 0, dragging: false });
    }
  };

  // ===== סיום קטגוריה / יום =====
  if (!current) {
    const categoryNames: Record<PhotoCategory, string> = {
      background: t.categoryBackground,
      person: t.categoryPerson,
      group: t.categoryGroup,
    };
    // קטגוריות אחרות שעדיין יש בהן ערימות שלא הוכרעו
    const pendingCategories = (['person', 'group', 'background'] as PhotoCategory[]).filter(
      (c) =>
        c !== category &&
        allStacks.some((s) => categoryOfPhoto(s.cover) === c && !isStackDecided(s)),
    );
    const isCategoryFinish = category !== 'all' && pendingCategories.length > 0;

    const reviewAgain = () => {
      setIndex(0);
      setHistory([]);
      setDrag({ dx: 0, dy: 0, dragging: false });
    };

    return (
      <div className="screen swipe-complete">
        {!isCategoryFinish && <Confetti />}
        <div className="swipe-complete-card">
          <div className="swipe-complete-emoji" aria-hidden>🎉</div>
          <h1 className="swipe-complete-title">
            {isCategoryFinish
              ? t.categoryCompleteTitle(categoryNames[category as PhotoCategory])
              : t.dayCompleteTitle}
          </h1>
          <div className="swipe-complete-stats">
            <span className="stat stat-keep">✓ {t.dayCompleteKept(stats.kept)}</span>
            <span className="stat stat-fav">★ {t.dayCompleteFavorites(stats.favorites)}</span>
            <span className="stat stat-reject">✕ {t.dayCompleteRejected(stats.rejected)}</span>
          </div>

          {isCategoryFinish && (
            <div className="swipe-complete-continue">
              <span className="swipe-complete-continue-label">{t.continueOtherCategories}</span>
              <div className="swipe-categories">
                {pendingCategories.map((c) => (
                  <button
                    key={c}
                    className="swipe-category-chip"
                    onClick={() => setCategory(c)}
                  >
                    {categoryNames[c]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="swipe-complete-actions">
            {history.length > 0 && (
              <button className="btn-ghost" onClick={undo}>
                {t.undo}
              </button>
            )}
            {stacks.length > 0 && (
              <button className="btn-ghost" onClick={reviewAgain}>
                {t.reviewAgain}
              </button>
            )}
            <button className="btn-ghost" onClick={() => setGalleryOpen(true)}>
              {t.gallery}
            </button>
            <button className="btn-primary" onClick={onBack}>
              {t.backToDays}
            </button>
          </div>
        </div>
        {galleryOverlay}
      </div>
    );
  }

  const remaining = stacks.length - index;
  const progressPct = (index / stacks.length) * 100;
  const dragDecision = decisionFromDrag(drag.dx, drag.dy, DRAG_THRESHOLD);
  const rotation = drag.dx * 0.06;
  const isStack = current.photos.length > 1;

  // עוצמת חיווי לפי מרחק גרירה
  const keepOpacity = Math.min(1, Math.max(0, drag.dx) / DRAG_THRESHOLD);
  const rejectOpacity = Math.min(1, Math.max(0, -drag.dx) / DRAG_THRESHOLD);
  const favOpacity =
    Math.abs(drag.dy) > Math.abs(drag.dx)
      ? Math.min(1, Math.max(0, -drag.dy) / DRAG_THRESHOLD)
      : 0;

  // צל פיזיקלי: ככל שגוררים — הקלף "מתרומם", הצל גדל ומוסט הפוך לכיוון הגרירה
  const dragDist = Math.hypot(drag.dx, drag.dy);
  const liftShadow = `${-drag.dx * 0.06}px ${14 + dragDist * 0.06}px ${34 + dragDist * 0.18}px rgba(0, 0, 0, ${Math.min(0.55, 0.35 + dragDist * 0.0009)})`;

  const cardStyle: React.CSSProperties = flyOut
    ? {
        transform:
          flyOut === 'favorite'
            ? 'translateY(-120vh) rotate(0deg)'
            : `translateX(${flyOut === 'keep' ? '120vw' : '-120vw'}) rotate(${flyOut === 'keep' ? 18 : -18}deg)`,
        transition: 'transform 300ms cubic-bezier(0.5, 0, 0.75, 0.6)',
      }
    : {
        transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${rotation}deg)`,
        boxShadow: drag.dragging ? liftShadow : undefined,
        transition: drag.dragging
          ? 'none'
          : 'transform 350ms cubic-bezier(0.22, 1.4, 0.36, 1), box-shadow 350ms ease',
      };

  return (
    <div className="screen swipe">
      <header className="swipe-header">
        <button className="btn-ghost" onClick={onBack}>
          {t.back}
        </button>
        <div className="swipe-header-info">
          <span className="swipe-day-title">{formatDayTitle(day) ?? t.noDateBucket}</span>
          <span className="swipe-remaining" key={remaining}>
            {t.swipeRemaining(remaining, stacks.length)}
            {stacks.length < totalPhotos && ` · ${t.photosInDay(totalPhotos)}`}
          </span>
          {budgetTarget !== null && (
            <span
              className={`swipe-budget${stats.kept + stats.favorites > budgetTarget ? ' swipe-budget-over' : ''}`}
            >
              {t.budgetStatus(stats.kept + stats.favorites, budgetTarget)}
            </span>
          )}
        </div>
        <div className="swipe-header-side">
          <button className="btn-ghost" onClick={() => setGalleryOpen(true)}>
            {t.gallery}
          </button>
          <button className="btn-ghost" onClick={undo} disabled={history.length === 0}>
            {t.undo}
          </button>
        </div>
      </header>

      <div className="swipe-progress">
        <div className="swipe-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {hasCategories && (
        <div className="swipe-categories">
          {(
            [
              ['all', t.categoryAll, allStacks.length],
              ['background', t.categoryBackground, categoryCounts.background],
              ['person', t.categoryPerson, categoryCounts.person],
              ['group', t.categoryGroup, categoryCounts.group],
            ] as const
          ).map(([key, label, count]) =>
            count === 0 && key !== 'all' ? null : (
              <button
                key={key}
                className={`swipe-category-chip${category === key ? ' swipe-category-active' : ''}`}
                onClick={() => setCategory(key)}
              >
                {label} · {count}
              </button>
            ),
          )}
          <span className="swipe-filter-divider" aria-hidden />
          {(
            [
              ['all', t.categoryAll],
              ['undecided', t.filterUndecided],
              ['decided', t.filterDecided],
            ] as const
          ).map(([key, label]) => (
            <button
              key={`d-${key}`}
              className={`swipe-category-chip${decisionFilter === key ? ' swipe-category-active' : ''}`}
              onClick={() => setDecisionFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="swipe-stage">
        {/* קלפים מאחור — תחושת "יש עוד" */}
        {next2 && next2Url && (
          <div className="swipe-card swipe-card-back2">
            <img src={next2Url} alt="" draggable={false} />
          </div>
        )}
        {next1 && next1Url && (
          <div className="swipe-card swipe-card-back1">
            <img src={next1Url} alt="" draggable={false} />
          </div>
        )}

        {/* הקלף הפעיל */}
        {currentUrl && (
          <div
            className={`swipe-card swipe-card-top${isStack ? ' swipe-card-stacked' : ''}`}
            style={cardStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img src={currentUrl} alt={current.cover.name} draggable={false} />

            {current.cover.takenAt !== null && (
              <span className="swipe-card-timestamp">
                {galleryTimeFormatter.format(current.cover.takenAt)}
              </span>
            )}

            {/* חיווי החלטה קיימת — במעבר חוזר על החלטות */}
            {current.cover.decision && !dragDecision && !flyOut && (
              <span className={`swipe-decided-badge decided-${current.cover.decision}`}>
                {current.cover.decision === 'keep'
                  ? t.decidedKeep
                  : current.cover.decision === 'favorite'
                    ? t.decidedFavorite
                    : t.decidedReject}
              </span>
            )}

            {isStack && (
              <>
                <span className="stack-badge">{t.stackBadge(current.photos.length)}</span>
                <button
                  className="stack-expand-btn"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={openExpanded}
                >
                  {t.stackShowAll(current.photos.length)}
                </button>
              </>
            )}

            <span
              className="swipe-tag swipe-tag-keep"
              style={{ opacity: flyOut === 'keep' ? 1 : keepOpacity }}
            >
              {t.swipeKeep} ✓
            </span>
            <span
              className="swipe-tag swipe-tag-reject"
              style={{ opacity: flyOut === 'reject' ? 1 : rejectOpacity }}
            >
              {t.swipeReject} ✕
            </span>
            <span
              className="swipe-tag swipe-tag-fav"
              style={{ opacity: flyOut === 'favorite' ? 1 : favOpacity }}
            >
              {t.swipeFavorite} ★
            </span>
            {dragDecision && <div className={`swipe-card-glow glow-${dragDecision}`} />}
          </div>
        )}

        {/* הרחבת ערימה — בחירה מרובה */}
        {expanded && (
          <div className="stack-overlay">
            <p className="stack-overlay-hint">{t.stackHint}</p>
            <div className="stack-grid">
              {[...current.photos]
                .sort((a, b) => (b.bestShotScore ?? -1) - (a.bestShotScore ?? -1))
                .map((photo) => (
                  <StackGridItem
                    key={photo.id}
                    photo={photo}
                    selected={selectedIds.has(photo.id)}
                    recommended={photo.id === current.cover.id}
                    onToggle={() => toggleSelected(photo.id)}
                  />
                ))}
            </div>
            <div className="stack-overlay-actions">
              <button className="btn-ghost" onClick={() => setExpanded(false)}>
                {t.stackCancel}
              </button>
              <button className="btn-primary" onClick={confirmStackSelection}>
                {t.stackConfirm(selectedIds.size, current.photos.length)}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="swipe-actions">
        <button
          className="swipe-btn swipe-btn-undo"
          onClick={undo}
          disabled={history.length === 0}
          aria-label={t.undo}
          title={t.undo}
        >
          ↩
        </button>
        <button
          className="swipe-btn swipe-btn-reject"
          onClick={() => applyDecision('reject')}
          aria-label={t.swipeReject}
        >
          ✕
        </button>
        <button
          className="swipe-btn swipe-btn-fav"
          onClick={() => applyDecision('favorite')}
          aria-label={t.swipeFavorite}
        >
          ★
        </button>
        <button
          className="swipe-btn swipe-btn-keep"
          onClick={() => applyDecision('keep')}
          aria-label={t.swipeKeep}
        >
          ✓
        </button>
      </div>

      {galleryOverlay}
    </div>
  );
}
