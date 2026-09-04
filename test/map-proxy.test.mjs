import assert from 'node:assert/strict';
import { test } from 'node:test';
import mapProxy from '../api/map-proxy.js';

const CARTO_TILE_HOSTNAMES = [
  'tiles-a.basemaps.cartocdn.com',
  'tiles-b.basemaps.cartocdn.com',
  'tiles-c.basemaps.cartocdn.com',
  'tiles-d.basemaps.cartocdn.com',
];

const createResponse = () => ({
  headers: new Map(),
  statusCode: undefined,
  body: undefined,
  setHeader(name, value) {
    this.headers.set(name, value);
  },
  end(body) {
    this.body = body;
  },
});

test('proxies all Carto vector-tile shard hostnames', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url, options) => {
    requestedUrls.push({ url: String(url), method: options.method });
    return new globalThis.Response('vector tile', {
      status: 200,
      headers: { 'content-type': 'application/vnd.mapbox-vector-tile' },
    });
  };

  try {
    for (const hostname of CARTO_TILE_HOSTNAMES) {
      const response = createResponse();
      const tileUrl = `https://${hostname}/vectortiles/carto.streets/v1/4/6/7.mvt`;
      await mapProxy(
        { method: 'GET', query: { url: tileUrl }, headers: {} },
        response
      );

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.toString(), 'vector tile');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    requestedUrls.map(({ url }) => url),
    CARTO_TILE_HOSTNAMES.map(
      (hostname) => `https://${hostname}/vectortiles/carto.streets/v1/4/6/7.mvt`
    )
  );
  assert.ok(requestedUrls.every(({ method }) => method === 'GET'));
});
