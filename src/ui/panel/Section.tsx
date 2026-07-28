/**
 * A titled section box holding one group of parameters.
 *
 * THE `1`/`2` RULE LIVES HERE (UI-SPEC §4). A `perOsc` section renders its parameter list
 * TWICE — once bound to `OSC1_*`, once to `OSC2_*` — from the same declaration, with a
 * single `enabled` flag off OSC MODE greying the second copy. There is no second component
 * and no second layout, so the two halves cannot drift: a parameter added to the list
 * appears on both oscillators or on neither.
 */

import { COLORS, FONT_CONDENSED, SECTION_BORDER_WIDTH } from '../theme';
import type { RegionBox } from '../stage';
import {
  CELL,
  cellAt,
  columnsFor,
  OSC_LABEL_W,
  paramIdFor,
  rowsFor,
  SECTION_PAD,
  SECTION_TITLE_H,
  type ParamSection,
} from './layout';
import { ParamControl } from './ParamControl';

export interface SectionProps {
  section: ParamSection;
  box: RegionBox;
  /** Whether oscillator 2 is live. Drives the greying of every `2` control at once. */
  osc2Enabled: boolean;
}

/** One oscillator's row of controls inside a per-oscillator section. */
function OscBlock({
  section,
  osc,
  enabled,
  x,
  y,
  cols,
  showLabel,
}: {
  section: ParamSection;
  osc: 1 | 2;
  enabled: boolean;
  x: number;
  y: number;
  cols: number;
  showLabel: boolean;
}) {
  const rows = rowsFor(section.params.length, cols);
  return (
    <g>
      {showLabel && (
        <text
          x={x - OSC_LABEL_W + 6}
          y={y + (rows * CELL.h) / 2}
          fill={enabled ? COLORS.legend : COLORS.legendDim}
          opacity={enabled ? 1 : 0.35}
          fontFamily={FONT_CONDENSED}
          fontSize={15}
          fontWeight={600}
          dominantBaseline="middle"
        >
          {osc}
        </text>
      )}
      {section.params.map((param, i) => {
        const pos = cellAt(i, cols, x, y);
        return (
          <ParamControl
            key={param}
            id={paramIdFor(section, param, osc)}
            x={pos.x}
            y={pos.y}
            enabled={enabled}
          />
        );
      })}
    </g>
  );
}

export function Section({ section, box, osc2Enabled }: SectionProps) {
  const cols = columnsFor(box.w, section.columns);
  const contentX = box.x + SECTION_PAD + OSC_LABEL_W;
  const contentY = box.y + SECTION_TITLE_H;
  const rows = rowsFor(section.params.length, cols);

  return (
    <g>
      {/* Section box. UI-SPEC §7: modules are perfectly neutral, the chassis is cool-tinted;
          that two-temperature split is what makes panels read as separate physical parts. */}
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={6}
        fill={COLORS.panel}
        stroke={COLORS.panelEdge}
        strokeWidth={SECTION_BORDER_WIDTH / 2}
      />
      <text
        x={box.x + SECTION_PAD}
        y={box.y + 14}
        fill={COLORS.legend}
        fontFamily={FONT_CONDENSED}
        fontSize={12}
        letterSpacing={1.5}
      >
        {section.title}
      </text>

      {section.perOsc ? (
        <>
          <OscBlock
            section={section}
            osc={1}
            enabled
            x={contentX}
            y={contentY}
            cols={cols}
            showLabel
          />
          <OscBlock
            section={section}
            osc={2}
            enabled={osc2Enabled}
            x={contentX}
            y={contentY + rows * CELL.h}
            cols={cols}
            showLabel
          />
        </>
      ) : (
        <OscBlock
          section={section}
          osc={1}
          // A program-level section can still be oscillator-2-only: INTERVAL, DETUNE and
          // DELAY START live in the common block but reach only oscillator 2, so they grey
          // out with it rather than sitting live and doing nothing.
          enabled={!section.oscTwoOnly || osc2Enabled}
          x={contentX}
          y={contentY}
          cols={cols}
          showLabel={false}
        />
      )}
    </g>
  );
}
