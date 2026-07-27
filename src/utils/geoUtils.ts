import type { FeatureCollection, LineString, Feature } from 'geojson';
import type { GeoJsonProperties } from 'geojson';
import type { RPGeometry } from '@/static/run_countries';
import worldGeoJsonUrl from '@/static/world.zh.json?url';
import { getMapThemeFromCurrentTheme } from '@/hooks/useTheme';
import {
  fitPrimaryRouteGeometries,
  fitRouteGeometries,
  getRouteBounds,
  normalizeRouteGeometries,
  type Coordinate,
  type RouteViewState,
} from '@/modules/routeGeometry';
import type { ActivityMode } from '@/modules/activity/profiles';
import {
  CYCLING_COLOR,
  getMapTileVendorStyles,
  getRuntimeRunColor,
  HIKING_COLOR,
  INDOOR_COLOR,
  MAIN_COLOR,
  MAP_TILE_STYLES,
  RUN_TRAIL_COLOR,
  SWIMMING_COLOR,
  WALKING_COLOR,
} from './const';
import { locationForRun, type Activity } from './utils';
import { getEffectiveTheme } from './themeUtils';

export type { Coordinate } from '@/modules/routeGeometry';

export type IViewState = RouteViewState;

const YANGTZE_RIVER_DELTA_PROVINCES = new Set([
  '上海市',
  '江苏省',
  '浙江省',
  '安徽省',
]);

const colorForRun = (run: Activity): string => {
  const dynamicRunColor = getRuntimeRunColor();

  switch (run.type) {
    case 'Run': {
      if (run.subtype === 'indoor' || run.subtype === 'treadmill') {
        return INDOOR_COLOR;
      }
      if (run.subtype === 'trail') {
        return RUN_TRAIL_COLOR;
      } else if (run.subtype === 'generic') {
        return dynamicRunColor;
      }
      return dynamicRunColor;
    }
    case 'cycling':
    case 'Ride':
      return CYCLING_COLOR;
    case 'hiking':
    case 'Hike':
      return HIKING_COLOR;
    case 'walking':
    case 'Walk':
      return WALKING_COLOR;
    case 'swimming':
    case 'Swim':
      return SWIMMING_COLOR;
    default:
      return MAIN_COLOR;
  }
};

export const geoJsonForRuns = (
  runs: Activity[]
): FeatureCollection<LineString> => {
  const routeGeometries = normalizeRouteGeometries(runs);

  return {
    type: 'FeatureCollection',
    features: runs.map((run, index) => {
      const routeGeometry = routeGeometries[index];
      const points = routeGeometry.coordinates;
      const color = colorForRun(run);
      return {
        type: 'Feature',
        properties: {
          color: color,
          indoor: run.subtype === 'indoor' || run.subtype === 'treadmill',
        },
        geometry: {
          type: 'LineString',
          coordinates: points,
        },
      };
    }),
  };
};

let worldGeoJsonPromise: Promise<FeatureCollection<RPGeometry>> | undefined;

const loadWorldGeoJson = () => {
  worldGeoJsonPromise ??= fetch(worldGeoJsonUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load world GeoJSON: ${response.status}`);
    }
    return response.json() as Promise<FeatureCollection<RPGeometry>>;
  });
  return worldGeoJsonPromise;
};

export const geoJsonForMap = async (): Promise<
  FeatureCollection<RPGeometry>
> => {
  const [{ chinaGeojson }, worldGeoJson] = await Promise.all([
    import('@/static/run_countries'),
    loadWorldGeoJson(),
  ]);

  return {
    type: 'FeatureCollection',
    features: [...worldGeoJson.features, ...chinaGeojson.features] as Feature<
      RPGeometry,
      GeoJsonProperties
    >[],
  };
};

const routeGeometriesForGeoData = (geoData: FeatureCollection<LineString>) =>
  geoData.features.map(({ geometry }) => ({
    coordinates: geometry.coordinates as Coordinate[],
  }));

export const getBoundsForGeoData = (
  geoData: FeatureCollection<LineString>
): IViewState => fitRouteGeometries(routeGeometriesForGeoData(geoData));

export const getPrimaryBoundsForGeoData = (
  geoData: FeatureCollection<LineString>
): IViewState => fitPrimaryRouteGeometries(routeGeometriesForGeoData(geoData));

export const getTotalOverviewBoundsForRuns = (
  mode: ActivityMode,
  runs: Activity[]
): IViewState => {
  const allRouteGeometries = normalizeRouteGeometries(runs);
  if (mode !== 'running') {
    return fitRouteGeometries(allRouteGeometries);
  }

  const regionalRouteGeometries = normalizeRouteGeometries(
    runs.filter((run) =>
      YANGTZE_RIVER_DELTA_PROVINCES.has(locationForRun(run).province ?? '')
    )
  );

  return getRouteBounds(regionalRouteGeometries)
    ? fitRouteGeometries(regionalRouteGeometries)
    : fitRouteGeometries(allRouteGeometries);
};

export const getMapStyle = (
  vendor: string,
  styleName: string,
  token: string
) => {
  const style = getMapTileVendorStyles(vendor)?.[styleName];
  if (!style) {
    return MAP_TILE_STYLES.default;
  }
  if (vendor === 'maptiler' || vendor === 'stadiamaps') {
    return style + token;
  }
  return style;
};

export const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.innerWidth <= 768
  );
};

export const getMapTheme = (): string => {
  return getMapThemeFromCurrentTheme(getEffectiveTheme());
};
