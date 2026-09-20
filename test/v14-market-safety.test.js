import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const app=fs.readFileSync('public/app.js','utf8'),html=fs.readFileSync('public/index.html','utf8'),server=fs.readFileSync('src/server.js','utf8'),up=fs.readFileSync('src/upstream.js','utf8');
test('calculate has no prize inputs and has confirmation summary',()=>{assert.match(html,/id="calculateSummary"/);assert.doesNotMatch(html,/id="calculateNumbers"/);assert.match(app,/HITUNG \/ BAYAR KEMENANGAN/);assert.match(app,/membayar kemenangan member/)});
test('market closed gates result and calculate client and server',()=>{assert.match(up,/marketOpen=Boolean/);assert.match(server,/MARKET_CLOSED/);assert.match(app,/Pasaran sedang tutup/)});
test('calculate uses upstream pending result, not typed numbers',()=>{assert.match(server,/pendingCalculation/);assert.match(server,/payload=\{\.\.\.p\.data,period:String\(x\.period\)/);assert.match(up,/calculateReady/)});
