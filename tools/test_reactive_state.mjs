import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = await readFile(new URL('../app/root.js', import.meta.url), 'utf8');
const dataBody = root.match(/data:\s*function\s*\(\)\s*\{\s*return\s*\{([\s\S]*?)\n\s*\};/);
assert.ok(dataBody, 'root data declaration must exist');

const required = [
  'bgmVolume',
  'flowRoute',
  'flowChapterIndex',
  'flowSelectedNodeId',
  'flowNotice',
  'flowPanMaxX',
  'flowPanMaxY',
  'activeChoice',
  'choiceNotice',
  'choiceSelections',
  'choiceFlags'
];
for (const field of required) {
  assert.match(
    dataBody[1],
    new RegExp(`(^|\\n)\\s*${field}\\s*:`),
    `${field} must be declared in root data for reactive updates`
  );
}
console.log('PASS title and flowchart UI state is declared as reactive root data');
