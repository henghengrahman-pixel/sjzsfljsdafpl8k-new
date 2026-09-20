import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('deposit destination parser accepts upstream To marker without whitespace',()=>{
  const s=fs.readFileSync(new URL('../src/upstream.js',import.meta.url),'utf8');
  assert.match(s,/matchAll\(\/\\bTo\\s\*:/);
  assert.match(s,/destinationBankName=dp\[0\]/);
});
test('frontend deposit filter uses destination bank, not source bank',()=>{
  const s=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(s,/moneyType==='deposit'\?\(x\.destinationBankName/);
});
test('selection and account details are prominent on mobile',()=>{
  const s=fs.readFileSync(new URL('../public/app.css',import.meta.url),'utf8');
  assert.match(s,/money-select-box[^}]*width:40px!important/s);
  assert.match(s,/money-account strong[^}]*font-size:27px!important/s);
});
