import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/app.css',import.meta.url),'utf8');
test('deposit and withdraw cards expose contextual history action',()=>{
 assert.match(js,/HISTORY BANK/); assert.match(js,/HISTORY TRANSAKSI/); assert.match(js,/data-money-history/);
 assert.doesNotMatch(js,/data-money-profile=/);
});
test('money history opens in existing responsive modal without switching page',()=>{
 assert.match(js,/async function openMoneyHistory/);
 assert.match(js,/\/api\/player\/history/);
 assert.match(js,/\/api\/player\/transaction-history/);
 assert.match(css,/modal-history-wrap/); assert.match(css,/@media\(max-width:760px\)/);
});
