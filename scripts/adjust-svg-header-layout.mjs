import fs from 'node:fs';
import path from 'node:path';

const ASSETS_DIR = path.resolve('assets');
const SVG_FILES = ['github.svg'];
// Keep generated SVG footer layout aligned after each build.

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function getSvgHeight(svg) {
  const viewBoxMatch = svg.match(
    /viewBox="\s*[-0-9.]+[,\s]+[-0-9.]+[,\s]+[0-9.]+[,\s]+([0-9.]+)\s*"/
  );
  if (viewBoxMatch) return Number(viewBoxMatch[1]);

  const heightMatch = svg.match(/\bheight="([0-9.]+)(?:[a-z%]*)"/i);
  return heightMatch ? Number(heightMatch[1]) : 300;
}

function setAttr(tag, attr, value) {
  const attrRegex = new RegExp(`\\b${attr}="[^"]*"`);
  if (attrRegex.test(tag)) {
    return tag.replace(attrRegex, `${attr}="${value}"`);
  }
  return tag.replace(/^<([a-zA-Z]+)/, `<$1 ${attr}="${value}"`);
}

function textContent(raw) {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

function patchedTextX(content) {
  if (content === 'SPECIAL TRACKS') return 60;
  if (content.startsWith('Over ') || content === 'Half Marathon') return 65;

  if (content === 'STATISTICS') return 112;
  if (content.startsWith('Number') || content.startsWith('Weekly')) return 112;
  if (content.startsWith('Total') || content.startsWith('Avg')) return 136;
  if (content.startsWith('Min') || content.startsWith('Max')) return 171;

  return null;
}

function patchTextColumns(svg) {
  return svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, (tag) => {
    const match = tag.match(/<text\b[^>]*>([\s\S]*?)<\/text>/);
    if (!match) return tag;

    const nextX = patchedTextX(textContent(match[1]));
    if (nextX === null) return tag;

    return setAttr(tag, 'x', nextX);
  });
}

function isHeatmapFile(filePath) {
  return path.basename(filePath).startsWith('github');
}

function patchSpecialLegendSquares(svg, filePath) {
  const height = getSvgHeight(svg);
  const footerStart = height - 25;
  const markerX = isHeatmapFile(filePath) ? 60 : 65;

  return svg.replace(
    /<rect\b[^>]*?\/>|<rect\b[^>]*>[\s\S]*?<\/rect>/g,
    (tag) => {
      const yMatch = tag.match(/\by="(-?[0-9.]+)"/);
      const widthMatch = tag.match(/\bwidth="([0-9.]+)"/);
      const heightMatch = tag.match(/\bheight="([0-9.]+)"/);

      if (!yMatch || !widthMatch || !heightMatch) return tag;

      const y = Number(yMatch[1]);
      const width = Number(widthMatch[1]);
      const rectHeight = Number(heightMatch[1]);

      if (y >= footerStart && width <= 3 && rectHeight <= 3) {
        return setAttr(tag, 'x', markerX);
      }

      return tag;
    }
  );
}

function patchSvg(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const patched = patchSpecialLegendSquares(
    patchTextColumns(original),
    filePath
  );

  if (patched !== original) {
    fs.writeFileSync(filePath, patched, 'utf8');
    console.log(
      `Adjusted SVG header/footer layout: ${path.relative(process.cwd(), filePath)}`
    );
  }
}

const candidates = readDirSafe(ASSETS_DIR)
  .filter(
    (name) => SVG_FILES.includes(name) || /^github_\d{4}\.svg$/.test(name)
  )
  .map((name) => path.join(ASSETS_DIR, name));

for (const filePath of candidates) {
  patchSvg(filePath);
}
