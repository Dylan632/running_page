import {
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import MusicPlayer from '@/components/MusicPlayer';
import useSiteMetadata from '@/hooks/useSiteMetadata';
import { useTheme, Theme } from '@/hooks/useTheme';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import type { ActivityMode } from '@/modules/activity/profiles';
import styles from './style.module.css';

const MODE_PENDING_ATTRIBUTE = 'data-mode-pending';

const clearModeFeedback = (container: HTMLElement | null) => {
  container
    ?.querySelectorAll<HTMLElement>(`[${MODE_PENDING_ATTRIBUTE}]`)
    .forEach((link) => link.removeAttribute(MODE_PENDING_ATTRIBUTE));
};

const Header = () => {
  const { logo, activityLinks, profileUrl, navLinks } = useSiteMetadata();
  const { hrefForMode, mode } = useActivityMode();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const activitySwitchRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    clearModeFeedback(activitySwitchRef.current);
  }, [location.key]);

  const handleActivityClick = (
    event: MouseEvent<HTMLAnchorElement>,
    targetMode: ActivityMode
  ) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.currentTarget.target !== '' &&
        event.currentTarget.target !== '_self')
    ) {
      return;
    }

    clearModeFeedback(activitySwitchRef.current);
    if (targetMode !== mode) {
      // React Router deliberately schedules route work as a transition. Mark
      // the target synchronously so a busy render cannot delay user feedback.
      event.currentTarget.setAttribute(MODE_PENDING_ATTRIBUTE, 'true');
    }
  };

  const icons: Record<Theme, ReactElement> = {
    dark: (
      <svg
        width="22"
        height="23"
        viewBox="0 0 22 23"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M21.7519 15.0137C20.597 15.4956 19.3296 15.7617 18 15.7617C12.6152 15.7617 8.25 11.3965 8.25 6.01171C8.25 4.68211 8.51614 3.41468 8.99806 2.25977C5.47566 3.72957 3 7.20653 3 11.2617C3 16.6465 7.36522 21.0117 12.75 21.0117C16.8052 21.0117 20.2821 18.536 21.7519 15.0137Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    light: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 3.00464V5.25464M18.364 5.64068L16.773 7.23167M21 12.0046H18.75M18.364 18.3686L16.773 16.7776M12 18.7546V21.0046M7.22703 16.7776L5.63604 18.3686M5.25 12.0046H3M7.22703 7.23167L5.63604 5.64068M15.75 12.0046C15.75 14.0757 14.0711 15.7546 12 15.7546C9.92893 15.7546 8.25 14.0757 8.25 12.0046C8.25 9.93357 9.92893 8.25464 12 8.25464C14.0711 8.25464 15.75 9.93357 15.75 12.0046Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  };

  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';

  const handleToggle = () => {
    setTheme(nextTheme);
  };

  return (
    <>
      <nav className="running-header mx-auto mt-4 flex w-full max-w-7xl flex-col items-center justify-between gap-4 px-4 md:mt-12 md:flex-row md:gap-0 md:px-6 lg:px-16">
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:gap-4">
          <a
            className="running-brand flex min-h-11 items-center gap-3 md:gap-4"
            href={profileUrl}
          >
            <picture>
              <img
                className="h-11 w-11 rounded-full md:h-16 md:w-16"
                alt="logo"
                src={logo}
              />
            </picture>
            <span className="running-brand-name">Dylan</span>
          </a>
          <nav
            ref={activitySwitchRef}
            className={styles.activitySwitch}
            aria-label="运动类型"
          >
            {activityLinks.map((activity) => {
              const destination = hrefForMode(activity.mode);

              return (
                <NavLink
                  key={activity.mode}
                  className={({ isActive, isPending }) =>
                    `${styles.activityLink} ${
                      isActive || isPending ? styles.activityLinkActive : ''
                    }`
                  }
                  onClick={(event) => handleActivityClick(event, activity.mode)}
                  to={destination}
                >
                  {activity.name}
                </NavLink>
              );
            })}
          </nav>
        </div>
        <div className="flex w-full items-center justify-end gap-3 text-right md:w-auto">
          <Link
            to={`/${mode}/summary`}
            className="running-header-link inline-flex min-h-11 min-w-11 items-center justify-center text-lg lg:text-base"
          >
            趋势
          </Link>
          {navLinks.map((n) => (
            <a
              key={n.url}
              href={n.url}
              className="running-header-link inline-flex min-h-11 items-center text-lg lg:text-base"
            >
              {n.name}
            </a>
          ))}
          <MusicPlayer />
          <div className="ml-1 flex items-center space-x-2">
            <button
              type="button"
              onClick={handleToggle}
              className={`${styles.themeButton} ${styles.themeButtonActive}`}
              aria-label={`Switch to ${nextTheme} theme`}
              title={`Switch to ${nextTheme} theme`}
            >
              <div className={styles.iconWrapper}>{icons[theme]}</div>
            </button>
          </div>
        </div>
      </nav>
    </>
  );
};

export default Header;
