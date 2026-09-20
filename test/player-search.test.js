import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch } from '../src/upstream.js';

test('parseSearch reads real agentplayerlist nested-tools row',()=>{
 const html=`<table><tr class="table-row" bgcolor="#fff"><td>1</td><td>rizki320<a>x</a><br><font>No Name</font></td><td>ref1</td><td>DANA,RIZKI NUR AZIZ,083830268296</td><td>142,382</td><td>20-07-2026 18:45:41</td><td>083****87962</td><td>a***@mail.com</td><td><table><tr><td><form action="editplayerlist.php" method="post"><input name="user" type="hidden" value="rizki320"><input name="cmdsend" type="submit" value="Profil"></form></td></tr></table></td></tr></table>`;
 const p=parseSearch(html);
 assert.equal(p.length,1); assert.equal(p[0].userid,'rizki320'); assert.equal(p[0].accountNumber,'083830268296'); assert.equal(p[0].accountName,'RIZKI NUR AZIZ'); assert.equal(p[0].bank,'DANA');
});
