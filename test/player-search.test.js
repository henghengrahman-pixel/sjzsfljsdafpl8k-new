import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch } from '../src/upstream.js';

const html=`<table><tr><td>1</td><td>benteng02<br><font>No Name</font></td><td>jemerang900</td><td>BSI,HUSAINI HAMID,7366592525</td><td>142,382</td><td>20-07-2026 18:45:41</td><td>082****43324</td><td>ben*****benteng838@gmail.com</td><td><form action='editplayerlist.php' method='post'><input name='user' type='hidden' value='benteng02'><input name='cmdsend' type='submit' value='Profil'></form><form action='editcoinhis.php' method='post'><input name='user' type='hidden' value='benteng02'><input name='cmdsend' type='submit' value='History Bank'></form></td></tr></table>`;

test('agentplayerlist parser resolves canonical userid from result row',()=>{
  const rows=parseSearch(html);
  assert.equal(rows.length,1);
  assert.equal(rows[0].userid,'benteng02');
  assert.ok(rows[0].cells.join(' ').includes('7366592525'));
});
