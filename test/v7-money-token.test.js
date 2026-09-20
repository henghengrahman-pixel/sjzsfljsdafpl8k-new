import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverMoneyPath,parsePendingMoney} from '../src/upstream.js';

const html=`<html><body>
<a href="agen_playermoneyx.php?action=1&code=5ad891828c8998d2">Deposit</a>
<a href="agen_playermoneyx.php?action=2&code=18964d4951475494">Withdraw</a>
<form method="POST"><table>
<tr><td>1</td><td><input type="checkbox" name="id_737559328"></td><input type="hidden" name="id2_63645068"><td>musaffir<br><a>Deposit</a></td><td>2026-09-20 16:15:44</td><td><b>50,000</b></td><td>662<br><b><a>G3</a></b></td><td>BRI, 450901028666539, SANDI</td><td>From : SANDI<br>To : BRI</td><td><span onclick="popUp('editplayerlist.php?user=musaffir&grup=3','700','500')">Profil</span></td></tr>
<tr><td colspan="10"><input type="hidden" name="insertLogWeb" value="logWeb"><input type="submit" name="submitForm" value="Accept"><input type="submit" name="submitForm" value="Reject"></td></tr>
<input type="hidden" name="action" value="1"></table></form>
<input type="hidden" id="secretcode" value="rotating-secret">
</body></html>`;

test('discovers rotating Deposit and Withdraw URLs',()=>{
 assert.equal(discoverMoneyPath(html,'deposit'),'/agen_playermoneyx.php?action=1&code=5ad891828c8998d2');
 assert.equal(discoverMoneyPath(html,'withdraw'),'/agen_playermoneyx.php?action=2&code=18964d4951475494');
});

test('parses real pending row even when transaction form has no action',()=>{
 const p=parsePendingMoney(html,'deposit');
 assert.equal(p.rows.length,1);
 assert.equal(p.rows[0].userid,'musaffir');
 assert.equal(p.rows[0].key,'id_737559328');
 assert.equal(p.rows[0].amount,'50,000');
 assert.equal(p.actionPath,'');
});
