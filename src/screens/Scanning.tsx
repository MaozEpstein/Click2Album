import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { ScanProgress } from '../lib/scan';
import './Scanning.css';

interface ScanningProps {
  progress: ScanProgress;
}

/** thumbnail בודד — מנהל object URL עם ניקוי אוטומטי */
function Thumb({ blob, style }: { blob: Blob; style: React.CSSProperties }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return url ? <img className="scanning-thumb" style={style} src={url} alt="" /> : null;
}

export function Scanning({ progress }: ScanningProps) {
  const t = useT();

  return (
    <div className="screen scanning">
      <div className="scanning-content">
        <div className="scanning-spinner" aria-hidden />
        <h1 className="scanning-title">{t.scanningTitle}</h1>
        {progress.total === 0 ? (
          <p className="scanning-count">{t.scanningCounting}</p>
        ) : (
          <>
            <p className="scanning-count">
              {t.scannedOf(progress.processed, progress.total)}
            </p>
            <div className="scanning-bar">
              <div
                className="scanning-bar-fill"
                style={{ width: `${(progress.processed / progress.total) * 100}%` }}
              />
            </div>
            {progress.etaSeconds !== null && (
              <p className="scanning-eta">
                {t.scanningEta(Math.round(progress.etaSeconds / 60))}
              </p>
            )}
            <p className="scanning-stage">{t.scanningStage}</p>
          </>
        )}
        <p className="scanning-hint">{t.scanningHint}</p>

        <div className="scanning-thumbs">
          {progress.latestThumbnails.map((blob, i) => {
            const seq = progress.processed - i;
            // זווית והיסט דטרמיניסטיים לפי מספר התמונה — הערימה לא "רוקדת" ב-render
            const angle = ((seq * 47) % 17) - 8;
            const dx = ((seq * 31) % 25) - 12;
            const dy = ((seq * 19) % 13) - 6;
            return (
              <Thumb
                key={seq}
                blob={blob}
                style={{
                  transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${angle}deg)`,
                  zIndex: progress.latestThumbnails.length - i,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
