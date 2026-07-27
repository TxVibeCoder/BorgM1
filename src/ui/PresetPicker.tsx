/**
 * Setup browser / save overlay. A modal rendered as plain HTML (NOT SVG): it is window
 * chrome and must live OUTSIDE the transform:scale <main>, so it is screen-pixel sized
 * rather than stage-scaled (App mounts it as a sibling of the scaled stage). `mode` only
 * decides the initial focus / emphasis:
 *
 *   'browse'  -> focus the card so Esc has a target
 *   'save'    -> autofocus the name input
 *
 * Three sections:
 *   A FACTORY     — curated entries; click loads one and closes.
 *   B YOUR SETUPS — saved slots; click loads + closes; an inline two-step-confirm delete
 *                   (NO window.confirm) removes a slot in place.
 *   C SAVE/SHARE  — name a slot + SAVE; EXPORT a portable .json; IMPORT a .json.
 *
 * DEPENDENCY-INJECTED. SynthStack's copy imported a singleton `engineBridge` and a static
 * factory-preset list directly; both went with the gut, and hard-wiring a replacement would
 * have meant stubbing seven methods of an engine that does not exist yet. It now takes a
 * `SetupBridge` prop, which also makes it testable in plain Node with no DOM.
 *
 * Slots do not live in the state tree (they are storage, not sound), so no external-store
 * subscription would ever fire for them — we hold a local `slots` array and re-read
 * `listSlots()` manually after every save / delete / import. Loads route through the bridge,
 * so the stage updates reactively with no extra wiring; we just close after a load. Status
 * text renders inline (no window.alert); `importSetup` resolves {ok,error?} so the UI never
 * sees a raw throw.
 *
 * NOTE for Phase 6: this is NOT the factory-bank browser. That one is specified separately
 * in UI-SPEC.md — two 4x4 tag grids with live faceting, horizontal card paging, APPLY
 * without closing, blue accent. This overlay stays the *user setup* save/load surface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';

/** One curated entry in the FACTORY section. */
export interface FactoryEntry {
  id: string;
  name: string;
  description: string;
}

/** Everything the overlay needs from the outside world. */
export interface SetupBridge {
  /** Names of the saved slots, newest-first is fine — rendered in the given order. */
  listSlots: () => string[];
  saveSlot: (name: string) => void;
  deleteSlot: (name: string) => void;
  loadSlot: (name: string) => Promise<void> | void;
  loadFactory: (id: string) => Promise<void> | void;
  /** Export the LIVE setup as a .json download. */
  exportSetup: (name?: string) => Promise<void> | void;
  /** Export a SAVED slot as a portable bundle. */
  exportSlot: (name: string) => Promise<void> | void;
  importSetup: (file: File) => Promise<{ ok: boolean; error?: string }>;
}

export interface PresetPickerProps {
  mode: 'browse' | 'save';
  onClose: () => void;
  bridge: SetupBridge;
  factory: FactoryEntry[];
}

export function PresetPicker({ mode, onClose, bridge, factory }: PresetPickerProps) {
  const [slots, setSlots] = useState<string[]>(() => bridge.listSlots());
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  /** Slot name currently armed for delete (first click arms, second confirms). */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Re-read the slot list (no external-store subscription fires for storage).
  const refreshSlots = useCallback(() => {
    setSlots(bridge.listSlots());
  }, [bridge]);

  // mode='save' -> autofocus the name input; mode='browse' -> focus the card so Esc
  // has a keyboard target. Runs once on mount.
  useEffect(() => {
    if (mode === 'save') nameInputRef.current?.focus();
    else cardRef.current?.focus();
  }, [mode]);

  // ---- factory ---------------------------------------------------------------------------

  const onLoadFactory = useCallback(
    (id: string) => {
      void bridge.loadFactory(id);
      onClose();
    },
    [bridge, onClose],
  );

  // ---- slots -----------------------------------------------------------------------------

  const onLoadSlot = useCallback(
    (slotName: string) => {
      void bridge.loadSlot(slotName);
      onClose();
    },
    [bridge, onClose],
  );

  // Export a SAVED slot (not the live setup) as a portable .json bundle. Fire-and-forget
  // like the other bridge actions; the bridge is no-throw on an absent/corrupt slot.
  const onBundleSlot = useCallback(
    (slotName: string) => {
      void bridge.exportSlot(slotName);
      setStatus(`Bundled "${slotName}"`);
    },
    [bridge],
  );

  const onDeleteSlot = useCallback(
    (slotName: string) => {
      if (confirmDelete === slotName) {
        bridge.deleteSlot(slotName);
        setConfirmDelete(null);
        setStatus(null);
        refreshSlots();
      } else {
        // First click only arms the confirm for THIS row.
        setConfirmDelete(slotName);
      }
    },
    [bridge, confirmDelete, refreshSlots],
  );

  // ---- save / export / import ------------------------------------------------------------

  const onSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    bridge.saveSlot(trimmed);
    refreshSlots();
    setStatus(`Saved "${trimmed}"`);
  }, [bridge, name, refreshSlots]);

  const onExport = useCallback(() => {
    void bridge.exportSetup(name.trim() || undefined);
    setStatus('Exported');
  }, [bridge, name]);

  const onImportClick = useCallback(() => {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = ''; // re-importing the same file no-ops onChange otherwise
    input.click();
  }, []);

  const onImportChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      void bridge.importSetup(file).then((r) => {
        if (r.ok) {
          setStatus('Imported');
          refreshSlots();
        } else {
          setStatus(r.error ?? 'Import failed');
        }
      });
    },
    [bridge, refreshSlots],
  );

  // ---- overlay chrome --------------------------------------------------------------------

  const onOverlayKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  // Clicks on the backdrop (outside the card) close; clicks inside the card do not.
  const onCardClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="preset-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Presets and save"
      onClick={onClose}
      onKeyDown={onOverlayKeyDown}
    >
      <div ref={cardRef} className="preset-card" tabIndex={-1} onClick={onCardClick}>
        <div className="preset-card-head">
          <h2 className="preset-title">PRESETS</h2>
          <button
            type="button"
            className="preset-x"
            aria-label="Close presets"
            data-testid="preset-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* SECTION A — FACTORY */}
        <section className="preset-section">
          <h3 className="preset-section-title">FACTORY</h3>
          <ul className="preset-list">
            {factory.map((p) => (
              <li key={p.id} className="preset-row">
                <button
                  type="button"
                  className="preset-row-main"
                  data-testid={`factory-preset-${p.id}`}
                  onClick={() => onLoadFactory(p.id)}
                >
                  <span className="preset-row-name">{p.name}</span>
                  <span className="preset-row-desc">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* SECTION B — YOUR SETUPS */}
        <section className="preset-section">
          <h3 className="preset-section-title">YOUR SETUPS</h3>
          {slots.length === 0 ? (
            <p className="preset-empty">No saved setups yet</p>
          ) : (
            <ul className="preset-list">
              {slots.map((slotName) => (
                <li key={slotName} className="preset-row" data-testid={`slot-${slotName}`}>
                  <button
                    type="button"
                    className="preset-row-main"
                    onClick={() => onLoadSlot(slotName)}
                  >
                    <span className="preset-row-name">{slotName}</span>
                  </button>
                  <button
                    type="button"
                    className="preset-del"
                    aria-label={`Export ${slotName} as bundle`}
                    data-testid={`slot-bundle-${slotName}`}
                    onClick={() => onBundleSlot(slotName)}
                  >
                    BUNDLE
                  </button>
                  <button
                    type="button"
                    className={
                      confirmDelete === slotName ? 'preset-del preset-del--armed' : 'preset-del'
                    }
                    aria-label={
                      confirmDelete === slotName
                        ? `Confirm delete ${slotName}`
                        : `Delete ${slotName}`
                    }
                    data-testid={`slot-delete-${slotName}`}
                    onClick={() => onDeleteSlot(slotName)}
                  >
                    {confirmDelete === slotName ? 'CONFIRM' : 'DELETE'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* SECTION C — SAVE / SHARE */}
        <section className="preset-section">
          <h3 className="preset-section-title">SAVE / SHARE</h3>
          <div className="preset-save-row">
            <input
              ref={nameInputRef}
              type="text"
              className="preset-input"
              placeholder="Name this setup"
              aria-label="Name this setup"
              data-testid="preset-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="button"
              className="preset-btn"
              data-testid="preset-save-confirm"
              onClick={onSave}
            >
              SAVE
            </button>
            <button
              type="button"
              className="preset-btn"
              data-testid="preset-export"
              onClick={onExport}
            >
              EXPORT
            </button>
            <button
              type="button"
              className="preset-btn"
              data-testid="preset-import"
              onClick={onImportClick}
            >
              IMPORT
            </button>
          </div>
          {/* hidden file input — value='' set before click, or re-importing the same file no-ops */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="preset-import-input"
            style={{ display: 'none' }}
            onChange={onImportChange}
          />
          <p className="preset-status" data-testid="preset-status" aria-live="polite">
            {status ?? ''}
          </p>
        </section>
      </div>
    </div>
  );
}
