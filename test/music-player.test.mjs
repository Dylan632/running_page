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

  assert.ok(html.includes('aria-label="Open cycling music"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('aria-controls="spotify-player-panel"'));
  assert.ok(
    html.includes(
      'https://open.spotify.com/embed/playlist/1r8NqobH79G9YEA3Iobx4a'
    )
  );
  assert.ok(
    html.includes('https://open.spotify.com/playlist/1r8NqobH79G9YEA3Iobx4a')
  );
  assert.ok(html.includes('title="Cycling &amp; Spinning Music 2026"'));
});
