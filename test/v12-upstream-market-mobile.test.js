import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const upstream=fs.readFileSync(new URL('../src/upstream.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/app.css',import.meta.url),'utf8');
test('market integration uses AGWL5 canonical psr/pasar endpoints',()=>{
  assert.match(upstream,/admin_angka13\.php\?psr=/);
  assert.match(upstream,/admin_prediksifullbb\.php\?psr=/);
  assert.match(upstream,/admin_menkalahbb\.php\?/);
  assert.match(upstream,/pasar:id,tipe:'A'/);
  assert.match(upstream,/angka:n1,angka2:n2,angka3:n3,psr:id/);
  assert.match(upstream,/nomor:n1,nomor1:n2,nomor2:n3/);
  assert.match(upstream,/MARKET_RESULT_NOT_VERIFIED/);
  assert.match(upstream,/MARKET_CALCULATE_NOT_CONFIRMED/);
});
test('deposit withdraw preserve upstream row number and mobile hardening',()=>{
  assert.match(upstream,/no:clean\(\$\(cells\[0\]\)\.text\(\)\)/);
  assert.match(app,/money-seq/);
  assert.match(css,/V12 mobile stability/);
  assert.match(css,/overflow-x:hidden/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)!important/);
});
