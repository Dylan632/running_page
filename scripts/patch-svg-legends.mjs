import fs from 'node:fs';
import path from 'node:path';

const ASSETS_DIR = path.resolve('assets');
const SVG_FILES = ['github.svg', 'grid.svg'];

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function getSvgHeight(svg) {
  const viewBoxMatch = svg.match(/viewBox="[^"]*?,[^"]*?,[^"]*?,\s*([0-9.]+)"/);
  if (viewBoxMatch) return Number(viewBoxMatch[1]);

  const heightMatch = svg.match(/height="([0-9.]+)(?:mm)?"/);
  if (heightMatch) return Number(heightMatch[1]);

  return 300;
}

function getNumericAttr(tag, attr) {
  const match = tag.match(new RegExp(`${attr}="(-?[0-9.]+)`));
  return match ? Number(match[1]) : null;
}

function isCyclingSvg(svg) {
  const mode = process.env.VITE_ACTIVITY_MODE || '';
  return (
    mode.toLowerCase() === 'cycling' ||
    svg.includes('Cycling') ||
    svg.includes('Rides') ||
    svg.includes('Cyclist')
  );
}

function isHeatmapFile(filePath) {
  return path.basename(filePath).startsWith('github');
}

function legendLines(filePath, svg) {
  const cycling = isCyclingSvg(svg);
  const heatmap = isHeatmapFile(filePath);

  if (cycling && heatmap) {
    return [
      { text: 'Heatmap: Blue <20km', fill: '#FFFFFF' },
      { text: 'Orange: 20-50km', fill: '#ffa400' },
      { text: 'Red: >50km', fill: '#ff0000' },
    ];
  }

  if (cycling && !heatmap) {
    return [
      { text: 'Routes: Over 10km', fill: '#FFFFFF' },
      { text: 'Blue 10-20 / Orange 20-50', fill: '#FFFFFF' },
      { text: 'Red >50km', fill: '#ff0000' },
    ];
  }

  if (!cycling && heatmap) {
    return [
      { text: 'Heatmap: Blue <10km', fill: '#FFFFFF' },
      { text: 'Orange: 10-21.1km', fill: '#ffa400' },
      { text: 'Red: >21.1km', fill: '#ff0000' },
    ];
  }

  return [
    { text: 'Routes: Over 10km', fill: '#FFFFFF' },
    { text: 'Orange: 10-21.1km', fill: '#ffa400' },
    { text: 'Red: >21.1km', fill: '#ff0000' },
  ];
}

function removeFooterLegend(svg, height) {
  const footerStart = height - 28;

  return svg.replace(/<(text|rect)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/g, (tag, tagName) => {
    const y = getNumericAttr(tag, 'y');
    if (y === null || y < footerStart) return tag;

    // Only remove the compact footer/status area. Route paths are polylines and
    // heatmap cells above the footer are outside this y range.
    if (tagName === 'text') return '';

    const x = getNumericAttr(tag, 'x');
    if (x !== null && x >= 55 && x <= 75) return '';
    return tag;
  });
}

function addThreeLineLegend(svg, filePath) {
  const height = getSvgHeight(svg);
  const yValues = [height - 18, height - 11, height - 4];
  const lines = legendLines(filePath, svg)
    .map((line, index) => {
      const escaped = line.text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      return `<text fill="${line.fill}" style="font-size:4px; font-family:Arial;" x="10" y="${yValues[index]}">${escaped}</text>`;
    })
    .join('');

  return svg.replace('</svg>', `${lines}</svg>`);
}

function patchSvg(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const height = getSvgHeight(original);
  const withoutFooter = removeFooterLegend(original, height);
  const patched = addThreeLineLegend(withoutFooter, filePath);

  if (patched !== original) {
    fs.writeFileSync(filePath, patched, 'utf8');
    console.log(`Patched SVG legend: ${path.relative(process.cwd(), filePath)}`);
  }
}

const candidates = readDirSafe(ASSETS_DIR)
  .filter((name) => SVG_FILES.includes(name) || /^github_\d{4}\.svg$/.test(name))
  .map((name) => path.join(ASSETS_DIR, name));

for (const filePath of candidates) {
  patchSvg(filePath);
}
