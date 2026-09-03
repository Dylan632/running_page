#!/usr/bin/env node

import process from 'node:process';

const origin = process.argv[2];
if (!origin) throw new Error('A deployment origin is required');

const target = new URL('/api/map-proxy', origin);
target.searchParams.set(
  'url',
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
);

const response = await fetch(target, {
  headers: {
    'user-agent': 'cycling-page-map-proxy-check/1',
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          'x-vercel-protection-bypass':
            process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
        }
      : {}),
  },
});

const contentType = response.headers.get('content-type') ?? '';
const body = await response.text();
if (!response.ok) {
  throw new Error(
    `map proxy returned HTTP ${response.status} (${contentType}): ${body.slice(0, 180)}`
  );
}
if (!contentType.toLowerCase().includes('application/json')) {
  throw new Error(
    `map proxy returned ${contentType || 'no content type'} instead of JSON`
  );
}

const style = JSON.parse(body);
if (
  style?.version !== 8 ||
  typeof style?.sources?.carto?.url !== 'string' ||
  !style.sources.carto.url.includes('carto.streets')
) {
  throw new Error('map proxy returned an unexpected Carto style document');
}

process.stdout.write(
  `map proxy passed: HTTP ${response.status}, ${contentType}, ${body.length} bytes\n`
);
