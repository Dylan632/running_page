import type { FeatureCollection } from 'geojson';
import { useMemo } from 'react';
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

const projectCoordinates = (
  coordinates: Coordinate[],
  bounds: ReturnType<typeof getRouteBounds>
): string => {
  if (!bounds) return '';

  const longitudeCenter = (bounds.west + bounds.east) / 2;
  const latitudeCenter = (bounds.south + bounds.north) / 2;
  const longitudeSpan = Math.max(bounds.east - bounds.west, 0.01);
  const latitudeSpan = Math.max(bounds.north - bounds.south, 0.01);
  const viewWest = longitudeCenter - longitudeSpan / 2;
  const viewNorth = latitudeCenter + latitudeSpan / 2;
  const plotWidth = VIEWBOX_WIDTH - VIEWBOX_PADDING * 2;
  const plotHeight = VIEWBOX_HEIGHT - VIEWBOX_PADDING * 2;

  return coordinates
    .map(([longitude, latitude]) => {
      const x =
        VIEWBOX_PADDING + ((longitude - viewWest) / longitudeSpan) * plotWidth;
      const y =
        VIEWBOX_PADDING + ((viewNorth - latitude) / latitudeSpan) * plotHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
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
          <rect
            width={VIEWBOX_WIDTH}
            height={VIEWBOX_HEIGHT}
            fill="url(#route-fallback-grid)"
          />
          <g aria-label="路线">
            {routes.map((route) => (
              <polyline
                key={`${route.coordinates[0].join(',')}-${route.coordinates[
                  route.coordinates.length - 1
                ].join(',')}-${route.coordinates.length}`}
                points={projectCoordinates(route.coordinates, bounds)}
                className={`${styles.fallbackRoute} ${
                  route.indoor ? styles.fallbackRouteIndoor : ''
                }`}
                style={{ stroke: route.color }}
              />
            ))}
          </g>
          {routes.length === 1 && (
            <g aria-label="起终点">
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
                  bounds
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
      <span className={styles.runTitle}>{title}</span>
    </div>
  );
};

export default RouteFallback;
