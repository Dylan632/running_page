import mapboxPolyline from '@mapbox/polyline';
import { WebMercatorViewport } from '@math.gl/web-mercator';
import gcoord from 'gcoord';
import { NEED_FIX_MAP } from '@/utils/const';
import type { Activity, ActivityId } from '@/utils/utils';
import { locationForRun } from '@/utils/utils';

export type Coordinate = [number, number];

export interface NormalizedRouteGeometry {
  runId: ActivityId;
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

const PRIMARY_CLUSTER_RADIUS_KM = 25;
const PRIMARY_CLUSTER_MIN_ROUTE_COUNT = 5;
const PRIMARY_CLUSTER_MIN_TOTAL_ROUTE_COUNT = 8;
const PRIMARY_CLUSTER_MIN_SHARE = 0.6;
const PRIMARY_CLUSTER_MIN_LEAD_RATIO = 1.5;
const PRIMARY_CLUSTER_MIN_SEPARATION_KM = 75;
const EARTH_RADIUS_KM = 6371;

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

const firstValidCoordinate = (
  geometry: RouteCoordinateGeometry
): Coordinate | null => {
  for (const [longitude, latitude] of geometry.coordinates) {
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      return [longitude, latitude];
    }
  }
  return null;
};

const distanceInKilometers = (
  [firstLongitude, firstLatitude]: Coordinate,
  [secondLongitude, secondLatitude]: Coordinate
): number => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(secondLatitude - firstLatitude);
  const longitudeDelta = toRadians(secondLongitude - firstLongitude);
  const firstLatitudeRadians = toRadians(firstLatitude);
  const secondLatitudeRadians = toRadians(secondLatitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitudeRadians) *
      Math.cos(secondLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  const clampedHaversine = Math.min(1, haversine);

  return (
    2 *
    EARTH_RADIUS_KM *
    Math.atan2(Math.sqrt(clampedHaversine), Math.sqrt(1 - clampedHaversine))
  );
};

const primaryRouteIndexes = (
  geometries: readonly RouteCoordinateGeometry[]
): number[] | null => {
  const anchoredRoutes = geometries.flatMap((geometry, geometryIndex) => {
    const anchor = firstValidCoordinate(geometry);
    return anchor ? [{ anchor, geometryIndex }] : [];
  });

  if (anchoredRoutes.length < PRIMARY_CLUSTER_MIN_TOTAL_ROUTE_COUNT) {
    return null;
  }

  const parents = anchoredRoutes.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  };
  const union = (firstIndex: number, secondIndex: number) => {
    const firstRoot = findRoot(firstIndex);
    const secondRoot = findRoot(secondIndex);
    if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
  };

  for (
    let firstIndex = 0;
    firstIndex < anchoredRoutes.length;
    firstIndex += 1
  ) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < anchoredRoutes.length;
      secondIndex += 1
    ) {
      if (
        distanceInKilometers(
          anchoredRoutes[firstIndex].anchor,
          anchoredRoutes[secondIndex].anchor
        ) <= PRIMARY_CLUSTER_RADIUS_KM
      ) {
        union(firstIndex, secondIndex);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  anchoredRoutes.forEach((_, index) => {
    const root = findRoot(index);
    const cluster = clusters.get(root) ?? [];
    cluster.push(index);
    clusters.set(root, cluster);
  });
  const sortedClusters = [...clusters.values()].sort(
    (first, second) => second.length - first.length
  );
  const primaryCluster = sortedClusters[0] ?? [];
  const secondClusterSize = sortedClusters[1]?.length ?? 0;
  const primaryShare = primaryCluster.length / anchoredRoutes.length;

  if (
    primaryCluster.length < PRIMARY_CLUSTER_MIN_ROUTE_COUNT ||
    primaryShare < PRIMARY_CLUSTER_MIN_SHARE ||
    (secondClusterSize > 0 &&
      primaryCluster.length / secondClusterSize <
        PRIMARY_CLUSTER_MIN_LEAD_RATIO)
  ) {
    return null;
  }

  const primaryCenter = primaryCluster.reduce<Coordinate>(
    ([longitudeSum, latitudeSum], routeIndex) => [
      longitudeSum + anchoredRoutes[routeIndex].anchor[0],
      latitudeSum + anchoredRoutes[routeIndex].anchor[1],
    ],
    [0, 0]
  );
  primaryCenter[0] /= primaryCluster.length;
  primaryCenter[1] /= primaryCluster.length;

  const primaryRouteIndexSet = new Set(primaryCluster);
  const hasDistantRoutes = anchoredRoutes.some(
    ({ anchor }, routeIndex) =>
      !primaryRouteIndexSet.has(routeIndex) &&
      distanceInKilometers(primaryCenter, anchor) >=
        PRIMARY_CLUSTER_MIN_SEPARATION_KM
  );
  if (!hasDistantRoutes) return null;

  return primaryCluster.map(
    (routeIndex) => anchoredRoutes[routeIndex].geometryIndex
  );
};

export const fitPrimaryRouteGeometries = (
  geometries: readonly RouteCoordinateGeometry[]
): RouteViewState => {
  const routeIndexes = primaryRouteIndexes(geometries);
  if (!routeIndexes) return fitRouteGeometries(geometries);

  return fitRouteGeometries(routeIndexes.map((index) => geometries[index]));
};
