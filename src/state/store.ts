/**
 * THE store instance.
 *
 * `m1State.ts` defines the tree and the M1Store class; this file is the one place the app's
 * singleton is created. Separate module on purpose: tests construct their own M1Store with
 * a fixture tree, and importing the class from a module that also instantiates a live
 * singleton would give every test file a shared mutable global.
 *
 * Lives OUTSIDE React (src/ui/CONVENTIONS.md): components subscribe and select, the engine
 * bridge reads it imperatively, and nothing owns it.
 */

import { M1Store } from './m1State';

export const m1Store = new M1Store();
