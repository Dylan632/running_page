import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

test('grid route paths use their full bounds as click targets', async () => {
  const css = await readFile('src/styles/index.css', 'utf8');

  assert.match(
    css,
    /\.grid-svg path\s*\{[^}]*pointer-events:\s*bounding-box;/s
  );
});

test('grid special-track legends stay filled while routes stay stroked', async () => {
  const [css, svg, viteConfig, metadataText] = await Promise.all([
    readFile('src/styles/index.css', 'utf8'),
    readFile('assets/cycling/grid.svg', 'utf8'),
    readFile('vite.config.ts', 'utf8'),
    readFile('public/data/cycling/metadata.json', 'utf8'),
  ]);
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  const metadataIds = new Set(
    JSON.parse(metadataText).map((activity) => activity.run_id)
  );
  const legends = [
    ...dom.window.document.querySelectorAll(
      '[data-poster-role="legend-swatch"]'
    ),
  ];
  assert.equal(legends.length, 2);
  for (const legend of legends) {
    assert.equal(legend.tagName.toLowerCase(), 'rect');
    assert.equal(legend.getAttribute('width'), '2.6');
    assert.equal(legend.getAttribute('height'), '2.6');
    assert.equal(legend.getAttribute('stroke'), 'none');
    assert.equal(legend.classList.contains('svg-special-fill'), true);
    assert.equal(legend.classList.contains('svg-special-stroke'), false);
  }

  const routes = [
    ...dom.window.document.querySelectorAll('[data-poster-role="route"]'),
  ];
  assert.ok(routes.length > 0);
  for (const route of routes) {
    const descId = route.querySelector('desc')?.textContent;
    assert.equal(route.getAttribute('fill'), 'none');
    assert.equal(route.classList.contains('svg-special-fill'), false);
    assert.equal(route.classList.contains('svg-special-stroke'), true);
    assert.equal(route.getAttribute('data-run-id'), descId);
    assert.equal(
      metadataIds.has(descId),
      true,
      `poster activity ${descId} must exist losslessly in public metadata`
    );
  }

  assert.match(
    css,
    /\.svg-special-color\.svg-special-fill\s*\{[^}]*fill:\s*var\(--svg-special-color\);[^}]*stroke:\s*none;/s
  );
  assert.match(
    css,
    /\.svg-special-color2\.svg-special-fill\s*\{[^}]*fill:\s*var\(--svg-special-color2\);[^}]*stroke:\s*none;/s
  );
  assert.doesNotMatch(viteConfig, /addClassesByFillColor|colorClassMapping/);
  await assert.rejects(readFile('src/utils/colorUtils.ts', 'utf8'), {
    code: 'ENOENT',
  });
  dom.window.close();
});
