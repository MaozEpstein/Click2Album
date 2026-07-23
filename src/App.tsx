import { useCallback, useEffect, useState } from 'react';
import { Welcome } from './screens/Welcome';
import { Scanning } from './screens/Scanning';
import { Days } from './screens/Days';
import { Swipe } from './screens/Swipe';
import { Album } from './screens/Album';
import { Cleanup } from './screens/Cleanup';
import { buildAlbum } from './lib/layoutEngine';
import { pickLocalFolder } from './sources/localFolder';
import { scanSource, type ScanProgress } from './lib/scan';
import {
  clearProject,
  getAllPhotos,
  getProjectState,
  getSavedAlbum,
  saveAlbumLayout,
  saveSourceHandle,
  type PhotoRecord,
} from './lib/db';
import { groupByDay } from './lib/days';
import { selectionFingerprint, type AlbumLayout } from './lib/album';
import { getSettings, layoutSettingsKey } from './lib/settings';
import { facesPending, type FacesProgress } from './lib/faces';
import { embedPending } from './lib/embed';
import { scorePending } from './lib/bestShot';
import { subjectPending } from './lib/subject';
import { hasTemplate } from './lib/templates';
import { computeDayTargets } from './lib/budget';
import { t } from './i18n';

type Screen =
  | { name: 'loading' }
  | { name: 'welcome' }
  | { name: 'scanning'; progress: ScanProgress }
  | { name: 'days'; photos: PhotoRecord[] }
  | { name: 'swipe'; photos: PhotoRecord[]; dayKey: string }
  | { name: 'album'; photos: PhotoRecord[]; layout: AlbumLayout }
  | { name: 'cleanup'; photos: PhotoRecord[] };

/** תמונות פעילות — לא כולל מסוננות */
function visibleOf(photos: PhotoRecord[]): PhotoRecord[] {
  return photos.filter((p) => !p.filtered);
}

/** חשודות שטרם טופלו — לתצוגת מסך הניקוי */
function suspectsOf(photos: PhotoRecord[]): PhotoRecord[] {
  return photos.filter((p) => p.flags.length > 0 && !p.filtered);
}

/** fingerprint מלא: בחירות + הגדרות עימוד — שינוי באחד מהם בונה מחדש */
function albumFingerprint(photos: PhotoRecord[]): string {
  const selected = visibleOf(photos).filter(
    (p) => p.decision === 'keep' || p.decision === 'favorite',
  );
  return `${selectionFingerprint(selected.map((p) => p.id))}#${layoutSettingsKey(getSettings())}`;
}

function buildAlbumWithSettings(photos: PhotoRecord[]): AlbumLayout {
  const settings = getSettings();
  return buildAlbum(visibleOf(photos), {
    separateBackgrounds: settings.separateBackgrounds,
    backgroundsPerDay: settings.backgroundsPerDay,
  });
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [classifyProgress, setClassifyProgress] = useState<FacesProgress | null>(null);
  const [analysisLabel, setAnalysisLabel] = useState<
    'classify' | 'embed' | 'score' | 'subject'
  >('classify');

  // ניתוח רקע: פנים → דמיון → דירוג. מתחדש מכל מסך שיש בו תמונות —
  // המנתחים עצמם מדלגים על מה שכבר חושב, אז הפעלה חוזרת בטוחה.
  useEffect(() => {
    if (!('photos' in screen)) return;
    const visible = visibleOf(screen.photos);
    const needsClassify = visible.some((p) => p.faceCount === null);
    const needsEmbed = visible.some((p) => p.embedding === null);
    const needsScore = visible.some((p) => p.bestShotScore === null);
    const needsSubject = visible.some((p) => p.subjectSig === null && p.faceCount === 0);
    if (!needsClassify && !needsEmbed && !needsScore && !needsSubject) return;
    (async () => {
      if (needsClassify) {
        setAnalysisLabel('classify');
        try {
          await facesPending(visible, setClassifyProgress);
        } catch {
          // הסטטוס נרשם ב-faceStatus ומוצג במסך; ממשיכים לשלב הבא
        }
      }
      if (needsEmbed) {
        setAnalysisLabel('embed');
        await embedPending(visible, setClassifyProgress);
      }
      if (needsScore) {
        setAnalysisLabel('score');
        await scorePending(visible, setClassifyProgress);
      }
      // נושאים תלויי סיווג פנים — רץ אחרי שהסיווג הסתיים
      setAnalysisLabel('subject');
      await subjectPending(visible, setClassifyProgress);
      setClassifyProgress(null);
    })();
  }, [screen]);

  // שחזור מצב: אם כבר נסרק פרויקט — ישר למסך הימים
  useEffect(() => {
    (async () => {
      const project = await getProjectState();
      if (project?.scanCompleted) {
        const photos = await getAllPhotos();
        if (photos.length > 0) {
          setScreen({ name: 'days', photos });
          return;
        }
      }
      setScreen({ name: 'welcome' });
    })();
  }, []);

  const handlePickFolder = useCallback(async () => {
    setError(null);
    const picked = await pickLocalFolder();
    if (!picked) return;

    await clearProject();
    if (picked.handle) await saveSourceHandle(picked.handle);
    setScreen({
      name: 'scanning',
      progress: { processed: 0, total: 0, etaSeconds: null, latestThumbnails: [] },
    });

    const total = await scanSource(picked.source, (progress) => {
      setScreen({ name: 'scanning', progress });
    });

    if (total === 0) {
      setError(t.errNoPhotos);
      setScreen({ name: 'welcome' });
      return;
    }

    const photos = await getAllPhotos();
    // אם נמצאו חשודות — קודם מסך הניקוי
    if (suspectsOf(photos).length > 0) {
      setScreen({ name: 'cleanup', photos });
    } else {
      setScreen({ name: 'days', photos });
    }
  }, []);

  const handleNewProject = useCallback(async () => {
    await clearProject();
    setError(null);
    setScreen({ name: 'welcome' });
  }, []);

  const handleOpenDay = useCallback((dayKey: string) => {
    setScreen((s) =>
      s.name === 'days' ? { name: 'swipe', photos: s.photos, dayKey } : s,
    );
  }, []);

  // חזרה מהסווייפ — רענון התמונות מה-DB כדי שההתקדמות תוצג בכרטיסי הימים
  const handleBackToDays = useCallback(async () => {
    const photos = await getAllPhotos();
    setScreen({ name: 'days', photos });
  }, []);

  /** טוען אלבום שמור (עם עריכות) אם הבחירות וההגדרות לא השתנו; אחרת בונה מחדש */
  const loadOrBuildAlbum = useCallback(async (photos: PhotoRecord[]): Promise<AlbumLayout> => {
    const fingerprint = albumFingerprint(photos);
    const saved = await getSavedAlbum();
    // אלבום שמור תקף רק אם כל התבניות שלו עדיין קיימות (הקטלוג התחדש)
    const savedValid =
      saved && saved.layout.pages.every((p) => hasTemplate(p.templateId));
    if (saved && savedValid && saved.selectionFingerprint === fingerprint) return saved.layout;
    const layout = buildAlbumWithSettings(photos);
    await saveAlbumLayout(layout, fingerprint);
    return layout;
  }, []);

  const handleOpenAlbum = useCallback(async () => {
    const photos = await getAllPhotos();
    const layout = await loadOrBuildAlbum(photos);
    setScreen({ name: 'album', photos, layout });
  }, [loadOrBuildAlbum]);

  /** שמירת עריכה + עדכון המסך */
  const handleLayoutChange = useCallback(async (layout: AlbumLayout) => {
    setScreen((s) => (s.name === 'album' ? { ...s, layout } : s));
    const photos = await getAllPhotos();
    await saveAlbumLayout(layout, albumFingerprint(photos));
  }, []);

  /** בנייה מחדש אוטומטית — דורס עריכות; נקרא גם אחרי שינוי הגדרות */
  const handleRebuildAlbum = useCallback(async () => {
    const photos = await getAllPhotos();
    const layout = buildAlbumWithSettings(photos);
    await saveAlbumLayout(layout, albumFingerprint(photos));
    setScreen({ name: 'album', photos, layout });
  }, []);

  const handleOpenCleanup = useCallback(async () => {
    const photos = await getAllPhotos();
    setScreen({ name: 'cleanup', photos });
  }, []);

  // חיווי ניתוח רקע — גלוי בכל מסך
  const analysisChip = classifyProgress ? (
    <div className="analysis-chip" dir="rtl">
      {analysisLabel === 'subject'
        ? t.subjectAnalyzing(classifyProgress.done, classifyProgress.total)
        : analysisLabel === 'score'
          ? t.scoring(classifyProgress.done, classifyProgress.total)
          : analysisLabel === 'embed'
            ? t.embedding(classifyProgress.done, classifyProgress.total)
            : t.classifying(classifyProgress.done, classifyProgress.total)}
    </div>
  ) : null;

  const content = (() => {
    switch (screen.name) {
    case 'loading':
      return null;
    case 'welcome':
      return <Welcome onPickFolder={handlePickFolder} error={error} />;
    case 'scanning':
      return <Scanning progress={screen.progress} />;
    case 'days':
      return (
        <Days
          photos={visibleOf(screen.photos)}
          suspectsCount={suspectsOf(screen.photos).length}
          onOpenDay={handleOpenDay}
          onOpenAlbum={handleOpenAlbum}
          onOpenCleanup={handleOpenCleanup}
          onNewProject={handleNewProject}
        />
      );
    case 'swipe': {
      const day = groupByDay(visibleOf(screen.photos)).find((g) => g.key === screen.dayKey);
      if (!day) {
        return (
          <Days
            photos={visibleOf(screen.photos)}
            suspectsCount={suspectsOf(screen.photos).length}
            onOpenDay={handleOpenDay}
            onOpenAlbum={handleOpenAlbum}
            onOpenCleanup={handleOpenCleanup}
            onNewProject={handleNewProject}
          />
        );
      }
      const { targetPages } = getSettings();
      const budgetTarget = targetPages
        ? computeDayTargets(visibleOf(screen.photos), targetPages).get(day.key) ?? null
        : null;
      return (
        <Swipe key={day.key} day={day} budgetTarget={budgetTarget} onBack={handleBackToDays} />
      );
    }
    case 'cleanup':
      return <Cleanup suspects={suspectsOf(screen.photos)} onDone={handleBackToDays} />;
    case 'album': {
      const photosById = new Map(screen.photos.map((p) => [p.id, p]));
      return (
        <Album
          layout={screen.layout}
          photosById={photosById}
          onBack={handleBackToDays}
          onLayoutChange={handleLayoutChange}
          onRebuild={handleRebuildAlbum}
        />
      );
    }
    }
  })();

  return (
    <>
      {content}
      {analysisChip}
    </>
  );
}
