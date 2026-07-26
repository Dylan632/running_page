import process from 'node:process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';

const siteTitle = 'Dylan 的运动记录';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'html-site-title',
      transformIndexHtml(html) {
        return html.replace(
          /<title>.*?<\/title>/,
          `<title>${siteTitle}</title>`
        );
      },
    },
    react(),
    tailwindcss(),
    svgr({
      include: ['**/*.svg'],
      svgrOptions: {
        exportType: 'named',
        namedExport: 'ReactComponent',
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
        svgoConfig: {
          floatPrecision: 2,
          plugins: [
            {
              name: 'preset-default',
              params: {
                overrides: {
                  removeTitle: false,
                  removeViewBox: false,
                },
              },
            },
          ],
        },
      },
    }),
  ],
  base: process.env.PATH_PREFIX || '/',
  define: {
    'import.meta.env.VERCEL': JSON.stringify(process.env.VERCEL),
  },
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    manifest: true,
    modulePreload: false,
    outDir: './dist', // for user easy to use, vercel use default dir -> dist
  },
});
