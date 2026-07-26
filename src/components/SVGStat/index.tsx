import { Suspense } from 'react';
import { getPosterComponents } from '@assets/index';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import type { ActivityMode } from '@/modules/activity/profiles';

const posterPath = (mode: ActivityMode, name: string) => `./${mode}/${name}`;

const SVGStat = () => {
  const { mode } = useActivityMode();
  const posters = getPosterComponents(mode).totalStat;
  const GithubSvg = posters[posterPath(mode, 'github.svg')];
  const GridSvg = posters[posterPath(mode, 'grid.svg')];

  return (
    <div id="svgStat" data-activity-mode={mode}>
      <Suspense fallback={<div className="text-center">Loading...</div>}>
        {GithubSvg && <GithubSvg className="github-svg mt-4 h-auto w-full" />}
        {GridSvg && <GridSvg className="grid-svg mt-4 h-auto w-full" />}
      </Suspense>
    </div>
  );
};

export default SVGStat;
