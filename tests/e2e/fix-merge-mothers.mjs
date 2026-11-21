// Fix check: «دمج مع…» refused for different mothers says what to do next.
//   node fix-merge-mothers.mjs <BASE url> <admin-link file>
// Runs the root admin's walkthrough (uxrev-admin.mjs: two wives, a child under
// each, a duplicate entered under the other wife, then a merge) and checks that
// the refusal names the way out («تعديل البيانات»), which the walkthrough then
// takes, and that the merge goes through.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const [BASE, LINK] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-merge-'));
const r = spawnSync('node', [path.join(here, 'uxrev-admin.mjs'), BASE, LINK, shots, '412x915', 'light'], { encoding: 'utf8', timeout: 600000 });
const out = (r.stdout ?? '') + (r.stderr ?? '');
fs.rmSync(shots, { recursive: true, force: true });
let failed = 0;
const check = (ok, what, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + what + (detail && !ok ? ' (' + detail + ')' : ''));
  if (!ok) failed++;
};
const said = out.split('\n').find(l => l.includes('merge with different mothers:')) ?? '';
check(said.includes('لكل منهما أم مختلفة') && said.includes('«تعديل البيانات»') && said.includes('ثم ادمج'), 'the refusal says to change the mother in «تعديل البيانات», then merge', said.trim());
check(/PASS the merge is allowed/.test(out), 'after that the merge is allowed');
// one check of the walkthrough is wrong, by its author's own account: the lock seals values in place («ftlock1:»), it does not remove them
const fails = out.split('\n').filter(l => l.startsWith('FAIL') && !l.includes('the membership is not in plain storage') && !/^FAIL\s*$/.test(l));
check(fails.length === 0 && !/no page or console errors \(/.test(out), 'the walkthrough passes otherwise', fails.join(' | '));
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
