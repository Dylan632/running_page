import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './style.module.css';

export const SPOTIFY_PLAYLIST_ID = '1r8NqobH79G9YEA3Iobx4a';
export const SPOTIFY_PLAYLIST_URL = `https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}`;
export const SPOTIFY_EMBED_URL = `https://open.spotify.com/embed/playlist/${SPOTIFY_PLAYLIST_ID}`;

const PANEL_ID = 'spotify-player-panel';

const MusicPlayer = () => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const closeAndRestoreFocus = useCallback(() => {
    setIsOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndRestoreFocus();
    };

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePress);

    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePress);
    };
  }, [closeAndRestoreFocus, isOpen]);

  const toggleLabel = isOpen ? 'Close cycling music' : 'Open cycling music';

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={toggleRef}
        type="button"
        className={`${styles.toggle} ${isOpen ? styles.toggleOpen : ''}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-label={toggleLabel}
        aria-expanded={isOpen}
        aria-controls={PANEL_ID}
        title={toggleLabel}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M9 18V5L19 3V16"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="6"
            cy="18"
            r="3"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <circle
            cx="16"
            cy="16"
            r="3"
            stroke="currentColor"
            strokeWidth="1.7"
          />
        </svg>
      </button>

      <section
        id={PANEL_ID}
        className={`${styles.panel} ${isOpen ? styles.panelOpen : ''}`}
        aria-label="Ride Beats Spotify player"
        aria-hidden={!isOpen}
      >
        <div className={styles.panelHeader}>
          <p className={styles.title}>Ride Beats</p>
          <button
            type="button"
            className={styles.closeButton}
            onClick={closeAndRestoreFocus}
            aria-label="Close cycling music"
            title="Close cycling music"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M6 6L18 18M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <iframe
          className={styles.player}
          title="Cycling & Spinning Music 2026"
          src={SPOTIFY_EMBED_URL}
          width="100%"
          height={152}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />

        <a
          className={styles.fallbackLink}
          href={SPOTIFY_PLAYLIST_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in Spotify
          <span aria-hidden="true">↗</span>
        </a>
      </section>
    </div>
  );
};

export default MusicPlayer;
