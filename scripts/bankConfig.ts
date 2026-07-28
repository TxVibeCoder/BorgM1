/**
 * Build-time configuration for the sample bank. BUILD ONLY — nothing in `src/` imports
 * this, and nothing here ships to the browser.
 *
 * The SF2 is NOT vendored into this repo: FluidR3_GM is 141 MB, and committing it would
 * dominate the repository for a file the app never loads (the app loads the *built bank*).
 * Point `BORGM1_SF2` at your copy, or drop one at `assets/FluidR3_GM.sf2` (gitignored).
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Candidate locations, in priority order. First one that exists wins. */
const CANDIDATES = [
  process.env['BORGM1_SF2'],
  resolve(process.cwd(), 'assets/FluidR3_GM.sf2'),
  resolve(process.cwd(), '../BorgM1-research/FluidR3_GM.sf2'),
  // A local sibling checkout may already carry a copy; use it rather than asking for a
  // second 141 MB download. Treated as read-only. Override with BORGM1_SF2.
  resolve(process.cwd(), process.env['BORGM1_SF2_SIBLING'] ?? '../sf2/FluidR3_GM.sf2'),
].filter((p): p is string => typeof p === 'string' && p.length > 0);

/** Resolve the SF2 path, or throw with the list of places that were checked. */
export function resolveSf2Path(): string {
  for (const c of CANDIDATES) if (existsSync(c)) return c;
  throw new Error(
    `FluidR3_GM.sf2 not found. Set BORGM1_SF2, or place it at assets/FluidR3_GM.sf2.\nChecked:\n  ${CANDIDATES.join('\n  ')}`,
  );
}

/** Convenience for scripts that want a default without handling the throw themselves. */
export const DEFAULT_SF2_PATH: string = (() => {
  try {
    return resolveSf2Path();
  } catch {
    return CANDIDATES[1] ?? 'assets/FluidR3_GM.sf2';
  }
})();

/** Where the built bank lands. Gitignored — it is generated, not authored. */
export const BANK_OUT_DIR = resolve(process.cwd(), 'public/bank');
