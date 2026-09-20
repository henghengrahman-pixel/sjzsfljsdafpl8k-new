import * as cheerio from 'cheerio';
import { encryptText, decryptText } from './security.js';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function normalizeCookieString(raw){
  return String(raw||'').split(';').map(x=>x.trim()).filter(Boolean).filter(x=>x.includes('=')).join('; ');
}
function cookieMap(cookie){
  const map=new Map();
  for(const pair of String(cookie||'').split(';')){
    const p=pair.trim(); const i=p.indexOf('='); if(i<=0) continue;
    map.set(p.slice(0,i).trim(),p.slice(i+1).trim());
  }
  return map;
}
function mergeSetCookies(cookie, setCookies=[]){
  const map=cookieMap(cookie);
  for(const sc of setCookies){
    const first=String(sc).split(';',1)[0]; const i=first.indexOf('='); if(i<=0) continue;
    const k=first.slice(0,i).trim(), v=first.slice(i+1).trim();
    if(v==='') map.delete(k); else map.set(k,v);
  }
  return [...map].map(([k,v])=>`${k}=${v}`).join('; ');
}
function looksLoggedOut(html){
  const t=String(html||'').toLowerCase();
  return (t.includes('type="password"') || t.includes("type='password'")) && (t.includes('login') || t.includes('username'));
}
function clean(s){ return String(s||'').replace(/\s+/g,' ').trim(); }
function visibleText(html){ const $=cheerio.load(html); $('script,style,noscript').remove(); return clean($('body').text()); }
function tableRows(html){
  const $=cheerio.load(html); const rows=[];
  $('tr').each((_,tr)=>{
    const cells=$(tr).find('th,td').map((__,el)=>clean($(el).text())).get();
    if(cells.length) rows.push(cells);
  });
  return rows;
}
function formHidden(html){
  const $=cheerio.load(html); const out={};
  $('input[type="hidden"][name]').each((_,el)=>{out[$(el).attr('name')]=$(el).attr('value')||'';});
  return out;
}
function labelValueRows(html){
  const $=cheerio.load(html); const out={};
  $('tr').each((_,tr)=>{
    const cells=$(tr).find('td'); if(cells.length < 2) return;
    const label=clean($(cells[0]).text()).replace(/:$/,'');
    if(!label || label.length>80) return;
    const cell=$(cells[1]);
    let value='';
    const input=cell.find('input:not([type="button"]):not([type="submit"])').first();
    const select=cell.find('select').first();
    if(input.length) value=input.attr('value')||'';
    else if(select.length) value=clean(select.find('option:selected').text() || select.find('option').first().text());
    else value=clean(cell.text());
    if(value || ['Email','Telepon'].includes(label)) out[label]=value;
  });
  return out;
}
function parseHistory(html){
  const rows=tableRows(html), out=[];
  for(const cells of rows){
    if(cells.length < 6) continue;
    if(/^\d+$/.test(cells[0]) && /\d{2}-\d{2}-\d{4}/.test(cells[1])){
      out.push({no:Number(cells[0]),date:cells[1],info:cells[2],by:cells[3],coin:cells[4],lastCoin:cells[5]});
    }
  }
  return out;
}
export function parseSearch(html){
  const $=cheerio.load(html); const players=[];
  // A result row contains nested forms/tables in the Tools cell. Cheerio's
  // HTML parser can re-parent invalid table/form markup, so do not require
  // the Profil form to remain a DOM descendant of the outer result <tr>.
  // Instead identify real player rows by their column layout and read UserId
  // + bank/account directly from the row cells.
  $('tr.table-row').each((_,tr)=>{
    const cells=$(tr).children('td');
    if(cells.length < 8) return;
    const no=clean($(cells[0]).text());
    if(!/^\d+$/.test(no)) return;
    const userid=clean($(cells[1]).clone().find('br,font,a,img,form,table').remove().end().text()) || clean($(cells[1]).contents().first().text());
    if(!userid) return;
    const bankRaw=clean($(cells[3]).text());
    const parts=bankRaw.split(',').map(clean);
    players.push({
      userid,
      referral:clean($(cells[2]).text()),
      bank:parts[0]||'',
      accountName:parts.length>2?parts.slice(1,-1).join(','):parts[1]||'',
      accountNumber:parts.length>2?parts[parts.length-1]:'',
      bankRaw,
      balance:clean($(cells[4]).text()),
      joinedAt:clean($(cells[5]).text()),
      phone:clean($(cells[6]).text()),
      email:clean($(cells[7]).text()),
      cells:cells.slice(0,8).map((__,el)=>clean($(el).text())).get()
    });
  });
  // Compatibility with cleaner/older HTML where forms are properly nested.
  if(!players.length){
    $('form[action*="editplayerlist.php"] input[name="user"]').each((_,el)=>{
      const user=clean($(el).attr('value'));
      if(user) players.push({userid:user,cells:[]});
    });
  }
  const uniq=[]; const seen=new Set();
  for(const p of players){const k=p.userid.toLowerCase();if(!seen.has(k)){seen.add(k);uniq.push(p);}}
  return uniq;
}

function parseTransactionHistory(html){
  const $=cheerio.load(html); const rows=[];
  $('tr').each((_,tr)=>{
    const cells=$(tr).find('td').map((__,el)=>clean($(el).text())).get();
    if(cells.length < 8) return;
    const no=clean(cells[0]);
    if(!/^\d+$/.test(no)) return;
    // admin_transaksi.php normally returns 9 columns:
    // No, Periode, Tanggal, Keterangan, Status, Debet, Credit, Saldo, Via.
    // Keep Via optional for older variants with only eight cells.
    rows.push({
      no:Number(no), periode:cells[1]||'', tanggal:cells[2]||'', keterangan:cells[3]||'',
      status:cells[4]||'', debet:cells[5]||'', credit:cells[6]||'', saldo:cells[7]||'', via:cells[8]||''
    });
  });
  return rows;
}

function amountNumber(s){ return Number(String(s||'').replace(/[^\d]/g,'')) || 0; }
function actionMatches(info,type){
  const x=String(info||'').toLowerCase(); return type==='depo' ? x.includes('deposit') : x.includes('withdraw');
}

export class UpstreamClient{
  constructor(db,cfg){this.db=db;this.cfg=cfg;}
  async getCookie(){
    const q=await this.db.query('SELECT encrypted_cookie FROM upstream_sessions WHERE id=1');
    const blob=q.rows[0]?.encrypted_cookie; if(!blob) throw new Error('UPSTREAM_SESSION_EMPTY');
    return decryptText(blob,this.cfg.vaultKey);
  }
  async saveCookie(cookie,userId=null,status='connected',error=null){
    const normalized=normalizeCookieString(cookie); if(!normalized) throw new Error('COOKIE_EMPTY');
    const enc=encryptText(normalized,this.cfg.vaultKey);
    await this.db.query(`UPDATE upstream_sessions SET encrypted_cookie=$1,status=$2,last_checked_at=NOW(),last_error=$3,updated_by=$4,updated_at=NOW() WHERE id=1`,[enc,status,error,userId]);
  }
  async markStatus(status,error=null){
    await this.db.query(`UPDATE upstream_sessions SET status=$1,last_checked_at=NOW(),last_error=$2,updated_at=NOW() WHERE id=1`,[status,error]);
  }
  async request(path,{method='GET',form=null}={}){
    let cookie=await this.getCookie();
    const headers={
      'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
      'cookie':cookie,
      'referer':`${this.cfg.upstreamBaseUrl}/`
    };
    let body;
    if(form){headers['content-type']='application/x-www-form-urlencoded;charset=UTF-8';body=new URLSearchParams(form);}
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),this.cfg.upstreamTimeoutMs);
    let res,html;
    try{
      res=await fetch(`${this.cfg.upstreamBaseUrl}${path}`,{method,headers,body,redirect:'follow',signal:controller.signal});
      html=await res.text();
    } finally { clearTimeout(timer); }
    const setCookies = typeof res?.headers?.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    if(setCookies.length){
      cookie=mergeSetCookies(cookie,setCookies);
      await this.saveCookie(cookie,null,looksLoggedOut(html)?'expired':'connected',null);
    }
    if(looksLoggedOut(html)){ await this.markStatus('expired','Session upstream tidak valid / sudah logout'); throw new Error('UPSTREAM_SESSION_EXPIRED'); }
    return {status:res.status,ok:res.ok,html,url:res.url};
  }
  async testSession(){
    try{
      const r=await this.request('/agentplayerlist.php');
      const ok=r.ok && !looksLoggedOut(r.html) && r.html.toLowerCase().includes('userid');
      await this.markStatus(ok?'connected':'invalid',ok?null:`HTTP ${r.status}`);
      return {ok,status:r.status,connected:ok};
    }catch(e){await this.markStatus('invalid',e.message);return {ok:false,connected:false,error:e.message};}
  }
  async manualTransaction({userid,type,amount,info=''}){
    const r=await this.request('/agen_transmanual.php?action=2',{method:'POST',form:{userid,info,pilihan:type,amount:String(amount),submit:'true'}});
    const text=visibleText(r.html).slice(0,1000);
    const low=text.toLowerCase();
    const rejected=!r.ok || /(error|gagal|invalid|not found|tidak ditemukan|failed)/i.test(text);
    return {http:r.status,rejected,message:text||`HTTP ${r.status}`,raw:r.html};
  }
  async searchPlayer({type='userid',value}){
    // agentplayerlist.php search form is POST. Preserve every field used by
    // the real form, including usercheck only for UserId searches.
    const base={statusnya:'',banknya:'',name:'',phone:'',reffu:'',keterangan:'',balance1:'',balance2:'',page:'1',bts:'50',cari:'Cari'};
    const form=type==='rekening'
      ? {...base,user:'',rek:value}
      : {...base,usercheck:'1',user:value,rek:''};
    let r=await this.request('/agentplayerlist.php',{method:'POST',form});
    let players=parseSearch(r.html);
    const needle=clean(value).toLowerCase();
    // Never accept an unfiltered page as a successful search. Match the
    // requested field locally as a second safety layer.
    players=players.filter(p=>type==='rekening'
      ? clean(p.accountNumber).replace(/\D/g,'')===needle.replace(/\D/g,'') || clean(p.bankRaw).replace(/\D/g,'').includes(needle.replace(/\D/g,''))
      : clean(p.userid).toLowerCase()===needle);
    // Some deployments also accept the same filter through query params.
    if(!players.length){
      const qs=new URLSearchParams(form);
      r=await this.request(`/agentplayerlist.php?${qs.toString()}`);
      players=parseSearch(r.html).filter(p=>type==='rekening'
        ? clean(p.accountNumber).replace(/\D/g,'')===needle.replace(/\D/g,'') || clean(p.bankRaw).replace(/\D/g,'').includes(needle.replace(/\D/g,''))
        : clean(p.userid).toLowerCase()===needle);
    }
    return {http:r.status,source:'agentplayerlist.php',searchType:type,query:value,players};
  }
  async profile(userid){
    const r=await this.request('/editplayerlist.php',{method:'POST',form:{user:userid,cmdsend:'Profil'}});
    return {http:r.status,profile:labelValueRows(r.html),hidden:formHidden(r.html)};
  }
  async history(userid){
    const r=await this.request('/editcoinhis.php',{method:'POST',form:{user:userid,cmdsend:'History Bank'}});
    return {http:r.status,rows:parseHistory(r.html)};
  }
  async updateProfile(userid,{username,marketing,bank,acc,rek,color}){
    // editplayerlist.php uses these exact field names in its Edit Player List form.
    const form={userid,username,marketing,bank,acc,rek,color,submit:'Submit'};
    const r=await this.request('/editplayerlist.php',{method:'POST',form});
    const text=visibleText(r.html).slice(0,1400);
    const profile=labelValueRows(r.html);
    const rejected=!r.ok || /(error|gagal|invalid|failed)/i.test(text);
    return {http:r.status,ok:!rejected,message:text,profile};
  }
  async resetPassword(userid,password){
    const p=await this.profile(userid);
    const resolved=p.hidden.userid || userid;
    const r=await this.request('/editplayerlist.php',{method:'POST',form:{userid:resolved,news:password,news2:password,change:'Reset Password'}});
    const text=visibleText(r.html).slice(0,1000);
    const ok=r.ok && !/(error|gagal|invalid|failed)/i.test(text);
    return {http:r.status,ok,message:text};
  }
  async transactionHistory(userid){
    // history_trans.php is only the search page. Its form POSTs to
    // admin_transaksi.php with the field name `namague`.
    const r=await this.request('/admin_transaksi.php',{method:'POST',form:{namague:userid,submit:'Submit'}});
    const rows=parseTransactionHistory(r.html);
    const text=visibleText(r.html);
    const low=text.toLowerCase();
    if(!r.ok) throw new Error(`UPSTREAM_HTTP_${r.status}`);
    if((low.includes('login') && low.includes('password')) || looksLoggedOut(r.html)) throw new Error('UPSTREAM_SESSION_EXPIRED');
    return {http:r.status,source:'history_trans.php -> admin_transaksi.php',userid,rows};
  }
  async verifyTransaction(userid,type,amount){
    for(let i=0;i<this.cfg.verifyRetries;i++){
      if(i) await sleep(this.cfg.verifyDelayMs);
      const h=await this.history(userid);
      const match=h.rows.find(row=>actionMatches(row.info,type) && amountNumber(row.coin)===Number(amount));
      if(match) return {verified:true,match,rows:h.rows.slice(0,15)};
    }
    return {verified:false};
  }
}
