import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/app.css',import.meta.url),'utf8');
const up=fs.readFileSync(new URL('../src/upstream.js',import.meta.url),'utf8');
test('deposit filter uses destination To bank',()=>{assert.match(app,/moneyType==='deposit'.*destinationBankName/s);assert.match(up,/destinationBankName/);assert.match(up,/To\\s\*:/)});
test('selection checkbox is prominent',()=>{assert.match(app,/money-select-prominent/);assert.match(css,/money-select-box/);assert.match(css,/width:34px/)});
test('account number and name are large and labelled',()=>{assert.match(app,/NOMOR REKENING/);assert.match(app,/NAMA REKENING/);assert.match(css,/font-size:24px/);assert.match(css,/font-size:21px/)});
