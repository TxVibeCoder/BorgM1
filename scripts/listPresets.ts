/** Dump the SF2's preset list. Build-time diagnostic. `npx tsx scripts/listPresets.ts` */
import { readFileSync } from 'node:fs';
import { SoundBankLoader } from 'spessasynth_core';
import { resolveSf2Path } from './bankConfig.ts';

const buf = readFileSync(resolveSf2Path());
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const bank = SoundBankLoader.fromArrayBuffer(ab);

const rows = bank.presets
  .map((p) => ({ bank: p.bankMSB, program: p.program, name: p.name, zones: p.zones.length, drum: p.isDrum }))
  .sort((a, b) => a.bank - b.bank || a.program - b.program);

for (const r of rows) {
  console.log(`${String(r.bank).padStart(3)}:${String(r.program).padStart(3)} ${r.drum ? 'D' : ' '} ${r.name.padEnd(24)} z=${r.zones}`);
}
console.log(`\n${rows.length} presets`);
