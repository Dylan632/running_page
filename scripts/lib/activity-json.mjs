import { readFile } from 'node:fs/promises';

const NUMERIC_ACTIVITY_ID = /^-?(?:0|[1-9]\d*)(?=\s*[,}])/;

export const parseActivityJson = (source) => {
  let cursor = 0;
  let index = 0;
  let normalized = '';

  while (index < source.length) {
    if (source[index] !== '"') {
      index += 1;
      continue;
    }

    const tokenStart = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === '"') break;
      index += 1;
    }
    if (index >= source.length) break;

    const tokenEnd = index + 1;
    const token = source.slice(tokenStart, tokenEnd);
    index = tokenEnd;

    let key;
    try {
      key = JSON.parse(token);
    } catch {
      continue;
    }
    if (key !== 'run_id') continue;

    let colon = tokenEnd;
    while (/\s/.test(source[colon] ?? '')) colon += 1;
    if (source[colon] !== ':') continue;

    let valueStart = colon + 1;
    while (/\s/.test(source[valueStart] ?? '')) valueStart += 1;
    const numericId = NUMERIC_ACTIVITY_ID.exec(source.slice(valueStart))?.[0];
    if (!numericId) continue;

    normalized += `${source.slice(cursor, valueStart)}"${numericId}"`;
    cursor = valueStart + numericId.length;
    index = cursor;
  }

  return JSON.parse(`${normalized}${source.slice(cursor)}`);
};

export const readActivityJson = async (path) =>
  parseActivityJson(await readFile(path, 'utf8'));

export const normalizeActivityId = (value) => {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  throw new Error('Every activity must have a lossless run_id');
};
