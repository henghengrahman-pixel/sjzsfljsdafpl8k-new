import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptText,decryptText } from '../src/security.js';
import { parseDateRange } from '../src/report.js';
test('vault encrypt/decrypt',()=>{const s='x'.repeat(32);const c=encryptText('PHPSESSID=abc',s);assert.notEqual(c,'PHPSESSID=abc');assert.equal(decryptText(c,s),'PHPSESSID=abc')});
test('date range',()=>assert.deepEqual(parseDateRange('2026-09-15','2026-09-16'),{from:'2026-09-15',to:'2026-09-16'}));
test('invalid date rejected',()=>assert.throws(()=>parseDateRange('15-09-2026','2026-09-16')));
