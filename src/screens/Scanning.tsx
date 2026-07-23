import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { ScanProgress } from '../lib/scan';
import './Scanning.css';

interface ScanningProps {
  progress: ScanProgress;
}

/** thumbnail בודד — מנהל object URL עם ניקוי אוטומטי */
function Thumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return url ? <img className="scanning-thumb" src={url} alt="" /> : null;
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
          {progress.latestThumbnails.map((blob, i) => (
            <Thumb key={progress.processed - i} blob={blob} />
          ))}
        </div>
      </div>
    </div>
  );
}
