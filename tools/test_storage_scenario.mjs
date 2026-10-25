import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storagePath = new URL('../app/storage.js', import.meta.url);
const original = await readFile(storagePath, 'utf8');
const stubbed = original.replace(
  "import { getGal, log } from './common.js';",
  "const getGal = () => globalThis.__testGal; const log = () => {};"
);
const storage = await import(
  'data:text/javascript;base64,' + Buffer.from(stubbed).toString('base64')
);

let persisted = null;
globalThis.__testGal = {
  readText: () => null,
  writeText: (_path, value) => {
    persisted = JSON.parse(value);
    return true;
  }
};

const record = storage.saveSlotRecord(1, {
  scenario: 'after_heroine_a',
  line: 42,
  chapter: '115',
  text: 'test'
});

assert.equal(record.scenario, 'after_heroine_a');
assert.equal(persisted.slot1.scenario, 'after_heroine_a');
assert.equal(persisted.slot1.line, 42);
console.log('PASS scenario is persisted with save slot data');
