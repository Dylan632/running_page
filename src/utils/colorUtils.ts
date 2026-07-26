/**
 * Color utility functions for theme-aware color adjustments
 */
import { getEffectiveTheme } from './themeUtils';

export type Theme = 'light' | 'dark';

/**
 * Converts a hex color to RGB values
 * @param hex - The hex color string (e.g., '#ff0000' or 'ff0000')
 * @returns RGB values as [r, g, b] or null if invalid
 */
export const hexToRgb = (hex: string): [number, number, number] | null => {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6) return null;

  const num = parseInt(cleanHex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  return [r, g, b];
};

/**
 * Converts RGB values to hex color
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns Hex color string
 */
export const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Converts RGB to HSL
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns HSL values as [h, s, l] where h is 0-360, s and l are 0-1
 */
export const rgbToHsl = (
  r: number,
  g: number,
  b: number
): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h * 360, s, l];
};

/**
 * Converts HSL to RGB
 * @param h - Hue (0-360)
 * @param s - Saturation (0-1)
 * @param l - Lightness (0-1)
 * @returns RGB values as [r, g, b]
 */
export const hslToRgb = (
  h: number,
  s: number,
  l: number
): [number, number, number] => {
  h /= 360;

  const hueToRgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

/**
 * Gets the current theme from the DOM or Asia/Shanghai day/night.
 * @returns The current effective theme
 */
export const getCurrentTheme = (): 'light' | 'dark' => {
  return getEffectiveTheme();
};

const PRIMARY_SPECIAL_COLORS = new Set(['#ffff00', '#ffa400', 'yellow']);
const SECONDARY_SPECIAL_COLORS = new Set(['#ff0000', 'red']);

const addSpecialColorClasses = (
  elements: Element[],
  colorClass: 'svg-special-color' | 'svg-special-color2',
  colorValues: ReadonlySet<string>
): void => {
  elements.forEach((element) => {
    const fill = element.getAttribute('fill')?.toLowerCase();
    const stroke = element.getAttribute('stroke')?.toLowerCase();
    let matchesSpecialColor = false;

    if (fill && colorValues.has(fill)) {
      element.removeAttribute('fill');
      element.classList.add('svg-special-fill');
      matchesSpecialColor = true;
    }
    if (stroke && colorValues.has(stroke)) {
      element.removeAttribute('stroke');
      element.classList.add('svg-special-stroke');
      matchesSpecialColor = true;
    }
    if (matchesSpecialColor) {
      element.classList.add(colorClass);
    }
  });
};

/**
 * Updates SVG special colors dynamically based on current theme
 * This function modifies the SVG elements directly to use theme-appropriate colors
 * Supports both GitHub SVG and Grid SVG
 */
export const updateSvgSpecialColors = (): void => {
  if (typeof window === 'undefined') return;

  // Find all GitHub and Grid SVG elements
  const githubSvgs = document.querySelectorAll('.github-svg');
  const githubYearSvgs = document.querySelectorAll('.github-year-svg');
  const gridSvgs = document.querySelectorAll('.grid-svg');
  const allSvgs = [
    ...Array.from(githubSvgs),
    ...Array.from(githubYearSvgs),
    ...Array.from(gridSvgs),
  ];

  allSvgs.forEach((svg) => {
    const colorElements = Array.from(svg.querySelectorAll('[fill], [stroke]'));

    // Apply CSS classes for theme-aware coloring
    addSpecialColorClasses(
      colorElements,
      'svg-special-color',
      PRIMARY_SPECIAL_COLORS
    );
    addSpecialColorClasses(
      colorElements,
      'svg-special-color2',
      SECONDARY_SPECIAL_COLORS
    );
  });
};

/**
 * @deprecated Use updateSvgSpecialColors instead
 * Updates GitHub SVG special colors dynamically based on current theme
 */
export const updateGithubSvgSpecialColors = updateSvgSpecialColors;

/**
 * Initializes SVG color adjustments for both GitHub and Grid SVGs
 * Call this function when the page loads or when theme changes
 */
export const initSvgColorAdjustments = (): void => {
  // Apply initial adjustments
  updateSvgSpecialColors();

  // Listen for theme changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'data-theme'
      ) {
        updateSvgSpecialColors();
      }
    });
  });

  // Watch for theme changes on document element
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
};

/**
 * @deprecated Use initSvgColorAdjustments instead
 * Initializes GitHub SVG color adjustments
 */
export const initGithubSvgColorAdjustments = initSvgColorAdjustments;
