import type { FeatureCollection } from 'geojson';
import { useCallback, useMemo, useState } from 'react';
import type { Coordinate } from '@/modules/routeGeometry';
import { getRouteBounds } from '@/modules/routeGeometry';
import type { RPGeometry } from '@/static/run_countries';
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
const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;

type RasterProvider = 'carto' | 'openstreetmap';

interface RasterTile {
  key: string;
  href: string;
  x: number;
  y: number;
  size: number;
}

interface RasterViewport {
  tiles: RasterTile[];
  project: (coordinate: Coordinate) => [number, number];
}

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

const tileUrl = (
  provider: RasterProvider,
  isDark: boolean,
  zoom: number,
  tileX: number,
  tileY: number
): string => {
  const tileCount = 2 ** zoom;
  const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;

  if (provider === 'openstreetmap') {
    return `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`;
  }

  const subdomain = CARTO_SUBDOMAINS[Math.abs(tileX) % CARTO_SUBDOMAINS.length];
  const style = isDark ? 'dark_all' : 'light_all';
  return `https://${subdomain}.basemaps.cartocdn.com/${style}/${zoom}/${wrappedTileX}/${tileY}.png`;
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

const createRasterViewport = (
  routes: FallbackRoute[],
  isDark: boolean,
  provider: RasterProvider
): RasterViewport | null => {
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
  const tileSize = TILE_SIZE * scale;
  const tileCount = 2 ** zoom;
  const firstTileX = Math.floor(-offsetX / tileSize) - 1;
  const lastTileX = Math.ceil((VIEWBOX_WIDTH - offsetX) / tileSize) + 1;
  const firstTileY = Math.max(0, Math.floor(-offsetY / tileSize) - 1);
  const lastTileY = Math.min(
    tileCount - 1,
    Math.ceil((VIEWBOX_HEIGHT - offsetY) / tileSize) + 1
  );
  const tiles: RasterTile[] = [];

  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      tiles.push({
        key: `${provider}-${zoom}-${tileX}-${tileY}`,
        href: tileUrl(provider, isDark, zoom, tileX, tileY),
        x: offsetX + tileX * tileSize,
        y: offsetY + tileY * tileSize,
        size: tileSize,
      });
    }
  }

  return {
    tiles,
    project: ([longitude, latitude]) => [
      offsetX + longitudeToWorldX(longitude, zoom) * scale,
      offsetY + latitudeToWorldY(latitude, zoom) * scale,
    ],
  };
};

const projectCoordinates = (
  coordinates: Coordinate[],
  viewport: RasterViewport
): string =>
  coordinates
    .map((coordinate) => {
      const [x, y] = viewport.project(coordinate);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

const RouteFallback = ({
  title,
  changeYear,
  geoData,
  thisYear,
  reason,
  isDark = false,
}: RouteFallbackProps) => {
  const routes = useMemo(() => routesFromGeoData(geoData), [geoData]);
  const bounds = useMemo(() => getRouteBounds(routes), [routes]);
  const [rasterProvider, setRasterProvider] =
    useState<RasterProvider>('openstreetmap');
  const handleRasterTileError = useCallback(() => {
    setRasterProvider((currentProvider) =>
      currentProvider === 'openstreetmap' ? 'carto' : currentProvider
    );
  }, []);
  const rasterViewport = useMemo(
    () => createRasterViewport(routes, isDark, rasterProvider),
    [isDark, rasterProvider, routes]
  );

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
            {rasterViewport?.tiles.map((tile) => (
              <image
                key={tile.key}
                data-map-tile="true"
                href={tile.href}
                x={tile.x}
                y={tile.y}
                width={tile.size}
                height={tile.size}
                preserveAspectRatio="none"
                className={styles.fallbackMapTile}
                onError={handleRasterTileError}
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
                points={projectCoordinates(route.coordinates, rasterViewport!)}
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
                  rasterViewport!
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
      {routes.length > 0 && rasterViewport && (
        <p className={styles.fallbackAttribution}>
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors
          </a>{' '}
          {rasterProvider === 'carto' && (
            <>
              ·{' '}
              <a
                href="https://carto.com/attributions"
                target="_blank"
                rel="noreferrer"
              >
                © CARTO
              </a>
            </>
          )}
        </p>
      )}
      <span className={styles.runTitle}>{title}</span>
    </div>
  );
};

export default RouteFallback;
