/**
 * The shell. ONE 7:4 design-space stage (src/ui/stage.ts), scaled uniformly to fill the
 * window, with everything inside authored in design px.
 *
 * PHASE 2: playable. POWER unlocks the AudioContext and loads the bank; the keybed and
 * Web MIDI both drive the same engine bridge. The real panel arrives in Phase 3, laid out
 * from UI-SPEC's percentage table — this is deliberately a rig for hearing the engine, not
 * a draft of that panel.
 */

import { useCallback, useEffect, useState } from 'react';
import './styles.css';
import { STAGE } from './stage';
import { ErrorOverlay } from './ErrorOverlay';
import { KeyboardPanel } from './keyboard/KeyboardPanel';
import { engineBridge, type BridgeStatus } from '../engine/engineBridge';
import { WebMidiInput, type MidiStatus } from './midi/webMidiInput';

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
  const [octave, setOctave] = useState(0);
  const [midiStatus, setMidiStatus] = useState<MidiStatus | null>(null);
  const [, forceRender] = useState(0);

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

  const multisounds = engineBridge.multisounds;

  return (
    <>
      <div className="stage-viewport">
        <main
          className="stage"
          data-testid="stage"
          style={{ width: STAGE.w, height: STAGE.h, transform: `scale(${scale})` }}
        >
          <div className="rig">
            <div className="rig__row">
              <button
                type="button"
                className="rig__power"
                data-testid="power"
                onClick={() => {
                  if (status.powered) void engineBridge.powerOff();
                  else void engineBridge.powerOn();
                }}
              >
                <span className={status.powered ? 'power-lamp power-lamp--on' : 'power-lamp power-lamp--off'} />
                POWER
              </button>

              <label className="rig__field">
                SOUND
                <select
                  data-testid="multisound"
                  disabled={!status.bankLoaded}
                  value={status.multisound}
                  onChange={(e) => engineBridge.setMultisound(Number(e.target.value))}
                >
                  {multisounds.map((m) => (
                    <option key={m.index} value={m.index}>
                      {String(m.index).padStart(2, '0')} {m.name}
                      {m.approx ? ' ~' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rig__field">
                OSC
                <select
                  data-testid="osc-mode"
                  value={status.oscMode}
                  onChange={(e) => engineBridge.setOscMode(e.target.value as 'SINGLE' | 'DOUBLE')}
                >
                  <option value="SINGLE">SINGLE</option>
                  <option value="DOUBLE">DOUBLE</option>
                </select>
              </label>

              <label className="rig__field">
                OCTAVE
                <select value={octave} onChange={(e) => setOctave(Number(e.target.value))}>
                  {[-2, -1, 0, 1, 2].map((o) => (
                    <option key={o} value={o}>
                      {o > 0 ? `+${o}` : o}
                    </option>
                  ))}
                </select>
              </label>

              <span className="rig__status" data-testid="bank-status">
                {status.bankError
                  ? `BANK ERROR: ${status.bankError}`
                  : status.bankLoaded
                    ? `BANK OK · ${multisounds.length} sounds`
                    : status.powered
                      ? 'LOADING BANK…'
                      : 'POWER OFF'}
              </span>
            </div>

            <div className="rig__keys">
              <KeyboardPanel
                octave={octave}
                held={engineBridge.heldNotes}
                onNoteOn={noteOn}
                onNoteOff={noteOff}
              />
            </div>

            <p className="rig__hint">
              Phase 2 · voice engine. A tilde marks a sound approximated from General MIDI.
              {midiStatus
                ? ` · MIDI ${midiStatus.state}${midiStatus.deviceCount ? ` (${midiStatus.deviceNames.join(', ')})` : ''}`
                : ''}
            </p>
          </div>
        </main>
      </div>
      <ErrorOverlay />
    </>
  );
}
