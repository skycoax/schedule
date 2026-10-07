import React from 'react';
import { Composition } from 'remotion';
import { ParaPromo } from './Video';
import { FPS, W, H, DURATION } from './timeline';

export const Root: React.FC = () => (
  <Composition id="Para" component={ParaPromo} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={W} height={H} />
);
