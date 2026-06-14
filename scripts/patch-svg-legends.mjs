import fs from 'node:fs';
import path from 'node:path';

const ASSETS_DIR = path.resolve('assets');
const SVG_FILES = ['github.svg', 'grid.svg'];
const EXTRA_FOOTER_HEIGHT = 28;
const PATCH_GROUP_ID = 'legend-patch-footer';

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function getSvgSize(svg) {
  const viewBoxMatch = svg.match(/viewBox="\s*([\-0-9.]+)[,\s]+([\-0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)\s*"/);
  if (viewBoxMatch) {
    return {
      minX: Number(viewBoxMatch[1]),
      minY: Number(viewBoxMatch[2]),
      width: Number(viewBoxMatch[3]),
      height: Number(viewBoxMatch[4]),
      source: 'viewBox',
    };
  }

  const widthMatch = svg.match(/\bwidth="([0-9.]+)([a-z%]*)"/i);
  const heightMatch = svg.match(/\bheight="([0-9.]+)([a-z%]*)"/i);

  return {
    minX: 0,
    minY: 0,
    width: widthMatch ? Number(widthMatch[1]) : 300,
    height: heightMatch ? Number(heightMatch[1]) : 300,
    source: 'size',
  };
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function getNumericAttr(tag, attr) {
  const match = tag.match(new RegExp(`${attr}="(-?[0-9.]+)`));
  return match ? Number(match[1]) : null;
}

function stripExistingPatch(svg) {
  return svg.replace(new RegExp(`<g[^>]*id="${PATCH_GROUP_ID}"[\\s\\S]*?<\\/g>`, 'g'), '');
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

function removeOriginalFooter(svg, height) {
  const footerStart = height - 34;

  return svg.replace(/<(text|rect)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/g, (tag, tagName) => {
    const y = getNumericAttr(tag, 'y');
    if (y === null || y < footerStart) return tag;

    if (tagName === 'text') return '';

    const x = getNumericAttr(tag, 'x');
    if (x !== null && x >= 0 && x <= 90) return '';
    return tag;
  });
}

function extendCanvas(svg, size) {
  const nextHeight = size.height + EXTRA_FOOTER_HEIGHT;
  let patched = svg;

  if (patched.match(/viewBox="\s*[\-0-9.]+[,\s]+[\-0-9.]+[,\s]+[0-9.]+[,\s]+[0-9.]+\s*"/)) {
    patched = patched.replace(
      /viewBox="\s*([\-0-9.]+)[,\s]+([\-0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)\s*"/,
      `viewBox="$1 $2 $3 ${formatNumber(nextHeight)}"`
    );
  }

  patched = patched.replace(/\bheight="([0-9.]+)([a-z%]*)"/i, (_match, _height, unit) => {
    return `height="${formatNumber(nextHeight)}${unit || ''}"`;
  });

  return patched;
}

function escapeText(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function addDetachedLegend(svg, filePath, size) {
  const top = size.height + 7;
  const yValues = [top, top + 8, top + 16];
  const lines = legendLines(filePath, svg)
    .map((line, index) => {
      return `<text fill="${line.fill}" style="font-size:4px; font-family:Arial;" x="10" y="${yValues[index]}">${escapeText(line.text)}</text>`;
    })
    .join('');

  const group = `<g id="${PATCH_GROUP_ID}">${lines}</g>`;
  return svg.replace('</svg>', `${group}</svg>`);
}

function patchSvg(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const withoutPreviousPatch = stripExistingPatch(original);
  const size = getSvgSize(withoutPreviousPatch);
  const withoutFooter = removeOriginalFooter(withoutPreviousPatch, size.height);
  const expanded = extendCanvas(withoutFooter, size);
  const patched = addDetachedLegend(expanded, filePath, size);

  if (patched !== original) {
    fs.writeFileSync(filePath, patched, 'utf8');
    console.log(`Patched SVG legend with detached footer: ${path.relative(process.cwd(), filePath)}`);
  }
}

const candidates = readDirSafe(ASSETS_DIR)
  .filter((name) => SVG_FILES.includes(name) || /^github_\d{4}\.svg$/.test(name))
  .map((name) => path.join(ASSETS_DIR, name));

for (const filePath of candidates) {
  patchSvg(filePath);
}
