/**
 * DWGS / geometric waveform synthesis — PURE, no Web Audio types, Node-testable.
 *
 * Multisounds 77..99 were COMPUTED on the hardware, not recorded. Korg's DWGS (Digital
 * Waveform Generator System) stored harmonic amplitude tables and summed them, so
 * generating these additively here is not an approximation of the method — it IS the
 * method. Only the tables differ.
 *
 * THE TABLES ARE A DESIGN CHOICE, NOT AN M1 FACT. Korg never published the DWGS harmonic
 * sets. The geometric waves (sine, triangle, square, saw, 25%/10% pulse) are exactly
 * defined and are exactly right; everything named `DWGS <instrument>` below is an
 * authored approximation of a timbre, chosen to sit in the right family. Labelled
 * accordingly in every entry. Do not let a later session mistake them for measurements.
 *
 * WHY ADDITIVE RATHER THAN OFFLINE-RENDERING: this runs in Node at build time, where
 * there is no OfflineAudioContext. It is also strictly better here — a wave summed from
 * harmonics is band-limited by construction (no partial above Nyquist is ever created,
 * so there is nothing to alias), and its loop is seamless by construction because the
 * table IS exactly one period.
 */

/**
 * Samples per cycle. 256 at the 32 kHz bank rate puts the root at exactly 125 Hz, so the
 * loop length is an integer and the wave is perfectly periodic across it — the loop-seam
 * problem cannot occur for these at all.
 */
export const DWGS_TABLE_SIZE = 256;

/**
 * Root pitch of a 256-sample cycle at 32 kHz: 32000/256 = 125 Hz.
 * 125 Hz is MIDI 47.21, i.e. note 47 (B2) plus 21 cents.
 */
export const DWGS_ROOT_KEY = 47;
export const DWGS_ROOT_FINE_CENTS = 21;

/**
 * Harmonic amplitudes, index 0 = fundamental. Negative values invert the partial's phase,
 * which matters for the geometric waves (a triangle needs alternating signs) and changes
 * the crest factor, though not the perceived timbre, elsewhere.
 */
export type HarmonicTable = readonly number[];

/** Amplitude of harmonic n (1-based) for an ideal sawtooth: 1/n, all harmonics. */
function sawTable(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 1 / (i + 1));
}

/** Square: odd harmonics only, 1/n. */
function squareTable(n: number): number[] {
  return Array.from({ length: n }, (_, i) => ((i + 1) % 2 === 1 ? 1 / (i + 1) : 0));
}

/** Triangle: odd harmonics, 1/n^2, alternating sign. */
function triangleTable(n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const h = i + 1;
    if (h % 2 === 0) return 0;
    const k = (h - 1) / 2;
    return (k % 2 === 0 ? 1 : -1) / (h * h);
  });
}

/**
 * Pulse of a given duty cycle: harmonic n has amplitude |sin(pi n d)| / n.
 * Exact, not an approximation — this is the Fourier series of a rectangular pulse.
 */
function pulseTable(n: number, duty: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const h = i + 1;
    return (2 / (Math.PI * h)) * Math.sin(Math.PI * h * duty);
  });
}

/** Build a table from an explicit sparse spec: [harmonicNumber, amplitude][]. */
function sparse(pairs: ReadonlyArray<readonly [number, number]>, n: number): number[] {
  const t = new Array<number>(n).fill(0);
  for (const [h, a] of pairs) if (h >= 1 && h <= n) t[h - 1] = a;
  return t;
}

/** Highest harmonic representable in the table without aliasing (Nyquist of the table). */
export const MAX_HARMONIC = DWGS_TABLE_SIZE / 2;

export interface DwgsRecipe {
  /** Multisound index this recipe produces. */
  index: number;
  name: string;
  harmonics: HarmonicTable;
  /**
   * true when the table is the mathematically exact definition of a named waveform, false
   * when it is an authored approximation of a timbre Korg never published.
   */
  exact: boolean;
  /** Short note on where the shape came from. */
  note: string;
}

const N = MAX_HARMONIC;

/**
 * The 23 computed multisounds, 77..99. Order and names come straight from data/sounds.ts;
 * only the harmonic content is authored here.
 */
export const DWGS_RECIPES: readonly DwgsRecipe[] = [
  // --- electric pianos: fundamental plus a bell-like upper partial, the classic tine sound
  {
    index: 77,
    name: 'DWGS EP1',
    harmonics: sparse([[1, 1], [2, 0.28], [3, 0.12], [4, 0.34], [5, 0.06], [8, 0.15], [12, 0.05]], N),
    exact: false,
    note: 'tine EP: fundamental + a strong 4th and 8th for the bell component',
  },
  {
    index: 78,
    name: 'DWGS EP2',
    harmonics: sparse([[1, 1], [2, 0.5], [3, 0.22], [4, 0.18], [6, 0.09], [9, 0.05]], N),
    exact: false,
    note: 'warmer EP, more even harmonics and less bell',
  },
  {
    index: 79,
    name: 'DWGS EP3',
    harmonics: sparse([[1, 1], [3, 0.4], [5, 0.22], [7, 0.12], [9, 0.07], [11, 0.04]], N),
    exact: false,
    note: 'reedy EP, odd-harmonic weighted',
  },
  {
    index: 80,
    name: 'DWGS Piano',
    harmonics: Array.from({ length: N }, (_, i) => (i < 16 ? 1 / Math.pow(i + 1, 1.35) : 0)),
    exact: false,
    note: 'piano-ish: first 16 harmonics rolling off faster than 1/n',
  },
  {
    index: 81,
    name: 'DWGS Clav',
    harmonics: Array.from({ length: N }, (_, i) => (i < 32 ? 1 / Math.pow(i + 1, 0.7) : 0)),
    exact: false,
    note: 'clav: bright, slow harmonic rolloff, all harmonics',
  },
  {
    index: 82,
    name: 'DWGS Vibe1',
    harmonics: sparse([[1, 1], [4, 0.42], [10, 0.12]], N),
    exact: false,
    note: 'vibraphone: fundamental + 4th (two octaves) + a faint 10th, the bar modes',
  },
  {
    index: 83,
    name: 'DWGS Bass1',
    harmonics: sparse([[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05]], N),
    exact: false,
    note: 'round synth bass, steep rolloff',
  },
  {
    index: 84,
    name: 'DWGS Bass2',
    harmonics: sparse([[1, 1], [2, 0.6], [3, 0.42], [4, 0.3], [5, 0.22], [6, 0.15], [7, 0.1]], N),
    exact: false,
    note: 'brighter synth bass',
  },
  {
    index: 85,
    name: 'DWGS Bell1',
    harmonics: sparse([[1, 0.7], [2, 0.3], [3, 0.15], [5, 0.5], [7, 0.3], [11, 0.2], [13, 0.12]], N),
    exact: false,
    note: 'bell: sparse high partials, weak fundamental — harmonic stand-in for a truly inharmonic spectrum',
  },
  {
    index: 86,
    name: 'DWGS Orgn1',
    harmonics: sparse([[1, 1], [2, 0.7], [3, 0.5], [4, 0.35], [6, 0.2], [8, 0.15]], N),
    exact: false,
    note: 'drawbar organ: harmonics on the drawbar footages 16/8/5+1/3/4/2+2/3/1',
  },
  {
    index: 87,
    name: 'DWGS Orgn2',
    harmonics: sparse([[1, 1], [2, 0.35], [3, 0.8], [4, 0.2], [6, 0.45], [8, 0.3], [12, 0.15]], N),
    exact: false,
    note: 'brighter organ registration, quint-heavy',
  },
  {
    index: 88,
    name: 'DWGS Voice',
    harmonics: sparse(
      [[1, 1], [2, 0.6], [3, 0.75], [4, 0.5], [5, 0.3], [6, 0.18], [7, 0.3], [8, 0.22], [9, 0.12], [10, 0.08]],
      N,
    ),
    exact: false,
    note: 'vocal-ish: broad low harmonics with formant bumps at 3 and 7',
  },
  // --- the geometric waves: these ARE exact
  {
    index: 89,
    name: 'SquareWave',
    harmonics: squareTable(N),
    exact: true,
    note: 'exact square: odd harmonics, 1/n',
  },
  {
    index: 90,
    name: 'Digital1',
    harmonics: sparse([[1, 1], [2, 0.5], [4, 0.5], [8, 0.4], [16, 0.3], [32, 0.2], [64, 0.1]], N),
    exact: false,
    note: 'octave-stacked digital timbre',
  },
  {
    index: 91,
    name: 'SawWave',
    harmonics: sawTable(N),
    exact: true,
    note: 'exact sawtooth: all harmonics, 1/n',
  },
  {
    index: 92,
    name: 'Digital2',
    harmonics: sparse([[1, 1], [3, 0.6], [9, 0.4], [27, 0.25], [81, 0.12]], N),
    exact: false,
    note: 'third-stacked digital timbre',
  },
  {
    index: 93,
    name: '25% Pulse',
    harmonics: pulseTable(N, 0.25),
    exact: true,
    note: 'exact 25% duty rectangular pulse (Fourier series)',
  },
  {
    index: 94,
    name: '10% Pulse',
    harmonics: pulseTable(N, 0.1),
    exact: true,
    note: 'exact 10% duty rectangular pulse (Fourier series)',
  },
  {
    index: 95,
    name: 'Digital3',
    harmonics: Array.from({ length: N }, (_, i) => ((i + 1) % 3 === 0 ? 1 / (i + 1) : 0)),
    exact: false,
    note: 'every third harmonic',
  },
  {
    index: 96,
    name: 'Digital4',
    harmonics: Array.from({ length: N }, (_, i) => ((i + 1) % 5 === 0 || i === 0 ? 1 / (i + 1) : 0)),
    exact: false,
    note: 'fundamental plus every fifth harmonic',
  },
  {
    index: 97,
    name: 'Digital5',
    harmonics: Array.from({ length: N }, (_, i) => {
      const h = i + 1;
      // a comb: pairs of adjacent harmonics, gapped
      return h % 8 === 1 || h % 8 === 2 ? 1 / h : 0;
    }),
    exact: false,
    note: 'combed harmonic pairs',
  },
  {
    index: 98,
    name: 'DWGS Tri',
    harmonics: triangleTable(N),
    exact: true,
    note: 'exact triangle: odd harmonics, 1/n^2, alternating sign',
  },
  {
    index: 99,
    name: 'DWGS Sine',
    harmonics: sparse([[1, 1]], N),
    exact: true,
    note: 'exact sine: fundamental only',
  },
];

/**
 * Render one cycle from a harmonic table.
 *
 * Peak-normalized, because the tables are written as relative harmonic weights and their
 * absolute sums vary by an order of magnitude between a sine and a saw.
 */
export function renderCycle(harmonics: HarmonicTable, tableSize = DWGS_TABLE_SIZE): Float32Array {
  const out = new Float32Array(tableSize);
  const maxH = Math.min(harmonics.length, Math.floor(tableSize / 2));
  for (let h = 1; h <= maxH; h++) {
    const amp = harmonics[h - 1] ?? 0;
    if (amp === 0) continue;
    const w = (2 * Math.PI * h) / tableSize;
    for (let i = 0; i < tableSize; i++) out[i] = out[i]! + amp * Math.sin(w * i);
  }
  let p = 0;
  for (let i = 0; i < tableSize; i++) p = Math.max(p, Math.abs(out[i]!));
  if (p > 0) for (let i = 0; i < tableSize; i++) out[i] = (out[i]! / p) * 0.99;
  return out;
}

/** Render a recipe as a looped single-cycle sample plus the metadata the bank needs. */
export function renderRecipe(recipe: DwgsRecipe, tableSize = DWGS_TABLE_SIZE) {
  return {
    index: recipe.index,
    name: recipe.name,
    data: renderCycle(recipe.harmonics, tableSize),
    /** The whole table is the loop, so the wrap is exact by construction. */
    loopStart: 0,
    loopEnd: tableSize,
    rootKey: DWGS_ROOT_KEY,
    fineCents: DWGS_ROOT_FINE_CENTS,
  };
}
