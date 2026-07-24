import { useT } from '../i18n';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import './Welcome.css';

interface WelcomeProps {
  onPickFolder: () => void;
  error: string | null;
}

export function Welcome({ onPickFolder, error }: WelcomeProps) {
  const t = useT();

  return (
    <div className="screen welcome">
      <div className="welcome-topbar">
        <ThemeSwitcher />
      </div>
      <div className="welcome-content">
        <div className="welcome-logo" aria-hidden>
          📖✨
        </div>
        <h1 className="welcome-title">{t.appName}</h1>
        <p className="welcome-tagline">{t.tagline}</p>
        <p className="welcome-subtagline">{t.subTagline}</p>

        <div className="welcome-actions">
          <button className="btn-primary" onClick={onPickFolder}>
            {t.chooseFolder}
          </button>
          <button className="btn-ghost" disabled>
            {t.googleDrive}
            <span className="badge-soon">{t.comingSoon}</span>
          </button>
        </div>

        {error && <p className="welcome-error">{error}</p>}

        <p className="welcome-privacy">🔒 {t.privacyNote}</p>
      </div>
    </div>
  );
}
