import { useMemo } from 'react';
import { useT } from '../i18n';
import { useObjectUrl } from '../lib/useObjectUrl';
import { getSettings } from '../lib/settings';
import { faceStatus } from '../lib/faces';
import { computeDayTargets } from '../lib/budget';
import type { PhotoRecord } from '../lib/db';
import { groupByDay, formatDayTitle, type DayGroup } from '../lib/days';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import './Days.css';

interface DaysProps {
  photos: PhotoRecord[];
  suspectsCount: number;
  onOpenDay: (dayKey: string) => void;
  onOpenAlbum: () => void;
  onOpenCleanup: () => void;
  onOpenProjects: () => void;
  onRescan: () => void;
}

/** תמונת נושא של יום — thumbnail עם ניהול object URL */
function CoverImage({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob);
  return url ? <img className="day-cover" src={url} alt="" loading="lazy" /> : null;
}

function DayCard({
  group,
  index,
  target,
  onOpen,
}: {
  group: DayGroup;
  index: number;
  target: number | null;
  onOpen: () => void;
}) {
  const t = useT();
  const title = formatDayTitle(group) ?? t.noDateBucket;
  const total = group.photos.length;
  const decidedCount = group.photos.filter((p) => p.decision !== null).length;
  const keptCount = group.photos.filter(
    (p) => p.decision === 'keep' || p.decision === 'favorite',
  ).length;
  const overBudget = target !== null && keptCount > target;
  const done = decidedCount === total;
  const cover = group.photos[0];

  return (
    <button
      className={`day-card${done ? ' day-card-done' : ''}`}
      style={{ animationDelay: `${Math.min(index * 60, 600)}ms` }}
      onClick={onOpen}
    >
      <div className="day-cover-wrap">
        <CoverImage blob={cover.thumbnail} />
        <div className="day-cover-overlay" />
        {done && <span className="day-done-badge">{t.dayDone}</span>}
      </div>
      <div className="day-info">
        <span className="day-title">{title}</span>
        <span className="day-count">
          {total === 1 ? t.onePhotoInDay : t.photosInDay(total)}
          {target !== null && (
            <span className={`day-target${overBudget ? ' day-target-over' : ''}`}>
              {' · '}
              {t.dayTarget(target)}
            </span>
          )}
        </span>
        {decidedCount > 0 && !done && (
          <span className="day-progress-text">
            {t.dayProgress(keptCount, total - decidedCount)}
          </span>
        )}
        {decidedCount > 0 && (
          <div className="day-progress-bar">
            <div
              className="day-progress-bar-fill"
              style={{ width: `${(decidedCount / total) * 100}%` }}
            />
          </div>
        )}
      </div>
    </button>
  );
}

export function Days({
  photos,
  suspectsCount,
  onOpenDay,
  onOpenAlbum,
  onOpenCleanup,
  onOpenProjects,
  onRescan,
}: DaysProps) {
  const t = useT();
  const groups = useMemo(() => groupByDay(photos), [photos]);
  const dayTargets = useMemo(() => {
    const { targetPages } = getSettings();
    return targetPages ? computeDayTargets(photos, targetPages) : null;
  }, [photos]);
  const selectedCount = useMemo(
    () => photos.filter((p) => p.decision === 'keep' || p.decision === 'favorite').length,
    [photos],
  );


  return (
    <div className="screen days">
      <header className="days-header">
        <div>
          <h1 className="days-title">{t.daysTitle}</h1>
          <p className="days-subtitle">{t.daysSubtitle(groups.length, photos.length)}</p>
          {/* פאנל אבחון מנוע הפנים — גלוי בזמן פיתוח בלבד */}
          {import.meta.env.DEV && (
            <p
              className="days-classify"
              style={{ color: faceStatus.state === 'error' ? 'var(--danger)' : undefined }}
              dir="ltr"
            >
              faces: {faceStatus.state} · analyzed {faceStatus.processed} · with-id{' '}
              {faceStatus.withSigs}
              {faceStatus.lastError ? ` · ERR: ${faceStatus.lastError}` : ''}
            </p>
          )}
        </div>
        <div className="days-header-actions">
          {suspectsCount > 0 && (
            <button className="btn-ghost" onClick={onOpenCleanup}>
              {t.cleanupButton(suspectsCount)}
            </button>
          )}
          {selectedCount > 0 && (
            <button className="btn-primary days-album-btn" onClick={onOpenAlbum}>
              {t.viewAlbum}
              <span className="days-album-count">{selectedCount}</span>
            </button>
          )}
          <ThemeSwitcher />
          <button className="btn-ghost" onClick={onRescan}>
            {t.rescanProject}
          </button>
          <button className="btn-ghost" onClick={onOpenProjects}>
            {t.myProjects}
          </button>
        </div>
      </header>

      <div className="days-grid">
        {groups.map((group, i) => (
          <DayCard
            key={group.key}
            group={group}
            index={i}
            target={dayTargets?.get(group.key) ?? null}
            onOpen={() => onOpenDay(group.key)}
          />
        ))}
      </div>
    </div>
  );
}
