import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { setFilteredBulk, type PhotoRecord } from '../lib/db';
import type { QualityFlag } from '../lib/quality';
import { useObjectUrl } from '../lib/useObjectUrl';
import './Cleanup.css';

interface CleanupProps {
  /** תמונות חשודות (עם דגלים, שטרם סוננו) */
  suspects: PhotoRecord[];
  onDone: () => void;
}

const GROUP_ORDER: QualityFlag[] = ['screenshot', 'blurry', 'dark'];

function CleanupItem({
  photo,
  kept,
  onToggle,
}: {
  photo: PhotoRecord;
  kept: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const url = useObjectUrl(photo.thumbnail);
  return (
    <button
      className={`cleanup-item${kept ? ' cleanup-item-kept' : ''}`}
      onClick={onToggle}
    >
      {url && <img src={url} alt={photo.name} loading="lazy" />}
      {kept && <span className="cleanup-kept-badge">{t.cleanupKept}</span>}
    </button>
  );
}

export function Cleanup({ suspects, onDone }: CleanupProps) {
  const t = useT();
  // ברירת מחדל: הכל מסומן להסרה; לחיצה = השארה
  const [keptIds, setKeptIds] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const byFlag = new Map<QualityFlag, PhotoRecord[]>();
    for (const flag of GROUP_ORDER) byFlag.set(flag, []);
    for (const photo of suspects) {
      // תמונה עם כמה דגלים מופיעה בקבוצה הראשונה לפי הסדר
      const flag = GROUP_ORDER.find((f) => photo.flags.includes(f));
      if (flag) byFlag.get(flag)!.push(photo);
    }
    return GROUP_ORDER.map((flag) => ({ flag, photos: byFlag.get(flag)! })).filter(
      (g) => g.photos.length > 0,
    );
  }, [suspects]);

  const groupTitle: Record<QualityFlag, string> = {
    blurry: t.cleanupGroupBlurry,
    dark: t.cleanupGroupDark,
    screenshot: t.cleanupGroupScreenshot,
  };

  const toggle = (id: string) => {
    setKeptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeCount = suspects.length - keptIds.size;

  const confirm = async () => {
    const toRemove = suspects.filter((p) => !keptIds.has(p.id)).map((p) => p.id);
    if (toRemove.length > 0) await setFilteredBulk(toRemove, true);
    onDone();
  };

  return (
    <div className="screen cleanup">
      <header className="cleanup-header">
        <h1 className="cleanup-title">{t.cleanupTitle}</h1>
        <p className="cleanup-subtitle">{t.cleanupSubtitle}</p>
      </header>

      <div className="cleanup-groups">
        {groups.map(({ flag, photos }) => (
          <section key={flag} className="cleanup-group">
            <h2 className="cleanup-group-title">
              {groupTitle[flag]} · {photos.length}
            </h2>
            <div className="cleanup-grid">
              {photos.map((photo) => (
                <CleanupItem
                  key={photo.id}
                  photo={photo}
                  kept={keptIds.has(photo.id)}
                  onToggle={() => toggle(photo.id)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="cleanup-footer">
        <button className="btn-ghost" onClick={onDone}>
          {t.cleanupKeepAll}
        </button>
        <button className="btn-primary" onClick={confirm} disabled={removeCount === 0}>
          {t.cleanupRemove(removeCount)}
        </button>
      </footer>
    </div>
  );
}
