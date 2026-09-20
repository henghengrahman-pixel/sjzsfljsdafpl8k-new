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

export function parseTransactionHistory(html){
  const $=cheerio.load(html); const rows=[];
  $('tr').each((_,tr)=>{
    const cellEls=$(tr).find('td');
    const cells=cellEls.map((__,el)=>clean($(el).text())).get();
    if(cells.length < 8) return;
    const no=clean(cells[0]);
    if(!/^\d+$/.test(no)) return;
    let detailPath='';
    // Preserve the real upstream transaction-detail identifier. Never invent tesi.
    $(cellEls[3]).find('a[href]').each((__,a)=>{
      const href=String($(a).attr('href')||'');
      const m=href.match(/(?:https?:\/\/[^/]+)?(\/user_detil\.php\?[^"'\s)]+)/i) || href.match(/(user_detil\.php\?[^"'\s)]+)/i);
      if(m && !detailPath) detailPath=m[1].startsWith('/')?m[1]:'/'+m[1];
    });
    rows.push({
      no:Number(no), periode:cells[1]||'', tanggal:cells[2]||'', keterangan:cells[3]||'',
      status:cells[4]||'', debet:cells[5]||'', credit:cells[6]||'', saldo:cells[7]||'', via:cells[8]||'', detailPath
    });
  });
  return rows;
}

function jsPopupPath(raw){
  const x=String(raw||'');
  const m=x.match(/popUp\(\s*['"]([^'"]+)['"]/i);
  return m?m[1]:'';
}
function safeRelativePath(raw,allowed){
  if(!raw) return '';
  try{
    const u=new URL(raw,'https://placeholder.invalid/');
    if(!allowed.includes(u.pathname)) return '';
    return u.pathname+(u.search||'');
  }catch{return ''}
}
export function discoverMoneyPath(html,type){
  const $=cheerio.load(html);
  const action=type==='deposit'?'1':'2';
  let found='';
  $('a[href]').each((_,a)=>{
    if(found) return;
    const raw=String($(a).attr('href')||'').replace(/&amp;/g,'&');
    const safe=safeRelativePath(raw,['/agen_playermoneyx.php']);
    if(!safe) return;
    try{
      const u=new URL(safe,'https://placeholder.invalid');
      if(u.searchParams.get('action')===action && u.searchParams.get('code')) found=u.pathname+u.search;
    }catch{}
  });
  if(found) return found;
  // Fallback used by AGWL5: secretcode is the rotating navigation token.
  const secret=String($('#secretcode').attr('value')||'').trim();
  if(secret) return `/agen_playermoneyx.php?action=${action}&code=${encodeURIComponent(secret)}`;
  return '';
}

export function parsePendingMoney(html,type){
  const $=cheerio.load(html); const rows=[];
  // The Accept/Reject form itself carries a rotating code in its action.
  let form=$('form').filter((_,f)=>String($(f).attr('action')||'').includes('agen_playermoneyx.php')).filter((_,f)=>$(f).find('input[name="submitForm"]').length).first();
  if(!form.length) form=$('form').filter((_,f)=>$(f).find('input[name="submitForm"]').length).first();
  const actionRaw=String(form.attr('action')||'');
  const actionPath=safeRelativePath(actionRaw,['/agen_playermoneyx.php']);
  const common={};
  form.find('input[type="hidden"][name]').each((_,el)=>{ common[$(el).attr('name')]=$(el).attr('value')||''; });
  form.find('tr').each((_,tr)=>{
    const row=$(tr); const cb=row.find('input[type="checkbox"][name^="id_"]').first();
    if(!cb.length) return;
    const cells=row.children('td'); if(cells.length<6) return;
    const userid=clean($(cells[2]).find('strong').first().text()) || clean($(cells[2]).contents().first().text());
    if(!userid) return;
    const checkboxName=String(cb.attr('name')||'');
    const hiddenId2=row.find('input[type="hidden"][name^="id2_"]').first();
    const id2Name=String(hiddenId2.attr('name')||'');
    const amount=clean($(cells[4]).text());
    const balance=clean($(cells[5]).clone().find('br').replaceWith(' ').end().text());
    const bank=clean($(cells[6]).text());
    const bankParts=bank.split(',').map(clean).filter(Boolean);
    const bankName=bankParts[0]||'';
    const accountNumber=bankParts[1]||'';
    const accountName=bankParts.length>2?bankParts.slice(2).join(', '):'';
    const info=type==='deposit' ? clean($(cells[7]).text()) : '';
    let destination='';
    if(type==='deposit' && info){
      const m=info.match(/(?:^|\s)To\s*:\s*(.+)$/i);
      if(m) destination=clean(m[1]);
    }
    let profilePath='';
    row.find('[onclick]').each((__,el)=>{const p=jsPopupPath($(el).attr('onclick')); if(p.includes('editplayerlist.php')&&!profilePath) profilePath=safeRelativePath(p,['/editplayerlist.php']);});
    rows.push({
      key:checkboxName,checkboxName,id2Name,no:clean($(cells[0]).text()),userid,date:clean($(cells[3]).text()),amount,balance,bank,bankName,accountNumber,accountName,info,destination,
      group:clean($(cells[5]).find('a').last().text()),profilePath
    });
  });
  const banks=[];
  $('[id^="nama"]').each((_,el)=>{const t=clean($(el).text());if(t)banks.push(t)});
  return {actionPath,common,rows,banks:[...new Set(banks)]};
}
export function parseGameDetail(html){
  const $=cheerio.load(html); const tables=[];
  $('table').each((_,table)=>{
    const rows=[];
    $(table).find('tr').each((__,tr)=>{
      const cells=$(tr).find('th,td').map((___,el)=>clean($(el).text())).get();
      if(cells.length) rows.push(cells);
    });
    if(rows.length) tables.push(rows);
  });
  return {title:clean($('body').find('center,b,strong').first().text())||'Detail Transaksi',tables};
}

function amountNumber(s){ return Number(String(s||'').replace(/[^\d]/g,'')) || 0; }
function actionMatches(info,type){
  const x=String(info||'').toLowerCase(); return type==='depo' ? x.includes('deposit') : x.includes('withdraw');
}


function parseMarketCatalog(html){
  const $=cheerio.load(html), byName=new Map();
  const add=(name,id='',path='')=>{
    name=clean(name).replace(/[\[\]]/g,'').toUpperCase();
    id=String(id||'').trim(); path=String(path||'').trim();
    if(!/^[A-Z0-9][A-Z0-9 _.-]{1,30}$/.test(name)||['POOLS','POKER','MINIGAME'].includes(name))return;
    if(id && !/^p\d+$/i.test(id))id='';
    const prev=byName.get(name)||{name,id:'',path:''};
    if(id)prev.id=id; if(path)prev.path=path; byName.set(name,prev);
  };
  $('select option').each((_,o)=>{
    const el=$(o), raw=String(el.attr('value')||''), m=raw.match(/[?&](?:psr|pasar)=([^&#]+)/i);
    add(el.text(),m?decodeURIComponent(m[1]):'',raw);
  });
  $('a').each((_,a)=>{
    const el=$(a), raw=String(el.attr('href')||''), m=raw.match(/[?&](?:psr|pasar)=([^&#]+)/i);
    if(m && /admin_(?:angka13|prediksifullbb|menkalahbb)\.php/i.test(raw)) add(el.text(),decodeURIComponent(m[1]),raw);
  });
  // Current prediction page always exposes the canonical market id as `sar`.
  const sar=String($('input[name="sar"]').attr('value')||$('input[name="psr"]').attr('value')||'').trim();
  const title=clean($('body').text()).match(/(?:Prediksi \(BB\/FULL\)|Silahkan isi Angka baru)\s+([A-Z0-9_.-]+)/i);
  if(title) add(title[1],sar);
  return [...byName.values()].filter(x=>x.id).sort((a,b)=>a.name.localeCompare(b.name));
}
function parseMarkets(html){ return parseMarketCatalog(html).map(x=>x.name); }
function parseMarketHistory(html){
  const rows=tableRows(html), out=[];
  for(const c of rows){if(c.length<7)continue;const no=clean(c[0]);if(!/^\d+$/.test(no))continue;const period=c.find(x=>/^\d{2,8}$/.test(clean(x)))||'';const nums=c.filter(x=>/^\d{4}$/.test(clean(x)));if(nums.length>=3)out.push({no,date:c[1]||'',day:c[3]||c[2]||'',period,n1:nums[0],n2:nums[1],n3:nums[2],calculated:c.some(x=>/^yes$/i.test(clean(x)))?'Yes':''})}
  return out.slice(0,30);
}
function parseMarketPeriod(html){
  const $=cheerio.load(html);let v='';$('input').each((_,i)=>{const n=String($(i).attr('name')||'');if(!v&&/periode|period/i.test(n))v=String($(i).attr('value')||'').trim()});return v;
}
function formDescriptor(html,kind){
  const $=cheerio.load(html);let best=null,score=-1;
  $('form').each((_,f)=>{const form=$(f),txt=clean(form.text()).toLowerCase(),names=form.find('[name]').map((__,e)=>String($(e).attr('name')||'').toLowerCase()).get();let s=0;if(names.some(n=>/periode|period/.test(n)))s+=3;if(names.filter(n=>/nomor|prize|angka|result|keluar/.test(n)).length>=3)s+=4;if(kind==='prediction'&&/prediksi/.test(txt))s+=3;if(kind==='result'&&/(nomor keluar|prize)/.test(txt))s+=3;if(kind==='calculate'&&/hitung/.test(txt))s+=4;if(s>score){score=s;best=form}});if(!best||score<3)return null;
  const fields={};best.find('input[type="hidden"][name],select[name]').each((_,e)=>{const el=$(e),n=el.attr('name');if(!n)return;if(el.is('select'))fields[n]=el.find('option:selected').attr('value')||el.val()||'';else fields[n]=el.attr('value')||''});
  return {action:String(best.attr('action')||''),method:String(best.attr('method')||'POST').toUpperCase(),fields,names:best.find('input[name],select[name],button[name]').map((_,e)=>String($(e).attr('name')||'')).get(),submits:best.find('input[type="submit"],button[type="submit"],button:not([type])').map((_,e)=>({name:String($(e).attr('name')||''),value:String($(e).attr('value')||clean($(e).text()))})).get()};
}
function safeUpstreamAction(raw,fallback){try{const u=new URL(raw||fallback,'https://local.invalid');return u.pathname+u.search}catch{return fallback}}

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
  async transactionDetail(path){
    const safe=safeRelativePath(path,['/user_detil.php']);
    if(!safe) throw new Error('DETAIL_PATH_INVALID');
    const r=await this.request(safe);
    if(!r.ok) throw new Error(`UPSTREAM_HTTP_${r.status}`);
    return {http:r.status,path:safe,...parseGameDetail(r.html)};
  }
  async pendingMoney(type){
    const action=type==='deposit'?'1':'2';
    // The rotating money token is not guaranteed to be present on a bare
    // /agen_playermoneyx.php response. Discover it from several authenticated
    // operator pages, including the action lane itself. This mirrors browser
    // navigation instead of assuming one fixed landing page.
    const probes=[
      '/agen_playermoneyx.php',
      `/agen_playermoneyx.php?action=${action}`,
      '/agen_transmanual.php?action=2',
      '/agen_operator.php?action=4',
      '/agentplayerlist.php'
    ];
    let path=''; let last=null;
    for(const probe of probes){
      let landing;
      try{ landing=await this.request(probe); }catch(e){ if(e.message==='UPSTREAM_SESSION_EXPIRED') throw e; continue; }
      last=landing;
      if(!landing.ok) continue;
      path=discoverMoneyPath(landing.html,type);
      if(path) break;

      // A probe can itself be redirected to a valid rotating-code money URL.
      try{
        const u=new URL(landing.url);
        if(u.pathname==='/agen_playermoneyx.php' && u.searchParams.get('code')){
          const lane=String(u.searchParams.get('action')||'');
          if(!lane || lane===action){
            const secret=u.searchParams.get('code');
            path=`/agen_playermoneyx.php?action=${action}&code=${encodeURIComponent(secret)}`;
            break;
          }
        }
      }catch{}

      // Some AGWL5 responses expose only #code or #secretcode, without the
      // submenu anchor. Both are rotating tokens generated by upstream.
      const $=cheerio.load(landing.html);
      const secret=String($('#secretcode').attr('value')||$('#code').attr('value')||'').trim();
      if(secret){ path=`/agen_playermoneyx.php?action=${action}&code=${encodeURIComponent(secret)}`; break; }
    }
    if(!path){
      const hint=last?`_HTTP_${last.status}`:'';
      throw new Error(`UPSTREAM_MONEY_CODE_NOT_FOUND${hint}`);
    }
    const r=await this.request(path);
    if(!r.ok) throw new Error(`UPSTREAM_HTTP_${r.status}`);
    const parsed=parsePendingMoney(r.html,type);
    // The transaction form often has no action attribute; in a browser it
    // posts back to the current rotating-code URL. Mirror that behavior.
    if(!parsed.actionPath) parsed.actionPath=path;
    return {http:r.status,type,...parsed};
  }
  async decidePendingMoney({type,key,decision}){
    const fresh=await this.pendingMoney(type);
    const row=fresh.rows.find(x=>x.key===key);
    if(!row) throw new Error('TRANSACTION_NOT_FOUND_OR_ALREADY_PROCESSED');
    const form={...fresh.common};
    form[row.checkboxName]='on';
    if(row.id2Name) form[row.id2Name]='';
    form.submitForm=decision==='accept'?'Accept':'Reject';
    const r=await this.request(fresh.actionPath,{method:'POST',form});
    const text=visibleText(r.html).slice(0,1200);
    if(!r.ok || /(error|gagal|failed|invalid)/i.test(text)) return {ok:false,http:r.status,message:text,row};
    return {ok:true,http:r.status,message:text,row};
  }

  async marketCatalog(){
    const probes=['/admin_angka13.php','/admin_prediksifullbb.php','/'];
    const map=new Map(); let last=null;
    for(const path of probes){
      try{
        const r=await this.request(path); last=r;
        for(const x of parseMarketCatalog(r.html)) if(!map.has(x.name)||!map.get(x.name).id) map.set(x.name,x);
      }catch(e){if(e.message==='UPSTREAM_SESSION_EXPIRED')throw e}
    }
    return {http:last?.status||200,markets:[...map.values()].sort((a,b)=>a.name.localeCompare(b.name))};
  }
  async markets(){ return this.marketCatalog(); }
  async resolveMarket(market){
    const cat=await this.marketCatalog();
    const found=cat.markets.find(x=>x.name.toUpperCase()===String(market).toUpperCase());
    if(!found?.id) throw new Error('MARKET_ID_NOT_FOUND');
    return found;
  }
  async marketState(market){
    const meta=await this.resolveMarket(market), id=meta.id;
    const probes=[`/admin_angka13.php?psr=${encodeURIComponent(id)}`,`/admin_prediksifullbb.php?psr=${encodeURIComponent(id)}`];
    let resultPage=null,predPage=null;
    for(const path of probes){
      const r=await this.request(path);
      if(path.includes('angka13')) resultPage={r,path}; else predPage={r,path};
    }
    const period=parseMarketPeriod(resultPage?.r.html||'')||parseMarketPeriod(predPage?.r.html||'');
    const history=parseMarketHistory(resultPage?.r.html||'');
    if(!period && !history.length) throw new Error('MARKET_PAGE_NOT_FOUND');
    return {http:resultPage?.r.status||predPage?.r.status||200,source:resultPage?.path||predPage?.path,market:meta.name,marketId:id,period,history};
  }
  async marketAction({action,market,period,n1,n2,n3}){
    const meta=await this.resolveMarket(market), id=meta.id;
    let r, target, form=null, method='POST';
    if(action==='prediction'){
      target=`/admin_prediksifullbb.php?psr=${encodeURIComponent(id)}`;
      form={periode:period,nomor:n1,nomor1:n2,nomor2:n3,pasaran:target,sar:id,submit:'Submit'};
      r=await this.request(target,{method,form});
    }else if(action==='result'){
      target=`/admin_angka13.php?psr=${encodeURIComponent(id)}`;
      form={periode:period,angka:n1,angka2:n2,angka3:n3,psr:id};
      r=await this.request(target,{method,form});
    }else{
      // AGWL5 calculation links use canonical market id in `pasar` and the
      // selected period/result. `tipe=A` is the upstream 4D calculation entry.
      const qs=new URLSearchParams({pasar:id,tipe:'A',periode:period,nomor:n1,nomor2:n2,nomor3:n3});
      target=`/admin_menkalahbb.php?${qs.toString()}`; method='GET';
      r=await this.request(target,{method});
    }
    const text=visibleText(r.html).slice(0,1800);
    if(!r.ok||/(error|gagal|invalid|failed)/i.test(text))throw new Error(`MARKET_UPSTREAM_REJECTED_HTTP_${r.status}`);
    if(action==='calculate' && !/(selesai dihitung|invoice pemenang|nomor keluar)/i.test(text)) throw new Error('MARKET_CALCULATE_NOT_CONFIRMED');
    const verify=await this.marketState(meta.name);
    if(action==='result'){
      const hit=verify.history.find(x=>String(x.period)===String(period) && x.n1===n1 && x.n2===n2 && x.n3===n3);
      if(!hit) throw new Error('MARKET_RESULT_NOT_VERIFIED');
    }
    return {ok:true,http:r.status,market:meta.name,marketId:id,source:target,message:text.slice(0,500),verify};
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
