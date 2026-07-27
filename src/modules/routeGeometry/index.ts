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

const PRIMARY_CLUSTER_RADIUS_KM = 30;
const PRIMARY_CLUSTER_MIN_ROUTE_COUNT = 2;
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

const centerForAnchors = (
  anchors: readonly Coordinate[],
  anchorIndexes: readonly number[]
): Coordinate => {
  const center = anchorIndexes.reduce<Coordinate>(
    ([longitudeSum, latitudeSum], anchorIndex) => [
      longitudeSum + anchors[anchorIndex][0],
      latitudeSum + anchors[anchorIndex][1],
    ],
    [0, 0]
  );
  center[0] /= anchorIndexes.length;
  center[1] /= anchorIndexes.length;
  return center;
};

const densestAnchorCluster = (
  anchors: readonly Coordinate[],
  candidateIndexes: readonly number[]
): number[] => {
  let densestCluster: number[] = [];

  for (const centerIndex of candidateIndexes) {
    const cluster = candidateIndexes.filter(
      (candidateIndex) =>
        distanceInKilometers(anchors[centerIndex], anchors[candidateIndex]) <=
        PRIMARY_CLUSTER_RADIUS_KM
    );
    if (cluster.length > densestCluster.length) densestCluster = cluster;
  }

  return densestCluster;
};

const primaryRouteAnchors = (
  geometries: readonly RouteCoordinateGeometry[]
): Coordinate[] | null => {
  const anchors = geometries.flatMap((geometry) => {
    const anchor = firstValidCoordinate(geometry);
    return anchor ? [anchor] : [];
  });
  const allAnchorIndexes = anchors.map((_, index) => index);
  const primaryCluster = densestAnchorCluster(anchors, allAnchorIndexes);
  const primaryClusterSet = new Set(primaryCluster);
  const remainingAnchorIndexes = allAnchorIndexes.filter(
    (index) => !primaryClusterSet.has(index)
  );
  const secondClusterSize = densestAnchorCluster(
    anchors,
    remainingAnchorIndexes
  ).length;
  const primaryShare = primaryCluster.length / anchors.length;

  if (
    primaryCluster.length < PRIMARY_CLUSTER_MIN_ROUTE_COUNT ||
    primaryShare < PRIMARY_CLUSTER_MIN_SHARE ||
    (secondClusterSize > 0 &&
      primaryCluster.length / secondClusterSize <
        PRIMARY_CLUSTER_MIN_LEAD_RATIO)
  ) {
    return null;
  }

  const primaryCenter = centerForAnchors(anchors, primaryCluster);
  const hasDistantRoutes = anchors.some(
    (anchor, routeIndex) =>
      !primaryClusterSet.has(routeIndex) &&
      distanceInKilometers(primaryCenter, anchor) >=
        PRIMARY_CLUSTER_MIN_SEPARATION_KM
  );
  if (!hasDistantRoutes) return null;

  return primaryCluster.map((routeIndex) => anchors[routeIndex]);
};

export const fitPrimaryRouteGeometries = (
  geometries: readonly RouteCoordinateGeometry[]
): RouteViewState => {
  const routeAnchors = primaryRouteAnchors(geometries);
  if (!routeAnchors) return fitRouteGeometries(geometries);

  return fitRouteGeometries(
    routeAnchors.map((anchor) => ({ coordinates: [anchor] }))
  );
};
