/**
 * The shell. ONE 7:4 design-space stage (src/ui/stage.ts), scaled uniformly to fill the
 * window, with everything inside authored in design px.
 *
 * PHASE 3: the panel. Every one of the 139 program parameters is editable here and audible
 * in the engine. The Phase 2 rig — a row of HTML `<select>`s under `.rig__*` — is gone
 * entirely, as CONVENTIONS.md said it should be: it was a harness for hearing the engine,
 * not a draft of this.
 *
 * Layout comes from UI-SPEC's percentage table via `panel/layout.ts`; nothing here places a
 * control by hand.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import {
  REGIONS,
  PAGE_LAYOUTS,
  COMBI_PAGE_LAYOUTS,
  flowSections,
  type PageId,
} from './panel/layout';
import { timbresInType } from '../../data/combiParams';
import { STAGE } from './stage';
import { ErrorOverlay } from './ErrorOverlay';
import { AmpEgGraph, FilterEgGraph } from './panel/EgGraph';
import { EffectRoutingSection, EffectSlotSection } from './panel/EffectSection';
import { CombiSection } from './panel/CombiSection';
import { Header, TabStrip } from './panel/Header';
import { Joystick } from './panel/Joystick';
import { Section } from './panel/Section';
import { TimbreStrip } from './panel/TimbreStrip';
import { KeyboardPanel } from './keyboard/KeyboardPanel';
import { engineBridge, type BridgeStatus } from '../engine/engineBridge';
import { useOsc2Enabled } from './useControl';
import { useCombiType, useMode } from './useCombi';
import { WebMidiInput, type MidiStatus } from './midi/webMidiInput';
import { COLORS } from './theme';

/** One MIDI input for the app. Outside React — it owns a permission prompt and devices. */
const midi = new WebMidiInput();

export const CHROME_H = 0;
export const MIN_SCALE = 0.25;

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
  const [status, setStatus] = useState<BridgeStatus>(() => engineBridge.getStatus());
  const [page, setPage] = useState<PageId>('EASY');
  const [octave, setOctave] = useState(0);
  const [midiStatus, setMidiStatus] = useState<MidiStatus | null>(null);
  const [, forceRender] = useState(0);
  const osc2Enabled = useOsc2Enabled();
  const mode = useMode();
  const combiType = useCombiType();
  /** Which timbre row the strip has selected. The Combination twin of the `1`/`2` flag. */
  const [timbre, setTimbre] = useState(0);

  useEffect(() => {
    const onResize = () => setScale(computeScale(window.innerWidth, window.innerHeight));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => engineBridge.subscribe(setStatus), []);

  const noteOn = useCallback((note: number, velocity: number) => {
    engineBridge.noteOn(note, velocity);
    forceRender((n) => n + 1); // held-note set lives outside React; nudge the keybed
  }, []);
  const noteOff = useCallback((note: number) => {
    engineBridge.noteOff(note);
    forceRender((n) => n + 1);
  }, []);

  // Web MIDI. Attached once the engine is powered, since notes before that go nowhere —
  // and because requestMIDIAccess prompts, which should follow a user gesture rather than
  // fire on page load.
  useEffect(() => {
    if (!status.powered) return;
    void midi
      .enable(
        (note, velocity) => noteOn(note, velocity),
        (note) => noteOff(note),
        () => engineBridge.allNotesOff(), // hot-unplug panic: never strand a held note
      )
      .then(setMidiStatus);
  }, [status.powered, noteOn, noteOff]);

  // The FX page is laid out by EffectSection, not by a declared parameter list — see PAGES.
  const isFx = page === 'FX';
  const isCombi = mode === 'COMBI';
  const layout = PAGE_LAYOUTS[isFx ? 'EASY' : page];
  const leftBoxes = useMemo(() => flowSections(layout.left, REGIONS.left), [layout]);
  const centreBoxes = useMemo(() => flowSections(layout.centre, REGIONS.centre), [layout]);

  // Combination mode reuses the same three columns: the strip takes the left, one timbre's
  // detail the centre, and its windows and MIDI filters the right.
  const combiLayout = COMBI_PAGE_LAYOUTS.TIMBRE;
  const combiCentreBoxes = useMemo(
    () =>
      flowSections(
        combiLayout.centre.map((s) => ({ ...s, perOsc: false })),
        REGIONS.centre,
      ),
    [combiLayout],
  );
  const combiRightBoxes = useMemo(
    () =>
      flowSections(
        combiLayout.right.map((s) => ({ ...s, perOsc: false })),
        REGIONS.right,
      ),
    [combiLayout],
  );
  /** Rows the current type actually uses — the rest of the strip greys. */
  const liveTimbres = timbresInType(combiType);

  // Two effect slots down the left column and the placement matrix in the centre. The two
  // slots get equal height because neither is subordinate — SERIAL runs 1 into 2.
  const fxH = (REGIONS.left.h - 12) / 2;
  const fxTop = { ...REGIONS.left, h: fxH };
  const fxBottom = { ...REGIONS.left, y: REGIONS.left.y + fxH + 12, h: fxH };

  const statusText = status.bankError
    ? `BANK ERROR: ${status.bankError}`
    : status.bankLoaded
      ? 'BANK OK'
      : status.powered
        ? 'LOADING BANK…'
        : 'POWER OFF';

  // The right column is the two EG graphs, stacked. UI-SPEC §3: each is ~22% of window
  // height, and they show whichever oscillator is selected by the `1`/`2` rule — here both
  // are drawn for oscillator 1, with oscillator 2's pair greying in SINGLE mode.
  const egH = (REGIONS.right.h - 12) / 2;
  const egTop = { ...REGIONS.right, h: egH };
  const egBottom = { ...REGIONS.right, y: REGIONS.right.y + egH + 12, h: egH };

  return (
    <>
      <div className="stage-viewport">
        <main
          className="stage"
          data-testid="stage"
          style={{ width: STAGE.w, height: STAGE.h, transform: `scale(${scale})` }}
        >
          <svg
            width={STAGE.w}
            height={STAGE.h}
            viewBox={`0 0 ${STAGE.w} ${STAGE.h}`}
            role="group"
            aria-label="BorgM1 program panel"
          >
            {/* Chassis. UI-SPEC §7's single most important structural finding: the chassis is
                cool-tinted and the modules are perfectly neutral. That two-temperature split
                is what makes the panels read as separate physical parts. */}
            <rect x={0} y={0} width={STAGE.w} height={STAGE.h} fill={COLORS.bg} />
            <rect
              x={6}
              y={6}
              width={STAGE.w - 12}
              height={STAGE.h - 12}
              rx={10}
              fill={COLORS.panelRaised}
              stroke={COLORS.panelEdge}
              strokeWidth={2}
            />

            <Header
              box={REGIONS.header}
              powered={status.powered}
              statusText={statusText}
              onPower={() => {
                if (status.powered) void engineBridge.powerOff();
                else void engineBridge.powerOn();
              }}
            />
            <TabStrip box={REGIONS.tabs} page={page} onSelect={setPage} combi={isCombi} />

            {isFx ? (
              <>
                <EffectSlotSection slot={1} box={fxTop} />
                <EffectSlotSection slot={2} box={fxBottom} />
                <EffectRoutingSection box={REGIONS.centre} />
              </>
            ) : isCombi ? (
              <>
                <TimbreStrip box={REGIONS.left} selected={timbre} onSelect={setTimbre} />
                {combiLayout.centre.map((section, i) => (
                  <CombiSection
                    key={`c-c-${section.title}`}
                    section={section}
                    box={combiCentreBoxes[i]!}
                    timbre={timbre}
                    enabled={timbre < liveTimbres}
                  />
                ))}
                {combiLayout.right.map((section, i) => (
                  <CombiSection
                    key={`c-r-${section.title}`}
                    section={section}
                    box={combiRightBoxes[i]!}
                    timbre={timbre}
                    enabled={timbre < liveTimbres}
                  />
                ))}
              </>
            ) : (
              <>
                {layout.left.map((section, i) => (
                  <Section
                    key={`${page}-l-${section.title}`}
                    section={section}
                    box={leftBoxes[i]!}
                    osc2Enabled={osc2Enabled}
                  />
                ))}
                {layout.centre.map((section, i) => (
                  <Section
                    key={`${page}-c-${section.title}`}
                    section={section}
                    box={centreBoxes[i]!}
                    osc2Enabled={osc2Enabled}
                  />
                ))}
              </>
            )}

            {/* TWO EG components, never one — the filter EG releases to a level and the amp
                EG cannot. See panel/EgGraph.tsx. The right column belongs to the Combination's
                own sections in COMBI mode, so the graphs stand down rather than showing a
                program the selected timbre may not even be playing. */}
            {!isCombi && (
              <>
                <FilterEgGraph box={egTop} osc={1} enabled />
                <AmpEgGraph box={egBottom} osc={1} enabled />
              </>
            )}
          </svg>

          <div className="panel-keys">
            <svg
              className="panel-keys__wheels"
              width={REGIONS.keyboard.h}
              height={REGIONS.keyboard.h}
              viewBox={`0 0 ${REGIONS.keyboard.h} ${REGIONS.keyboard.h}`}
            >
              <Joystick box={{ x: 0, y: 0, w: REGIONS.keyboard.h, h: REGIONS.keyboard.h - 26 }} />
            </svg>
            <div className="panel-keys__bed">
              <KeyboardPanel
                octave={octave}
                held={engineBridge.heldNotes}
                onNoteOn={noteOn}
                onNoteOff={noteOff}
              />
            </div>
            <div className="panel-keys__aside">
              <label className="panel-octave">
                OCTAVE
                <select value={octave} onChange={(e) => setOctave(Number(e.target.value))}>
                  {[-2, -1, 0, 1, 2].map((o) => (
                    <option key={o} value={o}>
                      {o > 0 ? `+${o}` : o}
                    </option>
                  ))}
                </select>
              </label>
              <span className="panel-midi" data-testid="bank-status">
                {midiStatus
                  ? `MIDI ${midiStatus.state}${midiStatus.deviceCount ? ` · ${midiStatus.deviceNames.join(', ')}` : ''}`
                  : statusText}
              </span>
            </div>
          </div>
        </main>
      </div>
      <ErrorOverlay />
    </>
  );
}
