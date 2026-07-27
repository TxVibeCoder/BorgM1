/**
 * PresetPicker wiring test, in plain Node — no DOM, no jsdom, no new deps.
 * The render harness lives in test/helpers/renderComponent.ts; this file supplies a
 * fake SetupBridge and asserts which prop calls which bridge method, plus the local
 * re-read / status / two-step-confirm behaviour. Live browser behaviour (real focus,
 * real file input) belongs in a Playwright spec.
 *
 * NOTE on the filename: the vitest include glob is `test/unit/**\/*.test.ts`
 * (vite.config.ts), so a `.tsx` test would typecheck but never RUN. Named `.test.ts`
 * and walking the element tree instead of writing JSX literals, so `npm test` actually
 * executes it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { PresetPicker, type FactoryEntry, type SetupBridge } from '../../src/ui/PresetPicker';
import {
  childrenOf,
  findByTestId,
  findByTestIdPrefix,
  isElement,
  prop,
  renderComponent,
  textOf,
} from '../helpers/renderComponent';

const FACTORY: FactoryEntry[] = [
  { id: 'init', name: 'INIT', description: 'A blank program' },
  { id: 'organ2', name: 'Organ 2', description: 'The one from the record' },
  { id: 'piano16', name: "Piano 16'", description: 'Keyboard tracking + doubler' },
  { id: 'universe', name: 'Universe', description: 'DOUBLE-mode layering' },
];

/** A fake bridge whose every method is a spy. `slots` drives listSlots(). */
function fakeBridge(slots: string[] = []) {
  let current = [...slots];
  const bridge: SetupBridge = {
    listSlots: vi.fn(() => current),
    saveSlot: vi.fn(),
    deleteSlot: vi.fn(),
    loadSlot: vi.fn(async () => undefined),
    loadFactory: vi.fn(async () => undefined),
    exportSetup: vi.fn(async () => undefined),
    exportSlot: vi.fn(async () => undefined),
    importSetup: vi.fn(async () => ({ ok: true })),
  };
  return {
    bridge,
    /** Simulate the underlying storage changing between listSlots() reads. */
    setSlots(next: string[]) {
      current = [...next];
    },
  };
}

function mount(
  bridge: SetupBridge,
  mode: 'browse' | 'save' = 'browse',
  onClose: () => void = () => undefined,
) {
  return renderComponent(PresetPicker, { mode, onClose, bridge, factory: FACTORY });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PresetPicker', () => {
  it('renders the dialog shell with the close control', () => {
    const { bridge } = fakeBridge();
    const root = mount(bridge).tree;
    expect(prop(root, 'role')).toBe('dialog');
    expect(prop(root, 'aria-modal')).toBe('true');
    expect(findByTestId(root, 'preset-close')).toBeDefined();
  });

  it('renders a FACTORY row per entry and loads + closes on click', () => {
    const { bridge } = fakeBridge();
    let closed = 0;
    const r = mount(bridge, 'browse', () => closed++);

    const rows = findByTestIdPrefix(r.tree, 'factory-preset-');
    expect(rows.length).toBe(FACTORY.length);
    expect(textOf(rows[0]!)).toContain(FACTORY[0]!.name);
    expect(textOf(rows[0]!)).toContain(FACTORY[0]!.description);

    const target = findByTestId(r.tree, `factory-preset-${FACTORY[1]!.id}`)!;
    r.act(() => prop<() => void>(target, 'onClick')());
    expect(bridge.loadFactory).toHaveBeenCalledWith(FACTORY[1]!.id);
    expect(closed).toBe(1);
  });

  it('shows the empty-state when there are no saved slots', () => {
    const { bridge } = fakeBridge([]);
    const r = mount(bridge);
    expect(textOf(r.tree)).toContain('No saved setups yet');
    expect(findByTestIdPrefix(r.tree, 'slot-').length).toBe(0);
  });

  it('renders saved slots and loads + closes on a slot click', () => {
    const { bridge } = fakeBridge(['Alpha', 'Beta']);
    let closed = 0;
    const r = mount(bridge, 'browse', () => closed++);

    // slot-{name} (the row) is distinct from slot-delete-{name} (the delete button).
    const alphaRow = findByTestId(r.tree, 'slot-Alpha')!;
    expect(alphaRow).toBeDefined();
    const loadBtn = childrenOf(alphaRow).find(
      (c) => isElement(c) && prop(c, 'className') === 'preset-row-main',
    ) as ReactElement;
    r.act(() => prop<() => void>(loadBtn, 'onClick')());
    expect(bridge.loadSlot).toHaveBeenCalledWith('Alpha');
    expect(closed).toBe(1);
  });

  it('BUNDLE: a per-slot button calls exportSlot(name) + reports a "Bundled" status', () => {
    const { bridge } = fakeBridge(['Alpha', 'Beta']);
    const r = mount(bridge);

    expect(findByTestIdPrefix(r.tree, 'slot-bundle-').length).toBe(2);
    const bundleBtn = findByTestId(r.tree, 'slot-bundle-Alpha')!;
    expect(textOf(bundleBtn)).toContain('BUNDLE');
    expect(prop(bundleBtn, 'aria-label')).toBe('Export Alpha as bundle');

    r.act(() => prop<() => void>(bundleBtn, 'onClick')());
    expect(bridge.exportSlot).toHaveBeenCalledWith('Alpha');
    expect(bridge.exportSlot).toHaveBeenCalledTimes(1);
    // clicking BUNDLE does not delete or load.
    expect(bridge.deleteSlot).not.toHaveBeenCalled();
    expect(bridge.loadSlot).not.toHaveBeenCalled();
    expect(textOf(findByTestId(r.tree, 'preset-status')!)).toContain('Bundled "Alpha"');
  });

  it('two-step delete: first click arms (no delete), second click deletes + re-reads', () => {
    const { bridge, setSlots } = fakeBridge(['Gamma']);
    const r = mount(bridge);

    const delBtn = () => findByTestId(r.tree, 'slot-delete-Gamma')!;
    expect(textOf(delBtn())).toContain('DELETE');

    // first click ARMS only — deleteSlot NOT called.
    r.act(() => prop<() => void>(delBtn(), 'onClick')());
    expect(bridge.deleteSlot).not.toHaveBeenCalled();
    expect(textOf(delBtn())).toContain('CONFIRM');

    // after the (simulated) delete the list is empty.
    setSlots([]);
    // second click CONFIRMS — deletes + re-reads listSlots in place (overlay stays open).
    r.act(() => prop<() => void>(delBtn(), 'onClick')());
    expect(bridge.deleteSlot).toHaveBeenCalledWith('Gamma');
    expect(findByTestId(r.tree, 'slot-delete-Gamma')).toBeUndefined();
    expect(textOf(r.tree)).toContain('No saved setups yet');
  });

  it('SAVE: trims the name, calls saveSlot, re-reads, and reports status', () => {
    const { bridge, setSlots } = fakeBridge([]);
    const r = mount(bridge, 'save');

    const input = findByTestId(r.tree, 'preset-name-input')!;
    r.act(() =>
      prop<(e: { target: { value: string } }) => void>(input, 'onChange')({
        target: { value: '  My Setup  ' },
      }),
    );

    setSlots(['My Setup']);
    const saveBtn = findByTestId(r.tree, 'preset-save-confirm')!;
    r.act(() => prop<() => void>(saveBtn, 'onClick')());

    expect(bridge.saveSlot).toHaveBeenCalledWith('My Setup');
    expect(findByTestId(r.tree, 'slot-My Setup')).toBeDefined();
    expect(textOf(findByTestId(r.tree, 'preset-status')!).toLowerCase()).toContain('saved');
  });

  it('SAVE: a blank / whitespace-only name is a no-op', () => {
    const { bridge } = fakeBridge();
    const r = mount(bridge, 'save');
    const input = findByTestId(r.tree, 'preset-name-input')!;
    r.act(() =>
      prop<(e: { target: { value: string } }) => void>(input, 'onChange')({
        target: { value: '   ' },
      }),
    );
    const saveBtn = findByTestId(r.tree, 'preset-save-confirm')!;
    r.act(() => prop<() => void>(saveBtn, 'onClick')());
    expect(bridge.saveSlot).not.toHaveBeenCalled();
  });

  it('EXPORT: calls exportSetup with the trimmed name (or undefined when blank)', () => {
    const { bridge } = fakeBridge();
    const r = mount(bridge, 'save');

    const exportBtn = () => findByTestId(r.tree, 'preset-export')!;
    r.act(() => prop<() => void>(exportBtn(), 'onClick')());
    expect(bridge.exportSetup).toHaveBeenLastCalledWith(undefined);

    const input = findByTestId(r.tree, 'preset-name-input')!;
    r.act(() =>
      prop<(e: { target: { value: string } }) => void>(input, 'onChange')({
        target: { value: ' Kit ' },
      }),
    );
    r.act(() => prop<() => void>(exportBtn(), 'onClick')());
    expect(bridge.exportSetup).toHaveBeenLastCalledWith('Kit');
  });

  it('IMPORT: a chosen file calls importSetup and renders "Imported" on ok', async () => {
    const { bridge } = fakeBridge();
    const r = mount(bridge, 'save');

    const fakeFile = { name: 'kit.json' } as unknown as File;
    const input = findByTestId(r.tree, 'preset-import-input')!;
    const onChange = prop<(e: { target: { files: File[] } }) => void>(input, 'onChange');
    onChange({ target: { files: [fakeFile] } });
    expect(bridge.importSetup).toHaveBeenCalledWith(fakeFile);

    // let the resolved promise's .then() run, then re-render to read the status.
    await Promise.resolve();
    await Promise.resolve();
    r.act(() => undefined);
    expect(textOf(findByTestId(r.tree, 'preset-status')!).toLowerCase()).toContain('imported');
  });

  it('IMPORT: a failed import surfaces the bridge error string', async () => {
    const { bridge } = fakeBridge();
    (bridge.importSetup as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: 'Could not read that file',
    });
    const r = mount(bridge, 'save');
    const input = findByTestId(r.tree, 'preset-import-input')!;
    const onChange = prop<(e: { target: { files: File[] } }) => void>(input, 'onChange');
    onChange({ target: { files: [{ name: 'bad.json' } as unknown as File] } });

    await Promise.resolve();
    await Promise.resolve();
    r.act(() => undefined);
    expect(textOf(findByTestId(r.tree, 'preset-status')!)).toContain('Could not read that file');
  });

  it('Esc on the overlay closes; the close button closes', () => {
    const { bridge } = fakeBridge();
    let closed = 0;
    const r = mount(bridge, 'browse', () => closed++);

    const overlayKeyDown = prop<(e: { key: string; preventDefault: () => void }) => void>(
      r.tree,
      'onKeyDown',
    );
    overlayKeyDown({ key: 'Escape', preventDefault: () => undefined });
    expect(closed).toBe(1);

    // a non-Escape key does not close.
    overlayKeyDown({ key: 'a', preventDefault: () => undefined });
    expect(closed).toBe(1);

    const closeBtn = findByTestId(r.tree, 'preset-close')!;
    r.act(() => prop<() => void>(closeBtn, 'onClick')());
    expect(closed).toBe(2);
  });

  it('a backdrop click closes; an inside-card click stops propagation (does not close)', () => {
    const { bridge } = fakeBridge();
    let closed = 0;
    const r = mount(bridge, 'browse', () => closed++);

    const overlayClick = prop<() => void>(r.tree, 'onClick');
    overlayClick();
    expect(closed).toBe(1);

    const card = childrenOf(r.tree).find(
      (c) => isElement(c) && prop(c, 'className') === 'preset-card',
    ) as ReactElement;
    let stopped = false;
    prop<(e: { stopPropagation: () => void }) => void>(card, 'onClick')({
      stopPropagation: () => {
        stopped = true;
      },
    });
    expect(stopped).toBe(true);
    expect(closed).toBe(1); // unchanged — inside click did not close
  });
});
