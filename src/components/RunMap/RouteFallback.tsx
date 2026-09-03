import type { FeatureCollection } from 'geojson';
import { useMemo } from 'react';
import type { Coordinate } from '@/modules/routeGeometry';
import { getRouteBounds } from '@/modules/routeGeometry';
import worldGeoJson from '@/static/world.zh.json';
import { chinaGeojson, type RPGeometry } from '@/static/run_countries';
import { MAP_HEIGHT } from '@/utils/const';
import RunMapButtons from './RunMapButtons';
import styles from './style.module.css';

interface RouteFallbackProps {
  title: string;
  changeYear: (_year: string) => void;
  geoData: FeatureCollection<RPGeometry>;
  thisYear: string;
  reason: string;
  isDark?: boolean;
}

interface FallbackRoute {
  coordinates: Coordinate[];
  color: string;
  indoor: boolean;
}

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 600;
const VIEWBOX_PADDING = 36;
const MAX_POINTS_PER_ROUTE = 900;
const TILE_SIZE = 256;
const MIN_TILE_ZOOM = 1;
const MAX_TILE_ZOOM = 16;
interface MapViewport {
  project: (coordinate: Coordinate) => [number, number];
}

const LOCAL_WORLD_MAP = worldGeoJson as FeatureCollection<RPGeometry>;
const LOCAL_MAP_FEATURES = [
  ...LOCAL_WORLD_MAP.features,
  ...chinaGeojson.features,
];

const isCoordinate = (value: readonly number[]): value is Coordinate =>
  Number.isFinite(value[0]) && Number.isFinite(value[1]);

const simplifyCoordinates = (
  coordinates: Coordinate[],
  maximumPoints: number
): Coordinate[] => {
  if (coordinates.length <= maximumPoints) return coordinates;

  const lastIndex = coordinates.length - 1;
  const step = lastIndex / (maximumPoints - 1);
  return Array.from(
    { length: maximumPoints },
    (_, index) => coordinates[Math.round(index * step)]
  );
};

const routesFromGeoData = (
  geoData: FeatureCollection<RPGeometry>
): FallbackRoute[] =>
  geoData.features.flatMap((feature) => {
    if (feature.geometry.type !== 'LineString') return [];

    const coordinates = feature.geometry.coordinates.filter(isCoordinate);
    if (coordinates.length < 2) return [];

    return [
      {
        coordinates: simplifyCoordinates(coordinates, MAX_POINTS_PER_ROUTE),
        color:
          typeof feature.properties?.color === 'string'
            ? feature.properties.color
            : 'var(--color-primary)',
        indoor: feature.properties?.indoor === true,
      },
    ];
  });

const clampLatitude = (latitude: number): number =>
  Math.max(-85.05112878, Math.min(85.05112878, latitude));

const longitudeToWorldX = (longitude: number, zoom: number): number =>
  ((longitude + 180) / 360) * TILE_SIZE * 2 ** zoom;

const latitudeToWorldY = (latitude: number, zoom: number): number => {
  const radians = (clampLatitude(latitude) * Math.PI) / 180;
  const worldSize = TILE_SIZE * 2 ** zoom;
  return (
    (0.5 -
      Math.log((1 + Math.sin(radians)) / (1 - Math.sin(radians))) /
        (4 * Math.PI)) *
    worldSize
  );
};

const chooseTileZoom = (bounds: ReturnType<typeof getRouteBounds>): number => {
  if (!bounds) return MIN_TILE_ZOOM;

  const plotWidth = VIEWBOX_WIDTH - VIEWBOX_PADDING * 2;
  const plotHeight = VIEWBOX_HEIGHT - VIEWBOX_PADDING * 2;

  for (let zoom = MAX_TILE_ZOOM; zoom >= MIN_TILE_ZOOM; zoom -= 1) {
    const routeWidth =
      longitudeToWorldX(bounds.east, zoom) -
      longitudeToWorldX(bounds.west, zoom);
    const routeHeight =
      latitudeToWorldY(bounds.south, zoom) -
      latitudeToWorldY(bounds.north, zoom);

    if (routeWidth <= plotWidth && routeHeight <= plotHeight) return zoom;
  }

  return MIN_TILE_ZOOM;
};

const createMapViewport = (routes: FallbackRoute[]): MapViewport | null => {
  const bounds = getRouteBounds(routes);
  if (!bounds) return null;

  const zoom = chooseTileZoom(bounds);
  const westX = longitudeToWorldX(bounds.west, zoom);
  const eastX = longitudeToWorldX(bounds.east, zoom);
  const northY = latitudeToWorldY(bounds.north, zoom);
  const southY = latitudeToWorldY(bounds.south, zoom);
  const routeWidth = Math.max(eastX - westX, 1);
  const routeHeight = Math.max(southY - northY, 1);
  const plotWidth = VIEWBOX_WIDTH - VIEWBOX_PADDING * 2;
  const plotHeight = VIEWBOX_HEIGHT - VIEWBOX_PADDING * 2;
  const scale = Math.min(1, plotWidth / routeWidth, plotHeight / routeHeight);
  const centerX = (westX + eastX) / 2;
  const centerY = (northY + southY) / 2;
  const offsetX = VIEWBOX_WIDTH / 2 - centerX * scale;
  const offsetY = VIEWBOX_HEIGHT / 2 - centerY * scale;
  return {
    project: ([longitude, latitude]) => [
      offsetX + longitudeToWorldX(longitude, zoom) * scale,
      offsetY + latitudeToWorldY(latitude, zoom) * scale,
    ],
  };
};

const projectCoordinates = (
  coordinates: Coordinate[],
  viewport: MapViewport
): string =>
  coordinates
    .map((coordinate) => {
      const [x, y] = viewport.project(coordinate);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

const projectRing = (
  coordinates: readonly (readonly number[])[],
  viewport: MapViewport
): string => {
  const points = coordinates
    .filter(isCoordinate)
    .map(([longitude, latitude]) => {
      const [x, y] = viewport.project([longitude, latitude]);
      return `${x.toFixed(2)} ${y.toFixed(2)}`;
    });

  return points.length >= 3 ? `M ${points.join(' L ')} Z` : '';
};

const projectMapGeometry = (
  geometry: RPGeometry,
  viewport: MapViewport
): string => {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates
      .map((ring) => projectRing(ring, viewport))
      .filter(Boolean)
      .join(' ');
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .flatMap((polygon) => polygon.map((ring) => projectRing(ring, viewport)))
      .filter(Boolean)
      .join(' ');
  }

  return '';
};

const RouteFallback = ({
  title,
  changeYear,
  geoData,
  thisYear,
  reason,
}: RouteFallbackProps) => {
  const routes = useMemo(() => routesFromGeoData(geoData), [geoData]);
  const bounds = useMemo(() => getRouteBounds(routes), [routes]);
  const mapViewport = useMemo(() => createMapViewport(routes), [routes]);
  const mapBackground = useMemo(() => {
    if (!mapViewport) return [];

    return LOCAL_MAP_FEATURES.map((feature, index) => ({
      key: `${feature.properties?.name ?? 'feature'}-${index}`,
      path: projectMapGeometry(feature.geometry, mapViewport),
      province: index >= LOCAL_WORLD_MAP.features.length,
    })).filter((feature) => feature.path.length > 0);
  }, [mapViewport]);

  return (
    <div
      className={styles.fallbackRenderer}
      data-map-renderer="fallback"
      style={{ height: MAP_HEIGHT }}
    >
      <RunMapButtons changeYear={changeYear} thisYear={thisYear} />
      <p className={styles.fallbackStatus} role="status" aria-live="polite">
        {reason}
      </p>
      {routes.length > 0 && bounds ? (
        <svg
          className={styles.fallbackSvg}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="img"
          aria-label={`${title}轨迹`}
        >
          <defs>
            <pattern
              id="route-fallback-grid"
              width="80"
              height="80"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 80 0 L 0 0 0 80"
                fill="none"
                className={styles.fallbackGrid}
              />
            </pattern>
          </defs>
          <rect
            width={VIEWBOX_WIDTH}
            height={VIEWBOX_HEIGHT}
            className={styles.fallbackBackground}
          />
          <g aria-hidden="true">
            {mapBackground.map(({ key, path, province }) => (
              <path
                key={key}
                d={path}
                className={
                  province ? styles.fallbackProvince : styles.fallbackLand
                }
                fillRule="evenodd"
              />
            ))}
          </g>
          <rect
            width={VIEWBOX_WIDTH}
            height={VIEWBOX_HEIGHT}
            fill="url(#route-fallback-grid)"
          />
          <g role="group" aria-label="路线">
            {routes.map((route) => (
              <polyline
                key={`${route.coordinates[0].join(',')}-${route.coordinates[
                  route.coordinates.length - 1
                ].join(',')}-${route.coordinates.length}`}
                points={projectCoordinates(route.coordinates, mapViewport!)}
                className={`${styles.fallbackRoute} ${
                  route.indoor ? styles.fallbackRouteIndoor : ''
                }`}
                style={{ stroke: route.color }}
              />
            ))}
          </g>
          {routes.length === 1 && (
            <g role="group" aria-label="起终点">
              {[
                { coordinate: routes[0].coordinates[0], name: 'start' },
                {
                  coordinate:
                    routes[0].coordinates[routes[0].coordinates.length - 1],
                  name: 'end',
                },
              ].map(({ coordinate: [longitude, latitude], name }) => {
                const [point] = projectCoordinates(
                  [[longitude, latitude]],
                  mapViewport!
                ).split(' ');
                const [x, y] = point.split(',');
                return (
                  <circle
                    key={`${x}-${y}-${name}`}
                    cx={x}
                    cy={y}
                    r="7"
                    className={styles.fallbackMarker}
                  />
                );
              })}
            </g>
          )}
        </svg>
      ) : (
        <p className={styles.fallbackEmpty} role="status">
          当前没有可绘制的轨迹
        </p>
      )}
      {routes.length > 0 && mapViewport && (
        <p className={styles.fallbackAttribution}>
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors
          </a>{' '}
          · 内置矢量底图
        </p>
      )}
      <span className={styles.runTitle}>{title}</span>
    </div>
  );
};

export default RouteFallback;
