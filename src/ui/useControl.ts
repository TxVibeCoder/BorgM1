/**
 * Store subscriptions for the panel.
 *
 * THE CONTRACT (src/ui/CONVENTIONS.md): a hook subscribes to the store, selects ONE
 * control's value, and bails out when it is unchanged — so a store write re-renders only
 * the control it changed. Never subscribe a panel component to the whole store.
 *
 * `useSyncExternalStore` provides the bail-out itself: it compares the snapshot with
 * `Object.is` and skips the render when they match. That is why `getProgramParam` returns
 * the raw value rather than going through `getState()`, which deep-copies through the JSON
 * codec and would therefore return a fresh object every time and defeat the comparison
 * entirely — 139 controls re-rendering on every knob movement.
 */

import { useSyncExternalStore } from 'react';
import { m1Store } from '../state/store';

/** One program parameter's current value. */
export function useControl(id: string): number | string {
  return useSyncExternalStore(
    (cb) => m1Store.subscribe(cb),
    () => m1Store.getProgramParam(id) ?? 0,
    () => m1Store.getProgramParam(id) ?? 0,
  );
}

/**
 * The oscillator mode. UI-SPEC §4: this is THE flag — every `2` control greys out when it
 * is not DOUBLE, from one subscription rather than 60.
 */
export function useOscMode(): string {
  return useSyncExternalStore(
    (cb) => m1Store.subscribe(cb),
    () => m1Store.oscMode,
    () => m1Store.oscMode,
  );
}

/** True when oscillator 2 is live. The single `enabled` flag the panel passes down. */
export function useOsc2Enabled(): boolean {
  return useOscMode() === 'DOUBLE';
}

export function useProgramName(): string {
  return useSyncExternalStore(
    (cb) => m1Store.subscribe(cb),
    () => m1Store.programName,
    () => m1Store.programName,
  );
}

/** Whether a plugin-era extension is on. They default OFF and must heal to OFF (CLAUDE.md). */
export function useExtension(id: 'resonance' | 'insertFx'): boolean {
  return useSyncExternalStore(
    (cb) => m1Store.subscribe(cb),
    () => m1Store.getExtension(id),
    () => m1Store.getExtension(id),
  );
}

// ---- effects ---------------------------------------------------------------------------
//
// Every one of these selects a PRIMITIVE, not the slot object. `useSyncExternalStore` bails
// out with `Object.is`, and `setEffectParam` mutates the params bag in place — so a hook that
// returned the slot would compare equal and never re-render, while one that returned a fresh
// object would re-render everything on every frame of a drag. Primitives avoid both.

/** Which algorithm a slot holds: 0 = NO EFFECT, 1..33. */
export function useEffectType(slot: 1 | 2): number {
  return useSyncExternalStore(
    (cb) => m1Store.subscribe(cb),
    () => m1Store.getEffectSlot(slot).type,
    () => m1Store.getEffectSlot(slot).type,
  );
}

export function useEffectParam(slot: 1 | 2, id: string): number | string {
  return useSyncExternalStore(
    (cb) => m1Store.subscribe(cb),
    () => m1Store.getEffectParam(slot, id) ?? 0,
    () => m1Store.getEffectParam(slot, id) ?? 0,
  );
}

export function useEffectBalance(slot: 1 | 2, which: 'A' | 'B'): number {
  const read = () => {
    const s = m1Store.getEffectSlot(slot);
    return which === 'A' ? s.balanceA : s.balanceB;
  };
  return useSyncExternalStore((cb) => m1Store.subscribe(cb), read, read);
}

/** true = SERIAL, false = PARALLEL. */
export function useEffectSerial(): boolean {
  return useSyncExternalStore(
    (cb) => m1Store.subscribe(cb),
    () => m1Store.effects.serial,
    () => m1Store.effects.serial,
  );
}
