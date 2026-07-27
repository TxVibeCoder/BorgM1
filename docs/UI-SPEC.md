# BorgM1 UI audit — KORG Collection M1 plugin layout

Measured from three user-supplied screenshots, 2026-07-27. **Revised** against a
high-resolution capture (COMBI MODE / "Ensemble 2"), which supersedes the first-pass
estimates taken from two compressed thumbnails.

**Figures are % of the plugin window.** Aspect ratio measures **≈ 1.75:1 (7:4)** — not the 2:1
I first estimated. Re-derive in pixels once native resolution is confirmed.

> **This audits the SOFTWARE PLUGIN, not the 1988 hardware.** The hardware UI is a 40×2
> character LCD driven by Mode → Function → Page → Cursor(A–H) → Value. Nothing below
> resembles that. See §8.

---

## 1. Window bands

| Band | Top | Height | Contents |
|---|---|---|---|
| **Header** | 0% | ~13% | Mode block, instrument + program LCD, 5 mode buttons, logo |
| **Tab strip** | ~13% | ~5% | Two tab groups + PREVIEW |
| **Work area** | ~18% | ~64% | Three columns — §3 |
| **Keyboard** | ~82% | ~18% | Wheel assembly + full keybed |

## 2. Header (0–13%)

**Mode block** (x ≈ 2–19%) — a bordered inset containing three tiers:
- `COMBI MODE` — large, white, the current top-level mode
- `MASTER VOLUME` + a horizontal level bar
- Three small buttons: `FILE` · `WRITE` · `UTILITY`

*(First-pass correction: I misread this as "T1 SINGLE UTILITY". It is a master-volume strip
plus a file/write/utility button row.)*

**Instrument + program** (x ≈ 19–39%):
- `INSTRUMENT` label + `MULTIPLE INST` dropdown
- Below it the program name in large green LCD — `Ensemble 2`. The visual anchor of the design.

**Mode buttons** (x ≈ 46–83%): five labels in a row — `BROWSER` · `COMBI` · `MULTI` · `PROG` ·
`GLOBAL` — each with a **round LED button beneath the label**. `COMBI` is lit bright red; the
rest are dark. These are mode switches, not tabs.

**Logo** (x ≈ 85–98%): `KORG` + `M1`. **Trade dress — do not reproduce.**

## 3. Work area (18–82%) — three columns

### Left: timbre strips (x ≈ 2–39%)

Eight rows, each ~8% of window height. Row 1 carries a **green vertical bar on its outer edge**
= selected timbre. Per row, left to right:

| Element | Detail |
|---|---|
| Row number | `1`–`8`, small left gutter |
| Button cluster | `SOLO` · `MUTE` · `IFX` · `▼` — four small buttons |
| Program name | Green LCD field. Empty slots show `- - - - - - -` (rows 4–8 here) |
| `LEVEL` | Numeric (`90`, `55`, `25`, `80`…) **plus a horizontal slider beneath** |
| `PAN` | Value in `L/C/R` + 2-digit form (`R13`, `C00`, `L13`) **plus a small rotary** |
| `OUT` | Dropdown, `1+2` / `3+4` |

*(First-pass correction: this column is ~37% wide, not ~30%, and each row carries a slider,
a rotary, a dropdown and four buttons — considerably richer than the three readouts I saw in
the thumbnails.)*

### Centre: edit panels (x ≈ 40–73%)

**`OSC`** (top):
- `OSC MODE` — three checkboxes stacked: `SINGLE` (checked) · `DOUBLE` · `DRUMS`
- `MULTI SOUND 1` — green LCD name field (`Flute`), a `LEVEL` field, and a **`BROWSER` button**
- `MULTI SOUND 2` — the same trio (`Piano`), **entirely greyed out** because mode is SINGLE

**`LINK EDIT`** (narrow panel, x ≈ 40–46%): an icon toggle, `SELECT` label, two greyed buttons.
Links OSC1/OSC2 edits together.

**`VDF`**:
- Header with small `VDF 1` / `VDF 2` tabs (2 greyed)
- A **filter-response graph** — dark inset, a draggable square handle upper-left, curve falling
  to the right
- `EG INT 1` rotary reading `58`; `EG INT 2` rotary greyed at `00`
- `RESONANCE` row at the bottom with a `1` control and a greyed `2`

**`INSERT FX`** (bottom, x ≈ 40–73%):
- Slot `1` — dropdown reading `Exciter`, with up/down steppers
- Slot `2` — dropdown reading `Hall`, with up/down steppers
- `1 DRY/WET 2` — a large `WET` rotary and a second rotary reading `020`

### Right: envelope graphs (x ≈ 74–98%)

Two stacked panels, `VDF EG` above `VDA EG`, each ~22% of window height.

- Each has **`… EG 1` / `… EG 2` tabs** in its header (2 greyed)
- A row of **segment column headers** across the top: `ATTACK` · `DECAY` · `SLOPE` ·
  `RELEASE` (VDF) and `ATTACK` · `DECAY` · `SUSTAIN` · `RELEASE` (VDA)
- A polyline with **square draggable handles labelled `A`, `D`, `S`, `R`** at the breakpoints

Note the VDF trace sustains at a level and steps down at `R`; the VDA trace falls to the floor
at `R`. That matches the engine exactly — **VDF EG has a release *level*, VDA EG does not** and
always falls to zero. The two graphs must not be drawn from one component.

## 4. The `1`/`2` rule — the organising principle

Every per-oscillator control appears **twice**, suffixed `1` and `2`, and the `2` copy **greys
out in SINGLE mode**: `MULTI SOUND 1/2`, `EG INT 1/2`, `RESONANCE 1/2`, `VDF 1/2`,
`VDF EG 1/2`, `VDA EG 1/2`, `1 DRY/WET 2`.

This maps precisely onto the hardware's parameter layout, where OSC-2's block is OSC-1's block
at a **+40 byte offset** (SysEx bytes 63–102 and 103–142). Build the panel from one
per-oscillator component instantiated twice, bound to the two halves of the parameter model,
with a single `enabled` flag driven by `OSC MODE`. That one decision halves the UI work and
guarantees the two halves stay consistent.

## 5. Tab strip (13–18%)

Two independent groups on one row, all tabs green-outlined:

- **Left** (x ≈ 2–39%): `PERFORMANCE` · `MIDI` · `MASTER FX` — Combi-level pages
- **Right** (x ≈ 40–88%): `EASY` · `OSC` · `VDF` · `VDA` · `CONTROL` · `INSERT FX`
- **Far right**: `PREVIEW` + a numeric dropdown (`1`)

Active tab = solid bright green fill with dark text; inactive = dark fill, green text and border.

**`EASY` is not a section — it is a curated subset page.** It is selected here, yet the window
shows OSC, VDF, INSERT FX and both EGs simultaneously. `OSC`/`VDF`/`VDA` are separate deep-edit
tabs. This is the pattern that makes a 143-parameter instrument approachable, and it is the
most important thing to get right.

## 6. Keyboard (82–100%) — MEASURED

**It is a full 88-key piano, A0–C8** — 52 white + 36 black, confirmed by pixel scan matching
the black-key gap pattern against an A0 start. *(Correction: I read this as 61 keys by
assuming it matched the hardware's keybed. It does not.)*

| Property | At 1200px width | Ratio |
|---|---|---|
| Keybed width | 1023px, x = 154→1176 | **85.25% of window width** |
| White key pitch | 19.69px | — |
| White key height | ~104px | **1 : 5.5** (w:h) |
| Black key width | 12.4px | **0.63 × white pitch** |
| Black key height | ~66px | **0.63 × white height** |
| Keyboard zone | 130px | **19% of window height** |

Both black-key ratios landing on 0.63 is convenient — one variable drives both.

Gradients do the 3D work: white keys `#c7c6c4` (top) → `#fbfbf8` (bottom) — darker at the back;
black keys `#6a6a6a` → `#080808` with a bevel highlight band `#494949` at ~92% down (the front
lip). A decorative ridge strip ~17px tall sits above the keybed (3 ridges, ~6px period). The
joystick sits in an oval recess at x ≈ 25–150.

Velocity/click-zone behaviour is **undocumented** — the common convention (lower on the key =
higher velocity) is a reasonable default but unconfirmed for this plugin.

## 6b. Browser overlay — VERIFIED against Korg's own manual

A modal, thin blue border, near-black fill. **Different accent system from the edit pages:
blue, not lime. Lime = editing, blue = browsing.**

| Region | Contents |
|---|---|
| Top-left tabs | `COMBI` \| `PROG` — in Multi and Program mode, only `PROG` shows |
| SOUND DETAIL | `CARD K01   NO 00` + name below. Empty state `CARD --  NO --` |
| Top-right sub-tabs | `SEARCH` \| `CARD` \| `T1 CARD` |
| Header bar (light blue) | `INSTRUMENTS` … `ALL CLEAR` ‖ `CHARACTER` … `ALL CLEAR` |
| Two filter grids | **4 cols × 4 rows each** |
| Results grid | **5 cols × 10 rows = 50** — exactly one card's capacity |
| Scrollbar | **HORIZONTAL**, ◀ ▶ — you page sideways through cards, never scroll vertically |
| Bottom bar | `SOLO` far left; `CANCEL` `APPLY` `OK` far right |

**Corrections to my screenshot reading:**

| I read | Actually |
|---|---|
| 2 cols × 8 rows | **4 × 4** |
| `KB1` | **`K01`** — the LCD font's slashed zero (Ø) reads as B at small size |
| `VOCAL/AIRY` | **`VOCAL/AIRLY`** — Korg's typo, still shipping |
| `HARD`, `THIN` in CHARACTER | **Don't exist** — those slots swap with the tab, below |
| Vertical list | **Horizontal paging**, one card at a time |

**INSTRUMENTS** (row-major):
```
PIANO           KEYBOARD       ORGAN         BELL/MALLET
STRINGS         WOODWIND       BRASS         VOCAL/AIRLY
GUITAR/PLUCKED  BASS           SYNTH LEAD    SYNTH POLY
SYNTH PAD       SYNTH MOTION   SE/COMPLEX    DRUMS/HIT
```

**CHARACTER** — row 2, slots 3–4 **change with the top tab**:
```
BRIGHT        DARK        FAST          SLOW
FAT           SOFT        SPLIT         LAYER       ← COMBI tab
FAT           SOFT        SOLO          ENSEMBLE    ← PROG tab
ACOUSTIC      ELECTRIC    ETHNIC        SYNTHESIZED
DANCE/TECHNO  POPS/ROCK   JAZZ/FUNK     ORCHESTRA
```

**Behaviour — the load-bearing part:**
- **Shift+click** multi-selects; plain click replaces the selection.
- **Live faceting:** any INSTRUMENTS button that would yield an empty result **greys out and
  becomes unselectable.** This is what makes the grid self-teaching — replicate it.
- **Mutually-exclusive CHARACTER pairs** grey out while Shift is held: `BRIGHT↔DARK`,
  `FAST↔SLOW`, `FAT↔SOFT`, `SPLIT↔LAYER` (combi), `SOLO↔ENSEMBLE` (prog). The other eight
  combine freely.
- `ALL CLEAR` is **per column** — two separate buttons.
- AND/OR logic is never documented. Character behaves as AND (else forbidding BRIGHT+DARK would
  be pointless); instruments is probably OR. **UNCERTAIN** — needs testing for exact parity.
- **`SEARCH` is not a text search.** It is the tag-filter tab, counterpart to `CARD`. There is
  **no text-entry field anywhere in the browser**; names are 12 chars and never searched.
- **`APPLY` applies without closing** — audition-and-keep-browsing. `OK` applies and closes.
  Double-click a name does the same; single click auditions. `SOLO` ON = only the browsed sound.
- **No favourites, no ratings.** (The iPad iM1 adds a `RANKING` tab; desktop has none.)

### The `CARD` sub-tab

Replaces the two filter grids with a **7-column button grid** plus an info panel:

```
CARD 1   CARD 2   CARD 3   CARD 4   CARD 5   CARD 6   CARD 7
CARD 8   CARD 9   CARD 10  CARD 11  CARD 12  CARD 13  CARD 14
CARD 15  CARD 16  CARD 17  CARD 18  CARD 19  CARD 20  CARD 21
KLC      ·        ·        USER 1   USER 2   USER 3   USER 4
```

The info panel to the right shows three lines — card number, product code, title — **plus a
photograph of the physical M1 memory card** (e.g. `CARD 1 / MPC-00P / M1 PRESETS`). That
artwork is trade dress; the *pattern* (card identity as a pictured physical object) is not.

**ID prefixes** used in SOUND DETAIL and in result rows: `M01`–`M21` (ROM cards), `K01` (KLC —
the 50 sounds written new for the plugin), `U01`–`U04` (user), `T01`–`T11` (T1 tab).

**The `T1 CARD` sub-tab** is the same layout with **11 buttons and no KLC or USER row**. Its
info panel shows a **floppy disk**, not a card — the T-series shipped on MF2HD disks.

> **Quirk, unexplained:** with T1 CARD 2 selected, SOUND DETAIL reads `CARD T02` but the result
> rows are prefixed **`M28`** (verified at 12× zoom). So the T1 tab is a *view* onto cards
> living in M-numbered space beyond M21. **Do not assume `T01→M22`** — the only datapoint is
> `T1 CARD 2 → M28`.

User memory = 4×50 combis, 4×50 programs, 2×20 drum kits = **440 slots**. The advertised
**3,300** presets reconciles: 2,700 + 613 T-series.

### A second, simpler browser exists

Opened from the `BROWSER` button beside `MULTI SOUND 1/2` on the OSC/EASY page. It picks
**multisounds, drum sounds and drum kits** — not programs. Only `SEARCH` | `CARD` tabs, an
INSTRUMENTS grid with **no CHARACTER grid**, and its `SOLO` means something different: ON =
play the raw sound as stored, ignoring edit-page parameters. Multisounds come from 16 preset
cards, drum kits from 21. Note it spells the tag **`VOCAL/ AIRY`** correctly — the typo is only
in the program browser.

> **Unresolved conflict:** the 2005 manual (p.71) says the WRITE dialog reuses the INSTRUMENTS
> and CHARACTER grids to tag a sound you save, which would let user sounds join the tag search.
> Sound On Sound's review lists as a con: *"No way to add Browser search tags to User bank
> sounds."* Both can't be right. Resolve against the running plugin before building user tagging.

**Two touches worth stealing:** the WRITE dialogs reuse this exact chrome **in orange**; and the
main panel's `INSTRUMENT: <type>` label is clickable, opening the browser **pre-filtered**.

## 7. Visual language — MEASURED

Values below are **exact pixel reads** from Korg's own lossless PNG
(`cdn.korg.com/us/products/upload/f72f53c896d364531ee9821a696ff5a9_pc.png`, 1200×683 —
aspect **1.757:1**, confirming the 1.75 measured from the user capture). They supersede my
eyeball estimates, which were wrong in several places.

```css
/* Chassis — cool/green-tinted (R < G ≈ B) */
--frame-face:      #4f5554;   /* outer frame, top shoulder plate */
--frame-highlight: #636967;   /* 1–2px top/left bevel */
--frame-groove:    #0f1210;
--body:            #252a2c;   /* behind panels */

/* Modules — perfectly neutral (saturation 0) */
--panel:           #2d2d2d;
--well:            #141414;   /* inset field — most-used colour in the UI */
--display-field:   #3b3b3b;   /* program-name field, grad #373737→#4e4e4e */
/* graph wells: vertical grad #232323 → #0a0a0a */

/* Accents */
--green:           #cdfc50;   /* CHARTREUSE. Active tab fill + enabled LABELS */
--green-hi:        #e0ff55;   /* 1px top highlight on active tab */
--green-disabled:  #495719;   /* same hue, ~35% luminance */
--led-red:         #e24228;   /* lit mode LED — the ONLY red in the UI */
--blue-accent:     #abc5e1;   /* FILE/WRITE/UTILITY borders, slider fills */
--logo-silver:     #b5bdc2;
--ink:             #fcfcfc;   /* VALUES and EG traces */
--key-white:       #fafaf7;   /* grad #c7c6c4 top → #fbfbf8 bottom */
```

**The single most important structural finding: the chassis is cool-tinted, the modules are
perfectly neutral.** That two-temperature split is what makes panels read as separate physical
parts. Reproduce it or the result looks flat.

**Corrections to my first two passes** (I read these off compressed thumbnails):

| I wrote | Actually |
|---|---|
| Values green, labels not | **Inverted — values are white `#fcfcfc`, LABELS are green** |
| EG trace green | **White**, with grey square handles lettered `A`/`D`/`S`/`R` |
| Logo red | **Silver `#b5bdc2`**; the only red is the lit LED |
| Inactive tabs = grey text | **Green text + green border** on dark |
| Green ≈ `#8ee63c` | **`#cdfc50` — chartreuse, far more yellow** |
| Disabled ≈ 40% contrast | **Same hue at ~35% luminance** — `#cdfc50` → `#495719` |

**Type — both my assumptions were wrong:**

- **Readouts are a plain MONOSPACE**, not an LCD/segment/dot-matrix face. DejaVu Sans Mono /
  Menlo genre. The "LCD feeling" comes from the *housing* — dark inset well, tabular alignment,
  monospace rhythm — not the letterforms. **Dropping in DSEG or a pixel font would look more
  retro than the real plugin.** Free matches: DejaVu Sans Mono, or JetBrains Mono / IBM Plex
  Mono on Google Fonts (both have the flagged `l`).
- **Labels are a GEOMETRIC sans** — circular `O`, straight-legged `R`, pointed `M` apex.
  Futura/Avenir genre, and **wide, not condensed**. Best OFL match: **Jost\*** at weight 500.
  Add `letter-spacing: 0.08–0.10em` for the small caps and bump one weight to compensate.

**Mode-signalling by hue.** The BROWSER page uses an entirely different accent system —
near-black `#03080e`, periwinkle text `#b0cbe8`, blue active fills `#2d68ac`. **Lime = editing,
blue = browsing.** Worth stealing outright.

**Control idioms:** small rotaries with a value beneath; horizontal sliders paired with a
numeric; dropdowns with up/down steppers; checkbox-style radio groups; `BROWSER` buttons that
open the modal picker in place.

---

## 8. Engine vs. skin — the decision this forces

The plugin shows two things the 1988 hardware **does not have**:

- **`RESONANCE`** — the hardware VDF is non-resonant, confirmed three ways (the `F 2-1` page
  has exactly two parameters; the SysEx table allocates seven bytes with no room for Q; the
  word never appears in a filter context).
- **`INSERT FX`, two slots** — the hardware has two *master* effects and no inserts.

Korg's own resolution is the one to copy: their plugin ships resonance as an **opt-in switch**,
which exists precisely because the original lacked it.

> Build the **hardware** engine. Wear the **plugin** UI. Ship the additions as switchable
> extensions defaulting to off, and label that state honestly.

The `I17 Organ 2` acceptance test must still pass with extensions off.

## 9. Implementation notes

- **Design-space layout.** SynthStack's `src/ui/stage16x9.ts` already implements the right
  mechanism — a fixed design-coordinate space plus a `designToScreen` transform. Copy the
  ~80-line tail (`designToScreen`, `polygonPath`, `insetRectilinear`) and replace the 16:9
  constants with this **7:4** design box. The percentages above become design rectangles.
- **Per-oscillator component.** See §4 — one component, two instances, one `enabled` flag.
- **Two EG components, not one.** See §3 — the release-level asymmetry is real engine
  behaviour, not a drawing detail.
- **Disabled state is a first-class visual.** Roughly a third of the centre column is greyed in
  SINGLE mode. Design the disabled treatment early rather than bolting it on.

## 10. Trade dress — what to avoid, what's generic

**Do not reproduce:**
- The **KORG wordmark**, its silver + blue-chip treatment, and the logo/`M1` top-right lockup
- The **`M1`** name and badge
- **`VDF` / `VDA` as nomenclature** — these are Korg's proprietary terms, not generic. **Use
  `FILTER` / `AMP`.** *(This one is easy to adopt accidentally, since every spec document uses
  Korg's names. Translate at the UI boundary; keep VDF/VDA internally where they match the
  SysEx model.)*
- The tab label *sequence* as a set; any extracted bitmap; pixel-for-pixel panel recreation
- The ROM-card artwork

**Generic convention — safe:** dark chassis with beveled frame and recessed panels; the
two-temperature chassis/module split; a bottom keyboard with wheels at left; tab strips with a
filled active state; round LED-lit mode buttons; envelope graphs with draggable square handles;
monospace values in inset wells; tracked all-caps labels; same-hue-lower-luminance disabled
states; chartreuse-on-dark as a relationship.

**Safest move:** keep the structural grammar and the colour *relationships* (chassis cooler
than modules, one accent hue, values white / labels accented, disabled at 35% luminance) and
change the hue, the nomenclature, and the branding. Reads as the same design language, carries
no Korg mark. Note trade dress is judged on overall look-and-feel, not element by element — so
the more of the *combination* you keep, the less element-wise analysis protects you.

## 11. Open questions

**Answered:** aspect ratio (1.757:1, matching the 1.75 measured from the capture); keyboard
(88 keys); colour palette; typography.

**Still open:**
- **There is no single native pixel size.** Korg never publishes one and the plugin has **six
  scale levels**. Treat 1200×683 as a proportional reference frame — which is exactly what a
  design-coordinate space (§9) is for.
- **Which GUI generation the user's screenshots show.** The high-res capture matches V2 (2020+)
  on every structural tell — green-bordered inactive tabs, white EG traces with `A/D/S/R`
  handles, red lit LED, silver logo. The two earlier thumbnails look rounder and more
  gradient-heavy and may be V1 (2005–2019), whose assets Korg has removed. **Build to V2.**
- Whether the name fields are white-on-grey (as measured on the V2 reference) or green (as they
  appear in the user capture). Verify against the capture directly before fixing the palette.
- Exact VDF EG segment header wording (`SLOPE` vs `BREAK`).
- Whether per-timbre `IFX` is an insert-FX send or an enable toggle.
