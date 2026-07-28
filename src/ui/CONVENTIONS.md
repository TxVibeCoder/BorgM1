# UI conventions (design-agent owned)

Source of truth: `theme.ts` (constants) + `types.ts` (prop/layout contracts) + `styles.css`
(global CSS; its `:root` vars mirror `theme.ts` — change both or neither). All panel
coordinates are SVG viewBox units that map 1:1 to stage px — every panel's viewBox equals
its stage region (`stage.ts`; the stage itself is a 1400×800 **7:4** design box, uniformly
scaled to the window by `App.tsx`).

> **What exists today (end of Phase 5):** the stage transform, `theme.ts`, `types.ts`, the four
> SVG controls, the keybed, the **program panel** — `panel/layout.ts` (regions plus the five
> program pages and the Combination page), `panel/Section.tsx`, `panel/ParamControl.tsx`, the
> two `panel/EgGraph.tsx` components, `panel/Header.tsx`, `panel/Joystick.tsx`, `useControl.ts`
> — the **FX page** (`panel/EffectSection.tsx`), and **COMBI mode**: `panel/TimbreStrip.tsx`,
> `panel/CombiSection.tsx` and `useCombi.ts`. The Phase 2 rig and every `.rig__*` class are
> gone, as this note said they should be.
>
> The data-flow rules below are now a description of running code. Three additions worth
> knowing before you touch the panel:
>
> - **The drag path does not write the store.** `engineBridge.previewParam` pushes the engine
>   only; `setParam` commits. A knob fires `onInput` per pointermove and a store write notifies
>   every subscriber, so routing the drag through the store re-renders 139 controls per frame.
>   `previewCombiParam` / `setCombiParam` are the Combination twins, and the timbre strip's
>   level slider uses them for the same reason.
> - **`useControl` and `useCombi` read scalars, never `getState()`.** `getState()` deep-copies
>   through the JSON codec, so as a `useSyncExternalStore` snapshot it returns a fresh object
>   every call and defeats the `Object.is` bail-out entirely. The store exposes
>   `getProgramParam`, `getCombiParam`, `programName`, `combiName`, `combiType`, `mode` and
>   `getExtension` for exactly this. Eight timbre rows of six controls is 48 subscriptions; a
>   hook returning an object here would re-render all of them on every frame of a drag.
> - **The FX panel serves both modes without knowing which.** A Combination has its own 25-byte
>   effect block, so the store's effect methods resolve by `mode`. Do not branch in the UI.
>
> **Not built yet:** the Phase 6 browser modal, and the insert-FX rack (a plugin-era extension —
> the strip's per-row `IFX` button ships visibly inert rather than absent).

## Data flow — non-negotiable

- The engine is a singleton OUTSIDE React; React reads a store and calls imperative setters.
- Knob drag: `onInput(v)` → immediate imperative engine write via the bridge.
  **No store write, no React state outside the knob.** Only the dragged control re-renders
  (its value is local state while dragging).
- Release / double-click reset: `onCommit(v)` → one store write. Anything that must mirror
  the store mid-drag is debounced ≥ 100 ms.
- A `useControl(controlId)` hook subscribes to the store, selects that one control's value,
  and bails out (`Object.is`) when unchanged → a store write re-renders only the control it
  changed. Never subscribe a panel component to the whole store.
- Engine-driven UI motion (EG traces, step chasing) comes from the scheduler's uiQueue via
  rAF, never store writes.

## Knob ergonomics

- Vertical **relative** drag with pointer capture; up = increase; `DRAG_FULL_SWEEP_PX` of
  travel = full min→max sweep.
- Shift = ×0.1 fine (`FINE_DRAG_FACTOR`); re-baseline when Shift toggles mid-drag (no jumps).
- Double-click = reset to `ControlDef.default` (fires `onInput` then `onCommit`).
- Drag maps linearly across `[min, max]`; an `exp` taper is the engine adapter's job, not the
  UI's. Detents come only from `taper: "stepped"` / a `steps` count.
- Rotation: 270° sweep, −135° (min) → +135° (max), 0° up (`KNOB_SWEEP_DEG`).
- Value readout (value + `ControlDef.unit`, ≤ 4 significant digits) visible while dragging,
  hidden on release.
- Keyboard: focusable; ↑/↓ = 1% of range (Shift = 0.1%); Home/End = min/max; commit on key up.

## Switches & buttons

- Switch: 2-position click toggles; ≥ 3 positions click cycles forward, Shift-click backward.
  Positions come from `ControlDef.positions`; lever/indicator drawn at the active one.
- Button (latching): click cycles positions; `lit` drives its LED lamp.
- Button (`momentary: true`): `onChange(active)` on pointerdown, `onChange(idle)` on
  pointerup/pointercancel (active/idle = last/first of `positions`).
- Discrete changes: engine write + store commit together in `onChange` (no debounce).
- All focusable; Space/Enter activates.

## Sections & legends

- Section: 1-unit `panelEdge` stroke rounded rect; label in `FONT_CONDENSED`, uppercase,
  ~13 units, letter-spacing ~1.5, `legend` fill, sitting in a gap in the top border.
- Control labels: condensed uppercase ~11 units, `legend` (use `legendDim` for units/ticks);
  above the control by default, below when `labelBelow: true`.
- Panel title: plain text, condensed uppercase, top-left.

## BorgM1-specific rules

- **The `1`/`2` rule.** Every per-oscillator control appears twice. Build **one**
  per-oscillator component and instantiate it twice against the two halves of the parameter
  model, driving both from a single `enabled` flag off `OSC MODE`. The `2` copy greys out in
  SINGLE mode. This halves the panel work and makes the halves structurally unable to drift.
- **Two EG graph components, not one.** The filter EG trace steps down to a release *level*;
  the amp EG trace falls to zero because there is no release level. That asymmetry is engine
  behaviour showing through, not a drawing detail.
- **Disabled is a first-class visual**, designed rather than bolted on — roughly a third of
  the centre column greys in SINGLE mode, and the timbre strip greys every row the current
  Combination type does not use.
- **The strip is a different control idiom from the panel, and deliberately so.** UI-SPEC
  measured the left column as steppers, sliders, small rotaries and dropdowns — not the knob
  grid — and eight rows at 58 px each is below the 66 px a knob cell needs. Its geometry lives
  in `TIMBRE_ROW` (`panel/layout.ts`) so the layout audit can check the row rather than trust
  it. Never place a strip control by a literal.
- **A row that cannot sound says so.** `WINDOW EMPTY` / `MUTED` / `NOT SOLOED`, dimmed in
  place. This is load-bearing rather than decorative: Phase 5 stopped silently ordering an
  inverted window, because an empty window is the hardware's own mechanism — so the cause has
  to be visible instead. See `DECISIONS.md`.
- **`OUT` is a VIEW of the panpot, not a second control.** `1+2` is its A/B half and `3+4` its
  C/C+D/D half. One byte, two renderings; the view holds no state of its own, which is what
  stops the two disagreeing.
- **Hue signals mode** (`theme.ts` ACCENT): lime edits, blue browses, green marks the
  selected timbre row. Do not mix them.
- **Say `FILTER` and `AMP` in the UI.** `VDF`/`VDA` are the manufacturer's nomenclature; keep
  them internally where they match the SysEx model, never on a label.

## No trade dress

Dark panels, cream legends, gold-ish knobs *in the spirit of* the hardware — original work.
NO manufacturer logos, wordmarks, lookalike badges, or copied silkscreen artwork. Titles are
plain-text functional names in our own typography.
