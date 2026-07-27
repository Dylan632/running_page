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

const activity = (overrides = {}) => ({
  run_id: 42,
  name: 'Known route',
  distance: 1000,
  moving_time: '0:05:00',
  type: 'Run',
  subtype: 'generic',
  start_date: '2026-07-26 00:00:00',
  start_date_local: '2026-07-26 08:00:00',
  summary_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
  average_heartrate: null,
  elevation_gain: 0,
  average_speed: 3,
  streak: 1,
  ...overrides,
});

const shortRouteAt = ([longitude, latitude]) => ({
  coordinates: [
    [longitude, latitude],
    [longitude + 0.01, latitude + 0.01],
  ],
});

test('normalizes and caches route geometry by run id and polyline', async () => {
  const { normalizeRouteGeometry } = await vite.ssrLoadModule(
    '/src/modules/routeGeometry/index.ts'
  );

  const first = normalizeRouteGeometry(activity());
  const sameKey = normalizeRouteGeometry(activity({ name: 'Renamed route' }));
  const changedPolyline = normalizeRouteGeometry(
    activity({ summary_polyline: '??_ibE_ibE' })
  );

  assert.equal(first, sameKey);
  assert.equal(first.coordinates, sameKey.coordinates);
  assert.notEqual(first, changedPolyline);
  assert.deepEqual(first.coordinates, [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
  assert.deepEqual(changedPolyline.coordinates, [
    [0, 0],
    [1, 1],
  ]);
});

test('preserves the location fallback for degenerate route polylines', async () => {
  const { normalizeRouteGeometry } = await vite.ssrLoadModule(
    '/src/modules/routeGeometry/index.ts'
  );
  const geometry = normalizeRouteGeometry(
    activity({
      run_id: 43,
      summary_polyline: '????',
      location_country:
        "{'latitude': 32.1, 'longitude': 118.2, 'province': '江苏省'}",
    })
  );

  assert.deepEqual(geometry.coordinates, [
    [118.2, 32.1],
    [118.2, 32.1],
  ]);
});

test('calculates bounds from every route geometry', async () => {
  const { getRouteBounds } = await vite.ssrLoadModule(
    '/src/modules/routeGeometry/index.ts'
  );

  const bounds = getRouteBounds([
    {
      coordinates: [
        [-122, 37],
        [-121, 38],
      ],
    },
    {
      coordinates: [
        [-74, 40],
        [-73, 41],
      ],
    },
  ]);

  assert.deepEqual(bounds, {
    west: -122,
    south: 37,
    east: -73,
    north: 41,
  });
});

test('fits the map view to all GeoJSON features', async () => {
  const { getBoundsForGeoData } = await vite.ssrLoadModule(
    '/src/utils/geoUtils.ts'
  );
  const geoData = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [-122, 37],
            [-121, 38],
          ],
        },
      },
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [-74, 40],
            [-73, 41],
          ],
        },
      },
    ],
  };

  const view = getBoundsForGeoData(geoData);

  assert.ok(view.longitude > -100 && view.longitude < -95);
  assert.ok(view.latitude > 37 && view.latitude < 41);
  assert.ok(view.zoom < 5, 'both coasts must remain visible');
});

test('fits an annual overview to a clear primary activity cluster', async () => {
  const { fitPrimaryRouteGeometries, fitRouteGeometries } =
    await vite.ssrLoadModule('/src/modules/routeGeometry/index.ts');
  const primaryRoutes = [
    [120.2, 31.5],
    [120.21, 31.51],
    [120.22, 31.49],
    [120.23, 31.52],
    [120.24, 31.5],
  ].map(shortRouteAt);
  primaryRoutes[0] = {
    coordinates: [
      [120.2, 31.5],
      [117, 30],
    ],
  };
  const distantRoutes = [
    [118.78, 32.04],
    [118.8, 32.06],
    [118.82, 32.08],
  ].map(shortRouteAt);
  const geometries = [...primaryRoutes, ...distantRoutes];

  const fullView = fitRouteGeometries(geometries);
  const primaryView = fitPrimaryRouteGeometries(geometries);

  assert.ok(primaryView.longitude > 120.2 && primaryView.longitude < 120.3);
  assert.ok(primaryView.latitude > 31.4 && primaryView.latitude < 31.6);
  assert.ok(
    primaryView.zoom > fullView.zoom + 2,
    'the distant minority must not force a regional overview'
  );
});

test('focuses a clear primary cluster even in a sparse annual view', async () => {
  const { fitPrimaryRouteGeometries, fitRouteGeometries } =
    await vite.ssrLoadModule('/src/modules/routeGeometry/index.ts');
  const geometries = [
    [120.2, 31.5],
    [120.21, 31.51],
    [120.22, 31.49],
    [120.23, 31.52],
    [120.24, 31.5],
    [120.25, 31.51],
    [118.8, 32.06],
  ].map(shortRouteAt);

  const fullView = fitRouteGeometries(geometries);
  const primaryView = fitPrimaryRouteGeometries(geometries);

  assert.ok(primaryView.longitude > 120.2 && primaryView.longitude < 120.3);
  assert.ok(primaryView.zoom > fullView.zoom + 2);
});

test('keeps the full annual view when no activity cluster clearly leads', async () => {
  const { fitPrimaryRouteGeometries, fitRouteGeometries } =
    await vite.ssrLoadModule('/src/modules/routeGeometry/index.ts');
  const geometries = [
    [120.2, 31.5],
    [120.21, 31.51],
    [120.22, 31.49],
    [120.23, 31.52],
    [118.78, 32.04],
    [118.8, 32.06],
    [118.82, 32.08],
    [118.84, 32.1],
  ].map(shortRouteAt);

  assert.deepEqual(
    fitPrimaryRouteGeometries(geometries),
    fitRouteGeometries(geometries)
  );
});

test('does not merge a chain of neighboring starts into one activity area', async () => {
  const { fitPrimaryRouteGeometries, fitRouteGeometries } =
    await vite.ssrLoadModule('/src/modules/routeGeometry/index.ts');
  const neighboringChain = Array.from({ length: 8 }, (_, index) =>
    shortRouteAt([120, 30 + index * 0.2])
  );
  const geometries = [
    ...neighboringChain,
    shortRouteAt([118.78, 32.04]),
    shortRouteAt([118.8, 32.06]),
  ];

  assert.deepEqual(
    fitPrimaryRouteGeometries(geometries),
    fitRouteGeometries(geometries)
  );
});

test('2025 annual views focus the primary Wuxi cluster for both modes', async () => {
  const { createActivityDataRepository } = await vite.ssrLoadModule(
    '/src/modules/activity/activityData.ts'
  );
  const { geoJsonForRuns, getBoundsForGeoData, getPrimaryBoundsForGeoData } =
    await vite.ssrLoadModule('/src/utils/geoUtils.ts');
  const fetcher = async (input) => {
    const { pathname } = new URL(String(input), 'https://fixture.test');
    try {
      const body = await readFile(
        new URL(`../public${pathname}`, import.meta.url)
      );
      return new Response(body, { status: 200 });
    } catch {
      return new Response('', { status: 404 });
    }
  };
  const repository = createActivityDataRepository({
    baseUrl: '/data',
    fetcher,
  });

  for (const mode of ['running', 'cycling']) {
    const loadedActivities = await repository.loadActivities(mode, ['2025']);
    const activities = loadedActivities.filter((item) =>
      item.start_date_local.startsWith('2025')
    );
    const geoData = geoJsonForRuns(activities);
    const fullView = getBoundsForGeoData(geoData);
    const primaryView = getPrimaryBoundsForGeoData(geoData);

    assert.ok(activities.length > 0, `${mode}: missing 2025 activities`);
    assert.ok(
      primaryView.longitude > 120.1 && primaryView.longitude < 120.4,
      `${mode}: default longitude should focus Wuxi`
    );
    assert.ok(
      primaryView.latitude > 31.4 && primaryView.latitude < 31.7,
      `${mode}: default latitude should focus Wuxi`
    );
    assert.ok(
      primaryView.zoom > fullView.zoom + (mode === 'cycling' ? 1.5 : 2),
      `${mode}: primary view should be tighter than the all-route view`
    );
  }
});

test('theme changes recolor routes without replacing normalized coordinates', async () => {
  const { geoJsonForRuns } = await vite.ssrLoadModule('/src/utils/geoUtils.ts');
  const dom = new JSDOM(
    '<!doctype html><html data-theme="light"><body></body></html>'
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document'
  );

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });

  try {
    const lightGeoJson = geoJsonForRuns([activity()]);
    dom.window.document.documentElement.setAttribute('data-theme', 'dark');
    const darkGeoJson = geoJsonForRuns([activity()]);

    assert.equal(
      lightGeoJson.features[0].geometry.coordinates,
      darkGeoJson.features[0].geometry.coordinates
    );
    assert.notEqual(
      lightGeoJson.features[0].properties.color,
      darkGeoJson.features[0].properties.color
    );
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      delete globalThis.window;
    }
    if (previousDocument) {
      Object.defineProperty(globalThis, 'document', previousDocument);
    } else {
      delete globalThis.document;
    }
    dom.window.close();
  }
});

test('provides one shared geometry interface for route consumers', async () => {
  const { normalizeRouteGeometry, normalizeRouteGeometries } =
    await vite.ssrLoadModule('/src/modules/routeGeometry/index.ts');
  const run = activity();

  const geometries = normalizeRouteGeometries([run]);

  assert.equal(geometries.length, 1);
  assert.equal(geometries[0], normalizeRouteGeometry(run));
  assert.equal(geometries[0].runId, run.run_id);
});

test('map lights only change layer visibility without replacing map style', async () => {
  const { setMapLightVisibility } = await vite.ssrLoadModule(
    '/src/components/RunMap/mapLights.ts'
  );
  const visibilityChanges = [];
  const map = {
    getStyle: () => ({
      layers: [
        { id: 'background' },
        { id: 'road-label' },
        { id: 'runs2' },
        { id: 'runs2-indoor' },
        { id: 'animated-run' },
      ],
    }),
    setLayoutProperty: (layerId, property, value) => {
      visibilityChanges.push([layerId, property, value]);
    },
    setStyle: () => {
      throw new Error('lights must not reload map tiles');
    },
  };

  setMapLightVisibility(map, false);

  assert.deepEqual(visibilityChanges, [
    ['background', 'visibility', 'none'],
    ['road-label', 'visibility', 'none'],
  ]);
});

test('language control is installed only for compatible Mapbox styles', async () => {
  const { shouldInstallMapboxLanguage } = await vite.ssrLoadModule(
    '/src/components/RunMap/mapLights.ts'
  );

  assert.equal(shouldInstallMapboxLanguage('mapbox', true), true);
  assert.equal(shouldInstallMapboxLanguage('mapcn', true), false);
  assert.equal(shouldInstallMapboxLanguage('maptiler', true), false);
  assert.equal(shouldInstallMapboxLanguage('mapbox', false), false);
});
