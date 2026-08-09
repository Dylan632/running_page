export type CanvasWithWebGLContext = Pick<HTMLCanvasElement, 'getContext'>;

/**
 * Check whether the browser can create a WebGL context before Mapbox starts.
 * Mapbox reports this failure asynchronously, after its container has already
 * been mounted, which otherwise leaves an empty map area on the page.
 */
export const canCreateWebGLContext = (
  canvas: CanvasWithWebGLContext
): boolean => {
  try {
    const contextAttributes = { failIfMajorPerformanceCaveat: false };
    const context =
      canvas.getContext('webgl2', contextAttributes) ??
      canvas.getContext('webgl', contextAttributes) ??
      canvas.getContext('experimental-webgl', contextAttributes);

    if (!context) return false;

    return !(
      'isContextLost' in context &&
      typeof context.isContextLost === 'function' &&
      context.isContextLost()
    );
  } catch {
    return false;
  }
};

export const hasUsableWebGL = (): boolean => {
  if (typeof document === 'undefined') return true;
  try {
    return canCreateWebGLContext(document.createElement('canvas'));
  } catch {
    return false;
  }
};
