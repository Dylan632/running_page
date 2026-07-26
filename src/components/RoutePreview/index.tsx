import React from 'react';
import {
  getRouteBounds,
  normalizeRouteGeometries,
} from '@/modules/routeGeometry';
import type { Activity, ActivityId } from '@/utils/utils';
import { NO_ROUTE_DATA, INVALID_ROUTE_DATA, INDOOR_COLOR } from '@/utils/const';
import styles from './style.module.css';

const ROUTE_PREVIEW_COLORS = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
];

interface RoutePreviewProps {
  activities: Activity[];
  className?: string;
}

const RoutePreview: React.FC<RoutePreviewProps> = ({
  activities,
  className,
}) => {
  // Filter activities that have polyline data
  const activitiesWithRoutes = React.useMemo(
    () => activities.filter((activity) => activity.summary_polyline),
    [activities]
  );
  const routeGeometries = React.useMemo(
    () => normalizeRouteGeometries(activitiesWithRoutes),
    [activitiesWithRoutes]
  );

  if (activitiesWithRoutes.length === 0) {
    return (
      <div className={`${styles.routePreview} ${className || ''}`}>
        <div className={styles.noRoute}>{NO_ROUTE_DATA}</div>
      </div>
    );
  }

  // Get all route coordinates
  const previewRoutes: Array<{
    runId: ActivityId;
    coordinates: [number, number][];
    color: string;
    indoor: boolean;
  }> = routeGeometries.map((routeGeometry, index) => {
    const activity = activitiesWithRoutes[index];
    const indoor =
      activity.subtype === 'indoor' || activity.subtype === 'treadmill';
    // Use different colors for multiple routes
    const color = indoor
      ? INDOOR_COLOR
      : ROUTE_PREVIEW_COLORS[index % ROUTE_PREVIEW_COLORS.length];
    return {
      runId: routeGeometry.runId,
      coordinates: routeGeometry.coordinates,
      color,
      indoor,
    };
  });

  // Calculate bounding box for all routes
  const routeBounds = getRouteBounds(previewRoutes);
  if (!routeBounds) {
    return (
      <div className={`${styles.routePreview} ${className || ''}`}>
        <div className={styles.noRoute}>{INVALID_ROUTE_DATA}</div>
      </div>
    );
  }

  // Add padding to bounds
  const padding = 0.001;
  const bounds = {
    minLat: routeBounds.south - padding,
    maxLat: routeBounds.north + padding,
    minLng: routeBounds.west - padding,
    maxLng: routeBounds.east + padding,
  };

  const boundsWidth = bounds.maxLng - bounds.minLng;
  const boundsHeight = bounds.maxLat - bounds.minLat;

  // SVG dimensions
  const svgWidth = 250;
  const svgHeight = 150;
  const svgPadding = 10;
  const drawWidth = svgWidth - 2 * svgPadding;
  const drawHeight = svgHeight - 2 * svgPadding;

  // Convert coordinate to SVG coordinate
  const coordToSvg = (lng: number, lat: number): [number, number] => {
    const x = svgPadding + ((lng - bounds.minLng) / boundsWidth) * drawWidth;
    const y = svgPadding + ((bounds.maxLat - lat) / boundsHeight) * drawHeight;
    return [x, y];
  };

  return (
    <div className={`${styles.routePreview} ${className || ''}`}>
      <svg width={svgWidth} height={svgHeight} className={styles.routeSvg}>
        {/* Background */}
        <rect
          width={svgWidth}
          height={svgHeight}
          fill="var(--color-activity-card)"
        />

        {/* Routes */}
        {previewRoutes.map((route) => {
          if (route.coordinates.length < 2) return null;

          const pathString = route.coordinates
            .map((coord, index) => {
              const [x, y] = coordToSvg(coord[0], coord[1]);
              return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
            })
            .join(' ');

          return (
            <g key={route.runId}>
              {/* Route line */}
              <path
                d={pathString}
                fill="none"
                stroke={route.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={route.indoor ? 0.6 : 0.8}
                strokeDasharray={route.indoor ? '4,3' : undefined}
              />

              {/* Start point */}
              {route.coordinates.length > 0 && (
                <circle
                  cx={
                    coordToSvg(
                      route.coordinates[0][0],
                      route.coordinates[0][1]
                    )[0]
                  }
                  cy={
                    coordToSvg(
                      route.coordinates[0][0],
                      route.coordinates[0][1]
                    )[1]
                  }
                  r="3"
                  fill="#2ecc71"
                  stroke="white"
                  strokeWidth="1"
                />
              )}

              {/* End point */}
              {route.coordinates.length > 1 && (
                <circle
                  cx={
                    coordToSvg(
                      route.coordinates[route.coordinates.length - 1][0],
                      route.coordinates[route.coordinates.length - 1][1]
                    )[0]
                  }
                  cy={
                    coordToSvg(
                      route.coordinates[route.coordinates.length - 1][0],
                      route.coordinates[route.coordinates.length - 1][1]
                    )[1]
                  }
                  r="3"
                  fill="#e74c3c"
                  stroke="white"
                  strokeWidth="1"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default RoutePreview;
