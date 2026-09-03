const CARTO_PROXY_ROUTES = {
  'basemaps.cartocdn.com': '/map-proxy/style',
  'tiles.basemaps.cartocdn.com': '/map-proxy/tiles',
} as const;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Build a same-origin URL for a Carto resource. The Vercel Function receives
 * the encoded target and fetches it server-side, so the browser does not need
 * direct access to Carto.
 */
export const getCartoProxyUrl = (
  requestUrl: string,
  origin: string
): string | null => {
  try {
    const target = new URL(requestUrl);
    const proxyPath =
      CARTO_PROXY_ROUTES[target.hostname as keyof typeof CARTO_PROXY_ROUTES];
    if (target.protocol !== 'https:' || !proxyPath) return null;

    const proxyUrl = new URL('/api/map-proxy', origin);
    proxyUrl.searchParams.set('url', requestUrl);
    return proxyUrl.toString();
  } catch {
    return null;
  }
};

/**
 * Keep local development and browser tests direct, but proxy Carto resources
 * from deployed pages so the browser never has to reach Carto itself.
 */
export const transformCartoRequest = (requestUrl: string): { url: string } => {
  if (typeof window === 'undefined') return { url: requestUrl };
  if (LOCAL_HOSTNAMES.has(window.location.hostname)) return { url: requestUrl };

  return {
    url: getCartoProxyUrl(requestUrl, window.location.origin) ?? requestUrl,
  };
};
