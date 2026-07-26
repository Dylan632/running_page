import {
  lazy,
  type ComponentType,
  type LazyExoticComponent,
  type SVGProps,
} from 'react';
import type { ActivityMode } from '@/modules/activity/profiles';
import { loadSvgComponent } from '@/utils/svgUtils';

export type PosterLoader = () => Promise<unknown>;
export type PosterLoaderMap = Record<string, PosterLoader>;
export type PosterComponent = LazyExoticComponent<
  ComponentType<SVGProps<SVGSVGElement>>
>;
export type PosterComponentMap = Record<string, PosterComponent>;

const allPosterAssets = import.meta.glob<false, string, PosterLoader>(
  ['./running/*.svg', './cycling/*.svg'],
  {
    import: 'ReactComponent',
  }
);

const allPosterComponents: PosterComponentMap = Object.fromEntries(
  Object.keys(allPosterAssets).map((path) => [
    path,
    lazy(() => loadSvgComponent(allPosterAssets, path)),
  ])
);

const select = <T,>(
  source: Record<string, T>,
  mode: ActivityMode,
  predicate: (name: string) => boolean
): Record<string, T> =>
  Object.fromEntries(
    Object.entries(source).filter(([path]) => {
      const prefix = `./${mode}/`;
      return path.startsWith(prefix) && predicate(path.slice(prefix.length));
    })
  );

const groupPosters = <T,>(source: Record<string, T>, mode: ActivityMode) => ({
  all: select(source, mode, () => true),
  yearStats: select(source, mode, (name) => /^year_\d{4}\.svg$/.test(name)),
  yearSummaryStats: select(source, mode, (name) =>
    /^year_summary_\d{4}\.svg$/.test(name)
  ),
  githubYearStats: select(source, mode, (name) =>
    /^github_\d{4}\.svg$/.test(name)
  ),
  totalStat: select(source, mode, (name) =>
    /^(?:github|grid|mol[^/]*)\.svg$/.test(name)
  ),
});

const posterAssets = {
  running: groupPosters(allPosterAssets, 'running'),
  cycling: groupPosters(allPosterAssets, 'cycling'),
};

const posterComponents = {
  running: groupPosters(allPosterComponents, 'running'),
  cycling: groupPosters(allPosterComponents, 'cycling'),
};

export const getPosterAssets = (mode: ActivityMode) => posterAssets[mode];
export const getPosterComponents = (mode: ActivityMode) =>
  posterComponents[mode];
