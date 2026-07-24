import { useCallback, useEffect, useRef, useState } from 'react';
import { Welcome } from './screens/Welcome';
import { Scanning } from './screens/Scanning';
import { Days } from './screens/Days';
import { Swipe } from './screens/Swipe';
import { Album } from './screens/Album';
import { Cleanup } from './screens/Cleanup';
import { Projects } from './screens/Projects';
import {
  createProject,
  getActiveProjectId,
  setActiveProjectId,
  listProjects,
  openProject,
  projectDbName,
  updateProjectMeta,
  type ProjectMeta,
} from './lib/projects';
import { resetDbConnection } from './lib/db';
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
import { facesPending } from './lib/faces';
import { embedPending } from './lib/embed';
import { scorePending } from './lib/bestShot';
import { subjectPending } from './lib/subject';
import { personsPending } from './lib/persons';
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
  | { name: 'cleanup'; photos: PhotoRecord[] }
  | { name: 'projects'; projects: ProjectMeta[] };

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
    sceneryAsBackgrounds: settings.sceneryAsBackgrounds,
  });
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const [error, setError] = useState<string | null>(null);
  /** מצב שרשרת הניתוח האחודה — אחוז רציף + שלב + הערכת זמן */
  const [analysis, setAnalysis] = useState<{
    stage: 'classify' | 'persons' | 'embed' | 'score' | 'subject';
    percent: number;
    etaSeconds: number | null;
  } | null>(null);
  const chainRef = useRef({ running: false, id: 0 });
  /** חתימת הריצה האחרונה שהסתיימה — מונע לולאה אינסופית על תמונות שנכשלות תמיד */
  const lastChainSignatureRef = useRef<string | null>(null);
  const introShownRef = useRef(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);

  /** ממוצע גס לפעולה — להערכת זמן ראשונית לפני שנמדד קצב אמיתי */
  const ROUGH_SECONDS_PER_OP = 0.35;

  // ניתוח רקע: פנים → דמיון → דירוג → נושאים. מתחדש מכל מסך שיש בו תמונות.
  // מנעול על השרשרת כולה + מזהה-ריצה: רק השרשרת הפעילה מדווחת לתצוגה.
  useEffect(() => {
    if (!('photos' in screen)) return;
    const visible = visibleOf(screen.photos);
    if (chainRef.current.running) return;

    const pendingClassify = visible.filter((p) => p.faceCount === null).length;
    const pendingPersons = visible.filter((p) => p.personCount === null).length;
    const pendingEmbed = visible.filter((p) => p.embedding === null).length;
    const pendingScore = visible.filter((p) => p.bestShotScore === null).length;
    // הערכה עליונה — כמות הנושאים הסופית ידועה רק אחרי גלאי הדמויות
    const pendingSubject = visible.filter(
      (p) => p.subjectSig === null && ((p.personCount ?? p.faceCount) === 0 || (p.personCount ?? p.faceCount) === null),
    ).length;
    const totalOps =
      pendingClassify + pendingPersons + pendingEmbed + pendingScore + pendingSubject;
    if (totalOps === 0) return;

    // אם הריצה הקודמת הסתיימה בלי שום התקדמות (כשלים קבועים) — לא מנסים שוב לבד
    const signature = `${pendingClassify}:${pendingPersons}:${pendingEmbed}:${pendingScore}:${pendingSubject}`;
    if (signature === lastChainSignatureRef.current) return;

    chainRef.current = { running: true, id: chainRef.current.id + 1 };
    const runId = chainRef.current.id;
    const startedAt = performance.now();
    let baseOps = 0;

    const report =
      (stage: 'classify' | 'persons' | 'embed' | 'score' | 'subject') =>
      (p: { done: number; total: number }) => {
        if (chainRef.current.id !== runId) return; // ריצה ישנה — לא מדווחת
        const doneOps = baseOps + p.done;
        const percent = Math.min(99, Math.round((doneOps / totalOps) * 100));
        const elapsed = (performance.now() - startedAt) / 1000;
        const etaSeconds =
          doneOps >= 5
            ? Math.round((elapsed / doneOps) * (totalOps - doneOps))
            : Math.round((totalOps - doneOps) * ROUGH_SECONDS_PER_OP);
        setAnalysis({ stage, percent, etaSeconds });
      };

    (async () => {
      // תווית פתיחה = השלב הראשון שבאמת יש לו עבודה
      const firstStage = pendingClassify
        ? 'classify'
        : pendingPersons
          ? 'persons'
          : pendingEmbed
            ? 'embed'
            : pendingScore
              ? 'score'
              : 'subject';
      setAnalysis({
        stage: firstStage,
        percent: 0,
        etaSeconds: Math.round(totalOps * ROUGH_SECONDS_PER_OP),
      });
      try {
        try {
          await facesPending(visible, report('classify'));
        } catch {
          // הסטטוס נרשם ב-faceStatus; ממשיכים לשלב הבא
        }
        baseOps = pendingClassify;
        try {
          await personsPending(visible, report('persons'));
        } catch {
          // הסטטוס נרשם ב-personStatus; ממשיכים
        }
        baseOps += pendingPersons;
        await embedPending(visible, report('embed'));
        baseOps += pendingEmbed;
        await scorePending(visible, report('score'));
        baseOps += pendingScore;
        await subjectPending(visible, report('subject'));
      } finally {
        chainRef.current.running = false;
        if (chainRef.current.id === runId) {
          setAnalysis(null);
          // חתימת "אחרי": אם כלום לא התקדם — הריצה הבאה תדע לא לנסות שוב
          const after = visibleOf(screen.photos);
          lastChainSignatureRef.current = [
            after.filter((p) => p.faceCount === null).length,
            after.filter((p) => p.personCount === null).length,
            after.filter((p) => p.embedding === null).length,
            after.filter((p) => p.bestShotScore === null).length,
            after.filter(
              (p) =>
                p.subjectSig === null &&
                ((p.personCount ?? p.faceCount) === 0 ||
                  (p.personCount ?? p.faceCount) === null),
            ).length,
          ].join(':');
          // הודעת סיום — רק אחרי ריצה משמעותית שבאמת התקדמה
          if (totalOps >= 10 && lastChainSignatureRef.current !== signature) setDoneOpen(true);
        }
      }
    })();
  }, [screen]);

  // חלונית "התמונות נקלטו" — בכניסה הראשונה למסך הימים כשהניתוח עוד רץ
  useEffect(() => {
    if (screen.name === 'days' && analysis && !introShownRef.current) {
      introShownRef.current = true;
      setIntroOpen(true);
    }
  }, [screen, analysis]);

  // עלייה: אם יש פרויקטים — מסך הפרויקטים; אחרת מסך פתיחה (פרויקט ראשון)
  useEffect(() => {
    (async () => {
      const projects = await listProjects();
      if (projects.length === 0) {
        setScreen({ name: 'welcome' });
        return;
      }
      setScreen({ name: 'projects', projects });
    })();
  }, []);

  const refreshProjects = useCallback(async () => {
    const projects = await listProjects();
    if (projects.length === 0) setScreen({ name: 'welcome' });
    else setScreen({ name: 'projects', projects });
  }, []);

  /**
   * תמונת השער של פרויקט — "התמונה שמספרת איפה היינו", לא הפנים הכי מחייכות:
   * נוף מועדף ← נוף נבחר ← (נסיגה לאלבומים בלי נופים) מועדפת ← נבחרת ← הכי טובה.
   * בתוך כל קבוצה: עדיפות לנושא בולט (מקום איקוני), לאוריינטציה אופקית
   * (מתאימה לכרטיס), ולבסוף הציון האסתטי.
   */
  const pickCover = (photos: PhotoRecord[]): Blob | null => {
    const coverRank = (p: PhotoRecord): number =>
      (p.subjectSig && p.subjectSig.length > 0 ? 200 : 0) +
      (p.width >= p.height ? 100 : 0) +
      (p.bestShotScore ?? 0);
    const best = (pool: PhotoRecord[]) =>
      pool.length > 0 ? pool.reduce((b, p) => (coverRank(p) > coverRank(b) ? p : b)) : null;

    const landscapes = photos.filter((p) => (p.personCount ?? p.faceCount) === 0);
    const pick =
      best(landscapes.filter((p) => p.decision === 'favorite')) ??
      best(landscapes.filter((p) => p.decision === 'keep')) ??
      best(photos.filter((p) => p.decision === 'favorite')) ??
      best(photos.filter((p) => p.decision === 'keep')) ??
      best(photos) ??
      photos[0];
    return pick?.thumbnail ?? null;
  };

  /** כניסה לפרויקט: פתיחת המסד שלו, רענון כרטיס הפרויקט וטעינת הימים */
  const handleOpenProject = useCallback(async (id: string) => {
    await openProject(id);
    resetDbConnection(projectDbName(id));
    const project = await getProjectState();
    const photos = await getAllPhotos();
    if (project?.scanCompleted && photos.length > 0) {
      // עדכון שער + מונה — מכסה גם פרויקטים שהוגרו בלי מטא-דאטה
      const visible = visibleOf(photos);
      await updateProjectMeta(id, {
        photoCount: visible.length,
        coverThumb: pickCover(visible),
      });
      setScreen({ name: 'days', photos });
    } else {
      setScreen({ name: 'welcome' });
    }
  }, []);

  /** סריקה לתוך הפרויקט הפעיל (אחרי שנוצר/נפתח) */
  const runScan = useCallback(async (picked: NonNullable<Awaited<ReturnType<typeof pickLocalFolder>>>) => {
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
    // עדכון כרטיס הפרויקט: מונה + תמונת שער
    const activeId = getActiveProjectId();
    if (activeId) {
      await updateProjectMeta(activeId, {
        photoCount: photos.length,
        coverThumb: pickCover(visibleOf(photos)),
      });
    }
    // אם נמצאו חשודות — קודם מסך הניקוי
    if (suspectsOf(photos).length > 0) {
      setScreen({ name: 'cleanup', photos });
    } else {
      setScreen({ name: 'days', photos });
    }
  }, []);

  /** בחירת תיקייה לפרויקט חדש: יוצר פרויקט (שם = שם התיקייה) וסורק לתוכו */
  const handlePickFolder = useCallback(async () => {
    setError(null);
    const picked = await pickLocalFolder();
    if (!picked) return;

    const folderName = picked.handle?.name?.trim();
    // פרויקט פעיל ריק (נוצר ולא נסרק) — ממוחזר במקום ליצור עוד אחד
    const activeId = getActiveProjectId();
    let projectId = activeId;
    if (activeId) {
      const existing = await getAllPhotos().catch(() => []);
      if (existing.length > 0) projectId = null;
    }
    if (!projectId) {
      const project = await createProject(folderName || t.projectNew);
      projectId = project.id;
    } else if (folderName) {
      await updateProjectMeta(projectId, { name: folderName });
    }
    await openProject(projectId);
    resetDbConnection(projectDbName(projectId));
    await runScan(picked);
  }, [runScan]);

  /** סריקה מחדש של הפרויקט הנוכחי (דורס רק אותו) */
  const handleRescan = useCallback(async () => {
    if (!window.confirm(t.rescanConfirm)) return;
    setError(null);
    const picked = await pickLocalFolder();
    if (!picked) return;
    await runScan(picked);
  }, [runScan]);

  const handleOpenDay = useCallback((dayKey: string) => {
    setScreen((s) =>
      s.name === 'days' ? { name: 'swipe', photos: s.photos, dayKey } : s,
    );
  }, []);

  // חזרה מהסווייפ — רענון התמונות מה-DB כדי שההתקדמות תוצג בכרטיסי הימים
  const handleBackToDays = useCallback(async () => {
    const photos = await getAllPhotos();
    setScreen({ name: 'days', photos });
    // עדכון שקט של כרטיס הפרויקט (השער עשוי להשתנות עם הבחירות)
    const activeId = getActiveProjectId();
    if (activeId) {
      const visible = visibleOf(photos);
      updateProjectMeta(activeId, {
        photoCount: visible.length,
        coverThumb: pickCover(visible),
      });
    }
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

  // חיווי ניתוח רקע אחוד — אחוז רציף שרק עולה + שלב + זמן משוער
  const stageLabels = {
    classify: t.stageClassify,
    persons: t.stagePersons,
    embed: t.stageEmbed,
    score: t.stageScore,
    subject: t.stageSubject,
  } as const;
  const etaText = (seconds: number | null) =>
    seconds === null ? null : t.etaShort(Math.round(seconds / 60));
  const analysisChip = analysis ? (
    <div className="analysis-chip" dir="rtl">
      {t.analysisChipText(stageLabels[analysis.stage], analysis.percent, etaText(analysis.etaSeconds))}
    </div>
  ) : null;

  // חלוניות צפות: "התמונות נקלטו" בתחילת הניתוח, "הניתוח הושלם" בסופו
  const popup = introOpen ? (
    <div className="export-overlay" onClick={() => setIntroOpen(false)}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <button className="popup-x" onClick={() => setIntroOpen(false)} aria-label={t.popupClose}>
          ✕
        </button>
        <h2 className="export-title">{t.analysisIntroTitle}</h2>
        <p className="export-warning">
          {t.analysisIntroBody(etaText(analysis?.etaSeconds ?? null) ?? t.etaShort(2))}
        </p>
        <button className="btn-primary" onClick={() => setIntroOpen(false)}>
          {t.popupStart}
        </button>
      </div>
    </div>
  ) : doneOpen ? (
    <div className="export-overlay" onClick={() => setDoneOpen(false)}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <button className="popup-x" onClick={() => setDoneOpen(false)} aria-label={t.popupClose}>
          ✕
        </button>
        <div className="export-done-emoji" aria-hidden>✨</div>
        <h2 className="export-title">{t.analysisDoneTitle}</h2>
        <p className="export-warning">{t.analysisDoneBody}</p>
        <button className="btn-primary" onClick={() => setDoneOpen(false)}>
          {t.popupClose}
        </button>
      </div>
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
          onOpenProjects={refreshProjects}
          onRescan={handleRescan}
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
            onOpenProjects={refreshProjects}
            onRescan={handleRescan}
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
    case 'projects':
      return (
        <Projects
          projects={screen.projects}
          onOpen={handleOpenProject}
          onCreate={() => {
            setActiveProjectId(null);
            setScreen({ name: 'welcome' });
          }}
          onChanged={refreshProjects}
        />
      );
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
      {popup}
    </>
  );
}
