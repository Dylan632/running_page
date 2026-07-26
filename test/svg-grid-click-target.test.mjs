import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
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

test('grid route paths use their full bounds as click targets', async () => {
  const css = await readFile('src/styles/index.css', 'utf8');

  assert.match(
    css,
    /\.grid-svg path\s*\{[^}]*pointer-events:\s*bounding-box;/s
  );
});

test('grid special-track legends stay filled while routes stay stroked', async () => {
  const { updateSvgSpecialColors } = await vite.ssrLoadModule(
    '/src/utils/colorUtils.ts'
  );
  const css = await readFile('src/styles/index.css', 'utf8');
  const dom = new JSDOM(`
    <svg class="grid-svg">
      <path id="orange-legend" fill="#ffa400" d="M0 0h3v3H0z" />
      <path id="red-legend" fill="#ff0000" d="M0 4h3v3H0z" />
      <path id="orange-route" fill="none" stroke="#ffa400" d="M10 0h10" />
      <path id="red-route" fill="none" stroke="#ff0000" d="M10 4h10" />
      <path id="ordinary-route" fill="none" stroke="#999999" d="M10 8h10" />
    </svg>
  `);
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });

  try {
    updateSvgSpecialColors();

    for (const id of ['orange-legend', 'red-legend']) {
      const legend = dom.window.document.querySelector(`#${id}`);
      assert.ok(legend);
      assert.equal(legend.classList.contains('svg-special-fill'), true);
      assert.equal(legend.classList.contains('svg-special-stroke'), false);
    }

    for (const id of ['orange-route', 'red-route']) {
      const route = dom.window.document.querySelector(`#${id}`);
      assert.ok(route);
      assert.equal(route.classList.contains('svg-special-fill'), false);
      assert.equal(route.classList.contains('svg-special-stroke'), true);
    }

    const ordinaryRoute = dom.window.document.querySelector('#ordinary-route');
    assert.ok(ordinaryRoute);
    assert.equal(ordinaryRoute.classList.length, 0);

    assert.match(
      css,
      /\.svg-special-color\.svg-special-fill\s*\{[^}]*fill:\s*var\(--svg-special-color\);[^}]*stroke:\s*none;/s
    );
    assert.match(
      css,
      /\.svg-special-color2\.svg-special-fill\s*\{[^}]*fill:\s*var\(--svg-special-color2\);[^}]*stroke:\s*none;/s
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
    if (previousDocument === undefined) delete globalThis.document;
    else {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument,
      });
    }
    dom.window.close();
  }
});
