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

const createFixtureActivityRepository = async () => {
  const { createActivityDataRepository } = await vite.ssrLoadModule(
    '/src/modules/activity/activityData.ts'
  );
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

  return createActivityDataRepository({
    baseUrl: '/data',
    fetcher,
  });
};

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

test('detects WebGL failures before the map library starts', async () => {
  const { canCreateWebGLContext } = await vite.ssrLoadModule(
    '/src/components/RunMap/mapSupport.ts'
  );

  assert.equal(
    canCreateWebGLContext({ getContext: () => null }),
    false,
    'a browser without a WebGL context must use the route fallback'
  );
  assert.equal(
    canCreateWebGLContext({
      getContext: (type) =>
        type === 'webgl' ? { isContextLost: () => false } : null,
    }),
    true,
    'a healthy WebGL context must keep the interactive map'
  );
  assert.equal(
    canCreateWebGLContext({
      getContext: () => {
        throw new Error('WebGL unavailable');
      },
    }),
    false,
    'a browser that throws while creating WebGL must use the route fallback'
  );
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

test('real annual views focus their primary activity area at a useful zoom', async () => {
  const { geoJsonForRuns, getBoundsForGeoData, getPrimaryBoundsForGeoData } =
    await vite.ssrLoadModule('/src/utils/geoUtils.ts');
  const repository = await createFixtureActivityRepository();

  const cases = [
    {
      mode: 'running',
      year: '2025',
      longitudeRange: [120.1, 120.4],
      latitudeRange: [31.4, 31.7],
      minimumZoomGain: 2,
    },
    {
      mode: 'cycling',
      year: '2025',
      longitudeRange: [120.1, 120.4],
      latitudeRange: [31.4, 31.7],
      minimumZoomGain: 1.5,
    },
    {
      mode: 'running',
      year: '2020',
      longitudeRange: [119.3, 119.7],
      latitudeRange: [35.8, 36.1],
      minimumZoomGain: 2,
    },
  ];

  for (const {
    mode,
    year,
    longitudeRange,
    latitudeRange,
    minimumZoomGain,
  } of cases) {
    const loadedActivities = await repository.loadActivities(mode, [year]);
    const activities = loadedActivities.filter((item) =>
      item.start_date_local.startsWith(year)
    );
    const geoData = geoJsonForRuns(activities);
    const fullView = getBoundsForGeoData(geoData);
    const primaryView = getPrimaryBoundsForGeoData(geoData);

    assert.ok(activities.length > 0, `${mode}: missing ${year} activities`);
    assert.ok(
      primaryView.longitude > longitudeRange[0] &&
        primaryView.longitude < longitudeRange[1],
      `${mode} ${year}: default longitude should focus the primary area`
    );
    assert.ok(
      primaryView.latitude > latitudeRange[0] &&
        primaryView.latitude < latitudeRange[1],
      `${mode} ${year}: default latitude should focus the primary area`
    );
    assert.ok(
      primaryView.zoom > fullView.zoom + minimumZoomGain,
      `${mode} ${year}: primary view should be tighter than all routes`
    );
    assert.ok(
      primaryView.zoom <= 14,
      `${mode} ${year}: primary view must keep local routes in view`
    );
  }
});

test('running Total opens on the Yangtze River Delta while cycling Total stays unchanged', async () => {
  const { geoJsonForRuns, getBoundsForGeoData, getTotalOverviewBoundsForRuns } =
    await vite.ssrLoadModule('/src/utils/geoUtils.ts');
  const repository = await createFixtureActivityRepository();
  const loadAllActivities = async (mode) => {
    const manifest = JSON.parse(
      await readFile(
        new URL(`../public/data/${mode}/manifest.json`, import.meta.url),
        'utf8'
      )
    );
    return repository.loadActivities(mode, manifest.years);
  };
  const [runningActivities, cyclingActivities] = await Promise.all([
    loadAllActivities('running'),
    loadAllActivities('cycling'),
  ]);

  const runningView = getTotalOverviewBoundsForRuns(
    'running',
    runningActivities
  );
  const cyclingView = getTotalOverviewBoundsForRuns(
    'cycling',
    cyclingActivities
  );
  const unchangedCyclingView = getBoundsForGeoData(
    geoJsonForRuns(cyclingActivities)
  );

  assert.ok(
    runningView.longitude > 119 && runningView.longitude < 121,
    'running Total should open over the Yangtze River Delta'
  );
  assert.ok(runningView.latitude > 31 && runningView.latitude < 32.5);
  assert.ok(runningView.zoom > 6 && runningView.zoom < 8);
  assert.ok(
    Math.abs(runningView.zoom - cyclingView.zoom) < 0.5,
    'running and cycling Total should open at a similar regional scale'
  );
  assert.deepEqual(
    cyclingView,
    unchangedCyclingView,
    'cycling Total must keep its current viewport'
  );
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

test('map lights wait for the remote style before reading its layers', async () => {
  const { setMapLightVisibility } = await vite.ssrLoadModule(
    '/src/components/RunMap/mapLights.ts'
  );
  const map = {
    isStyleLoaded: () => false,
    getStyle: () => {
      throw new Error('Style is not done loading');
    },
    setLayoutProperty: () => {
      throw new Error('layers must not be changed before the style is ready');
    },
  };

  assert.doesNotThrow(() => setMapLightVisibility(map, false));
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

test('proxies Carto resources through the deployed site origin', async () => {
  const { getCartoProxyUrl } = await vite.ssrLoadModule(
    '/src/components/RunMap/mapRequest.ts'
  );

  assert.equal(
    getCartoProxyUrl(
      'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
      'https://records.example'
    ),
    'https://records.example/api/map-proxy?url=https%3A%2F%2Fbasemaps.cartocdn.com%2Fgl%2Fvoyager-gl-style%2Fstyle.json'
  );
  assert.equal(
    getCartoProxyUrl(
      'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json?x=1',
      'https://records.example'
    ),
    'https://records.example/api/map-proxy?url=https%3A%2F%2Ftiles.basemaps.cartocdn.com%2Fvector%2Fcarto.streets%2Fv1%2Ftiles.json%3Fx%3D1'
  );
  for (const hostname of ['tiles-a', 'tiles-b', 'tiles-c', 'tiles-d']) {
    const tileUrl = `https://${hostname}.basemaps.cartocdn.com/vectortiles/carto.streets/v1/4/6/7.mvt`;
    assert.equal(
      getCartoProxyUrl(tileUrl, 'https://records.example'),
      `https://records.example/api/map-proxy?url=${encodeURIComponent(tileUrl)}`
    );
  }
  assert.equal(
    getCartoProxyUrl(
      'https://example.com/style.json',
      'https://records.example'
    ),
    null
  );
});
