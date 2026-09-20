import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('transaction history integration uses canonical upstream form',()=>{
  const src=fs.readFileSync(new URL('../src/upstream.js',import.meta.url),'utf8');
  assert.match(src,/\/admin_transaksi\.php/);
  assert.match(src,/namague:userid/);
  assert.match(src,/submit:'Submit'/);
  assert.match(src,/parseTransactionHistory/);
});

test('player UI is single-panel and transaction history is mobile scrollable',()=>{
  const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../public/app.css',import.meta.url),'utf8');
  assert.match(js,/function hidePlayerPanels/);
  assert.match(html,/data-page="transhistory"/);
  assert.match(html,/id="transactionHistoryForm"/);
  assert.match(css,/transaction-history-wrap/);
  assert.match(css,/-webkit-overflow-scrolling:touch/);
});
