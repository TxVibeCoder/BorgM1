/**
 * The shell. ONE 7:4 design-space stage (src/ui/stage.ts), scaled uniformly to fill
 * the window beneath the chrome band, with everything inside authored in design px.
 *
 * PHASE 0: the stage is empty. Phase 3 mounts the panel regions into it, laid out from
 * UI-SPEC.md's percentage table via `pctRect`. The scaling model is the piece worth
 * getting right now, because every later coordinate depends on it: one transform, at
 * one place, on the whole stage — no component ever scales itself.
 */

import { useEffect, useState } from 'react';
import './styles.css';
import { STAGE } from './stage';
import { ErrorOverlay } from './ErrorOverlay';

/**
 * Screen-pixel height of the out-of-stage chrome, subtracted from the window height
 * before the stage is scaled to fit. Zero until a phase adds a chrome bar; keep in
 * lockstep with --chrome-h in styles.css.
 */
export const CHROME_H = 0;

/** Never shrink below this — a stage too small to read is worse than one that scrolls. */
export const MIN_SCALE = 0.25;

/** Uniform fit: the larger dimension binds, so the 7:4 box never distorts. */
export function computeScale(winW: number, winH: number): number {
  const usableH = Math.max(1, winH - CHROME_H);
  return Math.max(MIN_SCALE, Math.min(winW / STAGE.w, usableH / STAGE.h));
}

export function App() {
  const [scale, setScale] = useState(() =>
    computeScale(
      typeof window === 'undefined' ? STAGE.w : window.innerWidth,
      typeof window === 'undefined' ? STAGE.h : window.innerHeight,
    ),
  );

  useEffect(() => {
    const onResize = () => setScale(computeScale(window.innerWidth, window.innerHeight));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <>
      <div className="stage-viewport">
        <main
          className="stage"
          data-testid="stage"
          style={{
            width: STAGE.w,
            height: STAGE.h,
            transform: `scale(${scale})`,
          }}
        >
          <div className="shell-placeholder" data-testid="shell-placeholder">
            <div className="shell-placeholder__title">BorgM1</div>
            <div className="shell-placeholder__sub">Phase 0 · shell only</div>
          </div>
        </main>
      </div>
      <ErrorOverlay />
    </>
  );
}
