import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('grid route paths use their full bounds as click targets', async () => {
  const css = await readFile('src/styles/index.css', 'utf8');

  assert.match(
    css,
    /\.grid-svg path\s*\{[^}]*pointer-events:\s*bounding-box;/s
  );
});
