/**
 * Header band and tab strip. UI-SPEC §2 and §5.
 *
 * NO TRADE DRESS (CLAUDE.md, UI-SPEC §10). The reference plugin's header carries a
 * manufacturer wordmark and a model badge top-right; this one carries a plain-text
 * functional title in our own typography and nothing else. The structural grammar —
 * a mode block, a large program-name display as the visual anchor, a row of mode buttons —
 * is generic convention and is kept; the branding is not.
 *
 * `FILTER` and `AMP`, never `VDF`/`VDA`: Korg's nomenclature stays internal, where it
 * matches the SysEx model.
 */

import { useEffect, useState } from 'react';
import { engineBridge } from '../../engine/engineBridge';
import { formatElapsed, type RecordFormat } from '../../engine/recordHelpers';
import type { RegionBox } from '../stage';
import { ACCENT, COLORS, FONT_CONDENSED, FONT_STACK } from '../theme';
import { useExtension, useOscMode, useProgramName } from '../useControl';
import { useCombiName, useCombiType, useMode } from '../useCombi';
import { PAGES, type PageId } from './layout';

export interface HeaderProps {
  box: RegionBox;
  powered: boolean;
  statusText: string;
  onPower: () => void;
}

function Bevel({ box, fill = COLORS.panel }: { box: RegionBox; fill?: string }) {
  return (
    <>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={6} fill={fill} stroke={COLORS.panelEdge} strokeWidth={2} />
      <line x1={box.x + 2} y1={box.y + 1.5} x2={box.x + box.w - 2} y2={box.y + 1.5} stroke={COLORS.panelEdge} strokeWidth={1} opacity={0.6} />
    </>
  );
}

export function Header({ box, powered, statusText, onPower }: HeaderProps) {
  const name = useProgramName();
  const mode = useOscMode();
  const resonance = useExtension('resonance');
  const isCombi = useMode() === 'COMBI';
  const combiName = useCombiName();
  const combiType = useCombiType();

  return (
    <g>
      {/* POWER — the AudioContext unlock. Nothing sounds before it, by browser policy. */}
      <g
        role="button"
        tabIndex={0}
        aria-label={powered ? 'Power off' : 'Power on'}
        aria-pressed={powered}
        style={{ cursor: 'pointer' }}
        onClick={onPower}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPower();
          }
        }}
      >
        <Bevel box={{ x: box.x + 28, y: box.y + 22, w: 108, h: 56 }} />
        <circle
          cx={box.x + 50}
          cy={box.y + 50}
          r={7}
          fill={powered ? COLORS.ledRed : COLORS.ledOff}
          stroke={COLORS.panelShadow}
          strokeWidth={1}
        />
        {powered && <circle cx={box.x + 50} cy={box.y + 50} r={3} fill={COLORS.ledRedHot} />}
        <text x={box.x + 66} y={box.y + 55} fill={COLORS.legend} fontFamily={FONT_CONDENSED} fontSize={14} letterSpacing={1.5}>
          POWER
        </text>
      </g>

      {/* Program / Combination name — the visual anchor of the design (UI-SPEC §2). */}
      <Bevel box={{ x: box.x + 156, y: box.y + 18, w: 300, h: 64 }} fill={COLORS.panelRaised} />
      <text x={box.x + 168} y={box.y + 36} fill={COLORS.legendDim} fontFamily={FONT_CONDENSED} fontSize={10} letterSpacing={1.6}>
        {isCombi ? 'COMBINATION' : 'PROGRAM'}
      </text>
      <text
        x={box.x + 168}
        y={box.y + 68}
        fill={ACCENT.edit}
        fontFamily="'DejaVu Sans Mono', 'Consolas', monospace"
        fontSize={26}
      >
        {isCombi ? combiName : name}
      </text>

      {/* MODE — the top-level switch, and the one that changes what the whole panel edits.
          Rendered as two lamps rather than a dropdown because that is what the reference does
          and because the current mode has to be readable at a glance from across a room.

          It sits in the 456..620 gap between the name display and the RESONANCE block, and it
          has to: the first placement put it under the resonance bevel, which not only printed
          text over text but made the COMBI button UNCLICKABLE, because the later-painted bevel
          intercepted the pointer at exactly the button's centre. The audit caught both. */}
      <text x={box.x + 464} y={box.y + 28} fill={COLORS.legendDim} fontFamily={FONT_CONDENSED} fontSize={10} letterSpacing={1.6}>
        MODE
      </text>
      {(['PROGRAM', 'COMBI'] as const).map((m, i) => {
        const on = isCombi === (m === 'COMBI');
        const x = box.x + 464 + i * 76;
        return (
          <g
            key={m}
            role="radio"
            aria-checked={on}
            aria-label={`${m} mode`}
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            onClick={() => engineBridge.setMode(m)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                engineBridge.setMode(m);
              }
            }}
          >
            <rect
              x={x}
              y={box.y + 36}
              width={68}
              height={28}
              rx={4}
              fill={on ? ACCENT.edit : COLORS.panel}
              stroke={ACCENT.edit}
              strokeWidth={1.25}
              opacity={on ? 1 : 0.5}
            />
            <text
              x={x + 34}
              y={box.y + 55}
              fill={on ? COLORS.panelShadow : ACCENT.edit}
              fontFamily={FONT_CONDENSED}
              fontSize={11}
              letterSpacing={1}
              textAnchor="middle"
            >
              {m}
            </text>
          </g>
        );
      })}

      {/* The flag that greys a third of the panel — OSC MODE in Program mode, the Combination
          type in Combi mode. Both do the same job: they say how much of the panel is live. It
          sits in the gap between the bank status and RECORD. */}
      <text x={box.x + 900} y={box.y + 40} fill={COLORS.legendDim} fontFamily={FONT_CONDENSED} fontSize={10} letterSpacing={1.6}>
        {isCombi ? 'COMBI TYPE' : 'OSC MODE'}
      </text>
      <text x={box.x + 900} y={box.y + 62} fill={COLORS.legend} fontFamily={FONT_STACK} fontSize={14}>
        {isCombi ? combiType : mode}
      </text>

      {/* RESONANCE is a plugin-era EXTENSION the 1988 filter never had. It ships switchable
          and defaults OFF, and the Phase 4 fidelity gate must pass with it off — so its
          state is shown here rather than buried, and it is visibly labelled an extension. */}
      <g
        role="switch"
        aria-checked={resonance}
        aria-label="Filter resonance extension"
        tabIndex={0}
        style={{ cursor: 'pointer' }}
        onClick={() => engineBridge.setResonance(!resonance)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            engineBridge.setResonance(!resonance);
          }
        }}
      >
        <Bevel box={{ x: box.x + 620, y: box.y + 26, w: 168, h: 48 }} />
        <text x={box.x + 634} y={box.y + 44} fill={COLORS.legendDim} fontFamily={FONT_CONDENSED} fontSize={9} letterSpacing={1.4}>
          EXTENSION
        </text>
        <text x={box.x + 634} y={box.y + 63} fill={COLORS.legend} fontFamily={FONT_CONDENSED} fontSize={13} letterSpacing={1.2}>
          RESONANCE
        </text>
        <circle
          cx={box.x + 770}
          cy={box.y + 52}
          r={6}
          fill={resonance ? ACCENT.edit : COLORS.ledOff}
          stroke={COLORS.panelShadow}
        />
      </g>

      <text x={box.x + 812} y={box.y + 56} fill={COLORS.legendDim} fontFamily={FONT_STACK} fontSize={13}>
        {statusText}
      </text>

      <RecordControl box={box} powered={powered} />

      {/* Plain-text functional title. Original typography, no badge, no wordmark. */}
      <text
        x={box.x + box.w - 28}
        y={box.y + 58}
        fill={COLORS.metalDark}
        fontFamily={FONT_CONDENSED}
        fontSize={22}
        letterSpacing={4}
        textAnchor="end"
      >
        BorgM1
      </text>
    </g>
  );
}

/**
 * RECORD — the master-output recorder's one control. UI-SPEC §2 gives the header the
 * transport-ish utilities; the recorder itself (WAV = lossless PCM tap, WEBM = opus) came
 * over from SynthStack and has been sitting in StudioContext with no switch since Phase 0.
 *
 * The elapsed readout POLLS the bridge (4 Hz, only while recording). That is UI polling of
 * a UI readout — the "never setInterval for audio events" rule (CLAUDE.md) is about
 * scheduling sound, and the recorder keeps its own clock either way.
 */
function RecordControl({ box, powered }: { box: RegionBox; powered: boolean }) {
  const [format, setFormat] = useState<RecordFormat>('wav');
  const [state, setState] = useState(() => engineBridge.getRecordingState());

  useEffect(() => {
    if (!state.recording) return;
    const id = window.setInterval(() => setState(engineBridge.getRecordingState()), 250);
    return () => window.clearInterval(id);
  }, [state.recording]);

  const toggle = (): void => {
    if (state.recording) {
      // stop() assembles the file and triggers the download in the recorder's onstop.
      void engineBridge.stopRecording().then(() => setState(engineBridge.getRecordingState()));
    } else {
      engineBridge.setRecordFormat(format);
      if (engineBridge.startRecording()) setState(engineBridge.getRecordingState());
    }
  };

  const flipFormat = (): void => {
    // The format belongs to the NEXT take; changing it mid-record would be a lie.
    if (!state.recording) setFormat((f) => (f === 'wav' ? 'webm' : 'wav'));
  };

  const x = box.x + 1040;
  const y = box.y + 26;
  return (
    <g opacity={powered ? 1 : 0.4} style={{ pointerEvents: powered ? 'auto' : 'none' }}>
      <Bevel box={{ x, y, w: 190, h: 48 }} />
      <g
        role="button"
        tabIndex={powered ? 0 : -1}
        aria-label={state.recording ? 'Stop recording' : 'Record master output'}
        aria-pressed={state.recording}
        style={{ cursor: 'pointer' }}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {/* Invisible hit area over the lamp + label half, leaving the format toggle its own. */}
        <rect x={x} y={y} width={130} height={48} fill="transparent" />
        <circle
          cx={x + 22}
          cy={y + 24}
          r={7}
          fill={state.recording ? COLORS.ledRed : COLORS.ledOff}
          stroke={COLORS.panelShadow}
          strokeWidth={1}
        />
        {state.recording && <circle cx={x + 22} cy={y + 24} r={3} fill={COLORS.ledRedHot} />}
        <text
          x={x + 38}
          y={y + 21}
          fill={COLORS.legend}
          fontFamily={FONT_CONDENSED}
          fontSize={13}
          letterSpacing={1.4}
        >
          RECORD
        </text>
        <text x={x + 38} y={y + 38} fill={COLORS.legendDim} fontFamily={FONT_STACK} fontSize={12}>
          {state.recording ? formatElapsed(state.elapsedMs) : 'ready'}
        </text>
      </g>
      <g
        role="button"
        tabIndex={powered && !state.recording ? 0 : -1}
        aria-label={`Capture format: ${format.toUpperCase()}, click to change`}
        style={{ cursor: state.recording ? 'default' : 'pointer' }}
        opacity={state.recording ? 0.45 : 1}
        onClick={flipFormat}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            flipFormat();
          }
        }}
      >
        <rect x={x + 134} y={y + 8} width={48} height={32} rx={4} fill={COLORS.panelShadow} stroke={COLORS.panelEdge} />
        <text
          x={x + 158}
          y={y + 28}
          fill={COLORS.legendDim}
          fontFamily={FONT_CONDENSED}
          fontSize={11}
          letterSpacing={1}
          textAnchor="middle"
        >
          {format.toUpperCase()}
        </text>
      </g>
    </g>
  );
}

export interface TabStripProps {
  box: RegionBox;
  page: PageId;
  onSelect: (p: PageId) => void;
  /** COMBI mode has its own, much shorter, page list. */
  combi?: boolean;
}

/**
 * The edit-page tabs. UI-SPEC §5: `EASY` is not a section but a curated subset page, and it
 * sits alongside the deep-edit tabs rather than above them. That pattern is what makes 139
 * parameters approachable, so EASY is first and is the default.
 *
 * COMBI mode shows only `TIMBRE` and `FX`, because the strip in the left column is the
 * selector that the program panel needs six tabs to express.
 */
export function TabStrip({ box, page, onSelect, combi = false }: TabStripProps) {
  const w = 116;
  const gap = 8;
  const x0 = box.x + 28;
  const tabs = combi ? (['EASY', 'FX'] as const) : PAGES;
  const labelOf = (id: PageId): string => (combi && id === 'EASY' ? 'TIMBRE' : id);
  return (
    <g role="tablist" aria-label="Edit page">
      {tabs.map((id, i) => {
        const active = id === page;
        const x = x0 + i * (w + gap);
        return (
          <g
            key={id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(id);
              }
            }}
          >
            <rect
              x={x}
              y={box.y + 6}
              width={w}
              height={box.h - 12}
              rx={4}
              fill={active ? ACCENT.edit : COLORS.panel}
              stroke={ACCENT.edit}
              strokeWidth={1.25}
              opacity={active ? 1 : 0.55}
            />
            <text
              x={x + w / 2}
              y={box.y + box.h / 2 + 4}
              fill={active ? COLORS.panelShadow : ACCENT.edit}
              fontFamily={FONT_CONDENSED}
              fontSize={13}
              letterSpacing={1.8}
              textAnchor="middle"
            >
              {labelOf(id)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
