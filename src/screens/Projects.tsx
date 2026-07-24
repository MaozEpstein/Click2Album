import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import {
  ARCHIVE_RETENTION_MS,
  archiveProject,
  deleteProject,
  listArchivedProjects,
  renameProject,
  restoreProject,
  type ProjectMeta,
} from '../lib/projects';
import { useObjectUrl } from '../lib/useObjectUrl';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import './Projects.css';

interface ProjectsProps {
  projects: ProjectMeta[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onChanged: () => void;
}

const dateFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' });

function ProjectCard({
  project,
  index,
  onOpen,
  onChanged,
}: {
  project: ProjectMeta;
  index: number;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const coverUrl = useObjectUrl(project.coverThumb);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const cardRef = useRef<HTMLDivElement>(null);

  // tilt תלת-ממדי עדין בעקבות העכבר — נכתב ישירות ל-DOM בלי re-render
  const handleTilt = (e: React.MouseEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-py * 6).toFixed(2)}deg) rotateY(${(px * 6).toFixed(2)}deg) translateY(-3px)`;
  };

  const resetTilt = () => {
    const el = cardRef.current;
    if (el) el.style.transform = '';
  };

  const commitRename = async () => {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) {
      await renameProject(project.id, trimmed);
      onChanged();
    } else {
      setName(project.name);
    }
  };

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(t.projectArchiveConfirm(project.name))) return;
    await archiveProject(project.id);
    onChanged();
  };

  return (
    <div
      ref={cardRef}
      className="project-card"
      style={{ animationDelay: `${Math.min(index * 70, 500)}ms` }}
      onClick={onOpen}
      onMouseMove={handleTilt}
      onMouseLeave={resetTilt}
      role="button"
    >
      <div className="project-cover">
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="project-cover-empty" aria-hidden>
            📷
          </div>
        )}
        <div className="project-cover-overlay" />
        <button
          className="project-delete"
          onClick={handleArchive}
          aria-label={t.projectDelete}
          title={t.projectDelete}
        >
          🗑
        </button>
      </div>
      <div className="project-info">
        {renaming ? (
          <input
            className="project-name-input"
            value={name}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setName(project.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span
            className="project-name"
            title={t.projectRename}
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
          >
            {project.name}
          </span>
        )}
        <span className="project-meta">
          {project.photoCount > 0 ? `${t.photosInDay(project.photoCount)} · ` : ''}
          {t.projectLastOpened(dateFormatter.format(project.lastOpenedAt))}
        </span>
      </div>
    </div>
  );
}

/** כרטיס בארכיון: שחזור או מחיקה לצמיתות */
function ArchivedCard({
  project,
  index,
  onChanged,
}: {
  project: ProjectMeta;
  index: number;
  onChanged: () => void;
}) {
  const t = useT();
  const coverUrl = useObjectUrl(project.coverThumb);
  const daysLeft = Math.max(
    0,
    Math.ceil(((project.archivedAt ?? 0) + ARCHIVE_RETENTION_MS - Date.now()) / 86_400_000),
  );

  return (
    <div className="project-card project-card-archived" style={{ animationDelay: `${Math.min(index * 70, 500)}ms` }}>
      <div className="project-cover">
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="project-cover-empty" aria-hidden>
            📷
          </div>
        )}
        <div className="project-cover-overlay" />
      </div>
      <div className="project-info">
        <span className="project-name project-name-static">{project.name}</span>
        <span className="project-meta">{t.archiveDaysLeft(daysLeft)}</span>
        <div className="archive-actions">
          <button
            className="btn-primary archive-btn"
            onClick={async () => {
              await restoreProject(project.id);
              onChanged();
            }}
          >
            {t.archiveRestore}
          </button>
          <button
            className="btn-ghost archive-btn archive-btn-danger"
            onClick={async () => {
              if (!window.confirm(t.archiveDeleteConfirm(project.name))) return;
              await deleteProject(project.id);
              onChanged();
            }}
          >
            {t.archiveDeleteForever}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Projects({ projects, onOpen, onCreate, onChanged }: ProjectsProps) {
  const t = useT();
  const [storageUsed, setStorageUsed] = useState<string | null>(null);
  const [archiveView, setArchiveView] = useState(false);
  const [archived, setArchived] = useState<ProjectMeta[]>([]);

  useEffect(() => {
    listArchivedProjects().then(setArchived);
  }, [projects, archiveView]);

  useEffect(() => {
    navigator.storage?.estimate?.().then((estimate) => {
      if (estimate.usage) {
        const gb = estimate.usage / 1024 ** 3;
        setStorageUsed(gb >= 1 ? `${gb.toFixed(1)}GB` : `${Math.round(estimate.usage / 1024 ** 2)}MB`);
      }
    });
  }, [projects]);

  if (archiveView) {
    return (
      <div className="screen projects">
        <header className="projects-header">
          <div>
            <h1 className="projects-title">{t.archiveTitle}</h1>
            <p className="projects-subtitle">{t.archiveSubtitle}</p>
          </div>
          <div className="projects-header-actions">
            <button className="btn-ghost" onClick={() => setArchiveView(false)}>
              {t.backToProjects}
            </button>
            <ThemeSwitcher />
          </div>
        </header>
        {archived.length === 0 ? (
          <p className="archive-empty">{t.archiveEmpty}</p>
        ) : (
          <div className="projects-grid">
            {archived.map((project, i) => (
              <ArchivedCard
                key={project.id}
                project={project}
                index={i}
                onChanged={() => {
                  listArchivedProjects().then(setArchived);
                  onChanged();
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="screen projects">
      <header className="projects-header">
        <div>
          <h1 className="projects-title">{t.projectsTitle}</h1>
          <p className="projects-subtitle">{t.projectsSubtitle}</p>
        </div>
        <div className="projects-header-actions">
          <button className="btn-ghost" onClick={() => setArchiveView(true)}>
            {t.archiveTitle}
            {archived.length > 0 ? ` · ${archived.length}` : ''}
          </button>
          <ThemeSwitcher />
        </div>
      </header>

      <div className="projects-grid">
        <button
          className="project-card project-card-new"
          onClick={onCreate}
          style={{ animationDelay: '0ms' }}
        >
          <span className="project-new-plus" aria-hidden>
            +
          </span>
          <span className="project-new-label">{t.projectNew}</span>
        </button>
        {projects.map((project, i) => (
          <ProjectCard
            key={project.id}
            project={project}
            index={i + 1}
            onOpen={() => onOpen(project.id)}
            onChanged={onChanged}
          />
        ))}
      </div>

      {storageUsed && (
        <footer className="projects-footer">{t.projectsStorage(storageUsed)}</footer>
      )}
    </div>
  );
}
