const ROUTE_LAYER_IDS = new Set(['runs2', 'runs2-indoor', 'animated-run']);

export const shouldInstallMapboxLanguage = (
  mapTileVendor: string,
  isChinese: boolean
): boolean => isChinese && mapTileVendor === 'mapbox';

interface MapLightTarget {
  isStyleLoaded?: () => boolean;
  getStyle: () => {
    layers?: Array<{ id: string }>;
  };
  setLayoutProperty: (
    layerId: string,
    property: 'visibility',
    value: 'visible' | 'none'
  ) => unknown;
  getLayoutProperty?: (layerId: string, property: 'visibility') => unknown;
}

export const setMapLightVisibility = (
  map: MapLightTarget,
  lights: boolean
): void => {
  // A Map ref is available before its remote style finishes loading. Calling
  // getStyle() during that window throws and used to force the route fallback.
  if (map.isStyleLoaded && !map.isStyleLoaded()) return;

  const visibility = lights ? 'visible' : 'none';

  for (const { id } of map.getStyle().layers ?? []) {
    if (ROUTE_LAYER_IDS.has(id)) continue;

    const currentVisibility =
      map.getLayoutProperty?.(id, 'visibility') ?? 'visible';
    if (currentVisibility !== visibility) {
      map.setLayoutProperty(id, 'visibility', visibility);
    }
  }
};
