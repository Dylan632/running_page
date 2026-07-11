# Spotify Playlist Player Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an accessible, responsive Spotify playlist player to the cycling page header without obscuring the map controls.

**Architecture:** A self-contained `MusicPlayer` React component owns only its open/closed state and keeps the Spotify iframe mounted so playback can continue while the panel is collapsed. `Header` renders the component beside the theme toggle; a CSS module supplies the desktop popover and mobile bottom-card layouts.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vite 8, Node built-in test runner, Spotify Embed iframe.

---

### Task 1: Add the failing component contract test

**Files:**
- Create: `test/music-player.test.mjs`

**Step 1: Write the failing test**

Create a Node test that starts Vite in middleware mode, SSR-loads the future TSX component, renders it with `react-dom/server`, and checks the public contract:

```js
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;

before(async () => {
  vite = await createServer({
    appType: 'custom',
    server: { middlewareMode: true },
  });
});

after(async () => {
  await vite?.close();
});

test('renders the collapsed Spotify cycling playlist player contract', async () => {
  const { default: MusicPlayer } = await vite.ssrLoadModule(
    '/src/components/MusicPlayer/index.tsx'
  );
  const html = renderToStaticMarkup(React.createElement(MusicPlayer));

  assert.match(html, /aria-label="Open cycling music"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="spotify-player-panel"/);
  assert.match(
    html,
    /https:\/\/open\.spotify\.com\/embed\/playlist\/1r8NqobH79G9YEA3Iobx4a/
  );
  assert.match(
    html,
    /https:\/\/open\.spotify\.com\/playlist\/1r8NqobH79G9YEA3Iobx4a/
  );
  assert.match(html, /title="Cycling &amp; Spinning Music 2026"/);
});
```

**Step 2: Run the test to verify it fails**

Run: `node --test test/music-player.test.mjs`

Expected: FAIL because `src/components/MusicPlayer/index.tsx` does not exist.

**Step 3: Commit the red test**

```bash
git add test/music-player.test.mjs
git commit -m "test: define Spotify player contract"
```

### Task 2: Implement the player component and responsive shell

**Files:**
- Create: `src/components/MusicPlayer/index.tsx`
- Create: `src/components/MusicPlayer/style.module.css`

**Step 1: Implement the minimal React component**

The component must:

- export the cycling playlist URLs as constants;
- render a 40px music button with `aria-expanded` and `aria-controls`;
- always render the iframe so collapsing does not unmount playback;
- toggle on button click;
- close on `Escape`, outside pointer press, or the internal close button;
- include a fallback link to the original Spotify playlist;
- avoid an autoplay query parameter.

Core structure:

```tsx
import { useEffect, useRef, useState } from 'react';
import styles from './style.module.css';

export const SPOTIFY_PLAYLIST_ID = '1r8NqobH79G9YEA3Iobx4a';
export const SPOTIFY_PLAYLIST_URL =
  `https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}`;
export const SPOTIFY_EMBED_URL =
  `https://open.spotify.com/embed/playlist/${SPOTIFY_PLAYLIST_ID}`;

const PANEL_ID = 'spotify-player-panel';

const MusicPlayer = () => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
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
  }, [isOpen]);

  return (
    <div ref={rootRef} className={styles.root}>
      {/* accessible toggle, persistent panel, iframe, fallback link */}
    </div>
  );
};

export default MusicPlayer;
```

**Step 2: Add CSS-module styling**

Implement:

- a 40px circular button matching the theme control;
- a desktop panel positioned under the button, width `min(380px, calc(100vw - 2rem))`;
- hidden state with `opacity: 0`, `visibility: hidden`, and `pointer-events: none` rather than conditional rendering;
- open state with visible opacity and pointer events;
- a 152px-high, full-width Spotify iframe;
- existing `--kami-*` theme variables for shell, border, text, and shadow;
- under 768px, a fixed bottom card with 12px side/safe-area spacing.

**Step 3: Run the focused test**

Run: `node --test test/music-player.test.mjs`

Expected: PASS.

**Step 4: Run formatting on the new files**

Run: `pnpm exec prettier --write test/music-player.test.mjs src/components/MusicPlayer/index.tsx src/components/MusicPlayer/style.module.css`

Expected: all three files formatted successfully.

**Step 5: Re-run the focused test**

Run: `node --test test/music-player.test.mjs`

Expected: PASS after formatting.

**Step 6: Commit**

```bash
git add test/music-player.test.mjs src/components/MusicPlayer
git commit -m "feat: add Spotify playlist player"
```

### Task 3: Integrate the player into the header

**Files:**
- Modify: `src/components/Header/index.tsx`

**Step 1: Add the component to the navigation controls**

Import `MusicPlayer` and render it immediately before the existing theme button group. Preserve the current `Github`, `About`, and theme controls.

```tsx
import MusicPlayer from '@/components/MusicPlayer';

// inside the right-side navigation controls
<MusicPlayer />
<div className="ml-1 flex items-center space-x-2">
  {/* existing theme button */}
</div>
```

**Step 2: Run the focused test and production build**

Run: `node --test test/music-player.test.mjs`

Expected: PASS.

Run: `pnpm run build`

Expected: Vite production build succeeds with no TypeScript or bundling errors.

**Step 3: Run repository checks**

Run: `pnpm run check`

Expected: Prettier reports all matched files formatted.

Run: `pnpm run lint`

Expected: ESLint completes successfully; inspect `git diff` afterward because this script uses `--fix`.

**Step 4: Commit the integration**

```bash
git add src/components/Header/index.tsx
git commit -m "feat: show music control in cycling header"
```

### Task 4: Verify interaction and responsive rendering

**Files:**
- No source files expected; only fix defects discovered by verification.

**Step 1: Start the local production preview**

Run: `pnpm exec vite preview --host 127.0.0.1`

Expected: preview server reports a local URL.

**Step 2: Verify desktop behavior in a real browser**

Check all of the following:

- the music button appears between `About` and the theme button;
- initial `aria-expanded` is `false`;
- clicking opens the compact player without moving or covering map controls;
- iframe source is the selected cycling playlist;
- clicking outside and pressing `Escape` each collapse the panel;
- the fallback link opens the original Spotify playlist;
- light and dark themes keep the outer card legible.

**Step 3: Verify narrow-screen behavior**

At a viewport no wider than 768px, confirm the card becomes a near-full-width bottom panel with 12px side spacing and no horizontal overflow.

**Step 4: Run the full final gate**

Run: `node --test test/music-player.test.mjs && pnpm run check && pnpm run build`

Expected: every command succeeds.

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intentional files appear.

### Task 5: Publish and verify GitHub Pages

**Files:**
- No source changes expected.

**Step 1: Push the completed commits**

Run: `git push origin master`

Expected: `master` advances on `Dylan632/cycling_page`.

**Step 2: Verify deployment**

Open `https://dylan632.github.io/cycling_page/` after the Pages workflow completes and repeat the essential smoke checks: visible music button, expandable Spotify player, working close behavior, and unchanged map controls.

**Step 3: Record the final evidence**

Capture the pushed commit SHA, successful local commands, workflow/deployment status, and live-page DOM or screenshot evidence before marking the task complete.

