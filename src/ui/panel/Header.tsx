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

import { engineBridge } from '../../engine/engineBridge';
import type { RegionBox } from '../stage';
import { ACCENT, COLORS, FONT_CONDENSED, FONT_STACK } from '../theme';
import { useExtension, useOscMode, useProgramName } from '../useControl';
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

      {/* Program name — the visual anchor of the design (UI-SPEC §2). */}
      <Bevel box={{ x: box.x + 156, y: box.y + 18, w: 300, h: 64 }} fill={COLORS.panelRaised} />
      <text x={box.x + 168} y={box.y + 36} fill={COLORS.legendDim} fontFamily={FONT_CONDENSED} fontSize={10} letterSpacing={1.6}>
        PROGRAM
      </text>
      <text
        x={box.x + 168}
        y={box.y + 68}
        fill={ACCENT.edit}
        fontFamily="'DejaVu Sans Mono', 'Consolas', monospace"
        fontSize={26}
      >
        {name}
      </text>

      {/* Oscillator mode readout — the flag that greys a third of the panel. */}
      <text x={box.x + 480} y={box.y + 36} fill={COLORS.legendDim} fontFamily={FONT_CONDENSED} fontSize={10} letterSpacing={1.6}>
        OSC MODE
      </text>
      <text x={box.x + 480} y={box.y + 62} fill={COLORS.legend} fontFamily={FONT_STACK} fontSize={18}>
        {mode}
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

export interface TabStripProps {
  box: RegionBox;
  page: PageId;
  onSelect: (p: PageId) => void;
}

/**
 * The edit-page tabs. UI-SPEC §5: `EASY` is not a section but a curated subset page, and it
 * sits alongside the deep-edit tabs rather than above them. That pattern is what makes 139
 * parameters approachable, so EASY is first and is the default.
 */
export function TabStrip({ box, page, onSelect }: TabStripProps) {
  const w = 116;
  const gap = 8;
  const x0 = box.x + 28;
  return (
    <g role="tablist" aria-label="Edit page">
      {PAGES.map((id, i) => {
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
              {id}
            </text>
          </g>
        );
      })}
    </g>
  );
}
