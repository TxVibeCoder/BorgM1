/**
 * Store subscriptions for the Combination panel.
 *
 * Same contract as `useControl` and for the same reason: each hook selects ONE PRIMITIVE and
 * `useSyncExternalStore` bails out with `Object.is`, so a store write re-renders only the
 * control it changed. Eight timbre rows of six controls each is 48 subscriptions, and a hook
 * returning an object here would re-render all of them on every frame of a level drag.
 */

import { useSyncExternalStore } from 'react';
import { m1Store } from '../state/store';

const subscribe = (cb: () => void): (() => void) => m1Store.subscribe(cb);

function select<T>(read: () => T): T {
  return useSyncExternalStore(subscribe, read, read);
}

/** One combination parameter's current value. `T3_LEVEL`, `COMBI_TYPE`, and so on. */
export function useCombiParam(id: string): number | string {
  return select(() => m1Store.getCombiParam(id) ?? 0);
}

/** A per-timbre parameter, by row. `useTimbreParam(2, 'LEVEL')` reads `T3_LEVEL`. */
export function useTimbreParam(timbre: number, param: string): number | string {
  return useCombiParam(`T${timbre + 1}_${param}`);
}

/**
 * The combination type. THE flag for this mode, the way OSC MODE is for the program panel:
 * it decides how many timbre rows are live and which edit page the centre column shows.
 */
export function useCombiType(): string {
  return select(() => m1Store.combiType);
}

export function useCombiName(): string {
  return select(() => m1Store.combiName);
}

export function useTimbreSolo(timbre: number): boolean {
  return select(() => m1Store.getTimbreSolo(timbre));
}

/** True when ANY timbre is soloed — what dims every un-soloed row. */
export function useAnySolo(): boolean {
  return select(() => m1Store.anySolo);
}

export function useMode(): string {
  return select(() => m1Store.mode);
}
