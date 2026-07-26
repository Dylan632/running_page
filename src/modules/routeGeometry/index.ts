import mapboxPolyline from '@mapbox/polyline';
import { WebMercatorViewport } from '@math.gl/web-mercator';
import gcoord from 'gcoord';
import { NEED_FIX_MAP } from '@/utils/const';
import type { Activity } from '@/utils/utils';
import { locationForRun } from '@/utils/utils';

export type Coordinate = [number, number];

export interface NormalizedRouteGeometry {
  runId: number;
  coordinates: Coordinate[];
}

export interface RouteCoordinateGeometry {
  coordinates: readonly Coordinate[];
}

export interface RouteBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface RouteViewState {
  longitude?: number;
  latitude?: number;
  zoom?: number;
}

const routeGeometryCache = new Map<string, NormalizedRouteGeometry>();

const routeGeometryKey = (activity: Activity): string =>
  `${activity.run_id}\u0000${activity.summary_polyline ?? ''}`;

const decodeCoordinates = (activity: Activity): Coordinate[] => {
  if (!activity.summary_polyline) return [];

  try {
    const coordinates = mapboxPolyline.decode(
      activity.summary_polyline
    ) as Coordinate[];

    coordinates.forEach((coordinate) => {
      [coordinate[0], coordinate[1]] = !NEED_FIX_MAP
        ? [coordinate[1], coordinate[0]]
        : gcoord.transform(
            [coordinate[1], coordinate[0]],
            gcoord.GCJ02,
            gcoord.WGS84
          );
    });

    if (
      coordinates.length === 2 &&
      String(coordinates[0]) === String(coordinates[1])
    ) {
      const { coordinate } = locationForRun(activity);
      if (coordinate?.[0] && coordinate?.[1]) {
        return [coordinate, coordinate];
      }
    }

    return coordinates;
  } catch {
    return [];
  }
};

export const normalizeRouteGeometry = (
  activity: Activity
): NormalizedRouteGeometry => {
  const key = routeGeometryKey(activity);
  const cached = routeGeometryCache.get(key);
  if (cached) return cached;

  const geometry = {
    runId: activity.run_id,
    coordinates: decodeCoordinates(activity),
  };
  routeGeometryCache.set(key, geometry);
  return geometry;
};

export const normalizeRouteGeometries = (
  activities: readonly Activity[]
): NormalizedRouteGeometry[] => activities.map(normalizeRouteGeometry);

export const getRouteBounds = (
  geometries: readonly RouteCoordinateGeometry[]
): RouteBounds | null => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const { coordinates } of geometries) {
    for (const [longitude, latitude] of coordinates) {
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
    }
  }

  if (![west, south, east, north].every(Number.isFinite)) return null;
  return { west, south, east, north };
};

export const fitRouteGeometries = (
  geometries: readonly RouteCoordinateGeometry[]
): RouteViewState => {
  const bounds = getRouteBounds(geometries);
  if (!bounds) return { longitude: 20, latitude: 20, zoom: 3 };

  const { west, south, east, north } = bounds;
  if (west === east && south === north) {
    return { longitude: west, latitude: south, zoom: 9 };
  }

  const viewState = new WebMercatorViewport({
    width: 800,
    height: 600,
  }).fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: 200 }
  );

  return {
    longitude: viewState.longitude,
    latitude: viewState.latitude,
    zoom: viewState.zoom,
  };
};
