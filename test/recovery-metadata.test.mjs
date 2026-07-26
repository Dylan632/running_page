import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let vite;

before(async () => {
  vite = await createServer({
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
});

after(async () => {
  await vite?.close();
});

const renderInActivityRoute = async (mode, element) => {
  const { ActivityModeProvider } = await vite.ssrLoadModule(
    '/src/modules/activity/ActivityModeProvider.tsx'
  );

  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: [`/${mode}`] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/:activityMode',
          element: React.createElement(ActivityModeProvider, null, element),
        })
      )
    )
  );
};

test('an empty activity snapshot renders a visible terminal state', async () => {
  const { default: RunTable } = await vite.ssrLoadModule(
    '/src/components/RunTable/index.tsx'
  );
  const html = await renderInActivityRoute(
    'cycling',
    React.createElement(RunTable, {
      runs: [],
      locateActivity: () => {},
      runIndex: -1,
      setRunIndex: () => {},
    })
  );
  const dom = new JSDOM(html);

  try {
    const emptyState = dom.window.document.querySelector(
      'tbody [data-empty-state]'
    );
    assert.ok(emptyState);
    assert.match(emptyState.textContent ?? '', /暂无骑行记录/);
  } finally {
    dom.window.close();
  }
});

test('each activity route exposes one absolute canonical URL', async () => {
  const { createSiteMetadata } = await vite.ssrLoadModule(
    '/src/static/site-metadata.ts'
  );
  const { getActivityProfile } = await vite.ssrLoadModule(
    '/src/modules/activity/profiles.ts'
  );

  const running = createSiteMetadata(getActivityProfile('running'));
  const cycling = createSiteMetadata(getActivityProfile('cycling'));

  assert.equal(
    running.canonicalUrl,
    'https://running-page-zeta-lake.vercel.app/running'
  );
  assert.equal(
    cycling.canonicalUrl,
    'https://running-page-zeta-lake.vercel.app/cycling'
  );
  assert.notEqual(running.canonicalUrl, cycling.canonicalUrl);
});
