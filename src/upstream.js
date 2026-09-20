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
  // agentplayerlist.php renders each result row with Profil + History Bank forms.
  // Read the userid from either form, then return the complete row so searches
  // by userid OR nomor rekening resolve to the same canonical player record.
  $('tr').each((_,tr)=>{
    const row=$(tr);
    const profile=row.find('form[action*="editplayerlist.php"] input[name="user"]').first();
    const history=row.find('form[action*="editcoinhis.php"] input[name="user"]').first();
    const user=clean(profile.attr('value') || history.attr('value') || '');
    if(!user) return;
    const cells=row.find('td').map((__,el)=>clean($(el).clone().find('form').remove().end().text())).get();
    players.push({userid:user,cells});
  });
  const uniq=[]; const seen=new Set();
  for(const p of players){const k=p.userid.toLowerCase();if(!seen.has(k)){seen.add(k);uniq.push(p);}}
  return uniq;
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
    // Match the actual agentplayerlist.php filter used by the upstream page.
    // The upstream pagination/sort links preserve `cekparam=1`, so use that
    // canonical GET shape first. POST is retained as a compatibility fallback.
    const params=new URLSearchParams({page:'1',bts:'50',cari:'Cari',cekparam:'1',statusnya:'',banknya:'',name:'',phone:''});
    if(type==='rekening') params.set('rek',value); else params.set('user',value);
    let r=await this.request(`/agentplayerlist.php?${params.toString()}`);
    let players=parseSearch(r.html);
    if(!players.length){
      const form={usercheck:type==='userid'?'1':'',user:type==='userid'?value:'',statusnya:'',banknya:'',name:'',rek:type==='rekening'?value:'',phone:'',page:'1',bts:'50',cekparam:'1',cari:'Cari'};
      r=await this.request('/agentplayerlist.php',{method:'POST',form});
      players=parseSearch(r.html);
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
  async resetPassword(userid,password){
    const p=await this.profile(userid);
    const resolved=p.hidden.userid || userid;
    const r=await this.request('/editplayerlist.php',{method:'POST',form:{userid:resolved,news:password,news2:password,change:'Reset Password'}});
    const text=visibleText(r.html).slice(0,1000);
    const ok=r.ok && !/(error|gagal|invalid|failed)/i.test(text);
    return {http:r.status,ok,message:text};
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
