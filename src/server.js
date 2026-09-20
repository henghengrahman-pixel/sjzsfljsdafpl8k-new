import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import QRCode from 'qrcode';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createDb, migrate, bootstrapMaster } from './db.js';
import { newCsrf, newIdempotency, verifyPassword, verifyTotp, generateTotpSecret, otpauthUrl, hashPassword, requireAuth, requireMaster, requireCsrf } from './security.js';
import { audit } from './audit.js';
import { UpstreamClient } from './upstream.js';
import { parseDateRange, getSummary, getDetail, workbookForReport } from './report.js';

const cfg=loadConfig();
const db=createDb(cfg);
await migrate(db); await bootstrapMaster(db,cfg);
const upstream=new UpstreamClient(db,cfg);
const app=express(); app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'","data:"],connectSrc:["'self'"]}}}));
app.use(express.json({limit:'300kb'}));
app.use(express.urlencoded({extended:false,limit:'300kb'}));
const PgStore=connectPgSimple(session);
app.use(session({
  store:new PgStore({pool:db,tableName:'web_sessions',createTableIfMissing:true}),
  name:'ag8008.sid',secret:cfg.sessionSecret,resave:false,saveUninitialized:false,rolling:true,
  cookie:{httpOnly:true,secure:cfg.production,sameSite:'lax',maxAge:cfg.idleMinutes*60*1000}
}));
app.use(express.static(path.join(process.cwd(),'public')));
const limiter=rateLimit({windowMs:10*60*1000,limit:cfg.loginRateLimit,standardHeaders:'draft-8',legacyHeaders:false});

app.get('/api/meta',(req,res)=>res.json({ok:true,appName:cfg.appName}));
app.post('/api/auth/login',limiter,async(req,res)=>{
  const p=z.object({username:z.string().trim().min(1).max(80),password:z.string().min(1).max(256),otp:z.string().regex(/^\d{6}$/).optional().or(z.literal(''))}).safeParse(req.body);
  if(!p.success) return res.status(400).json({ok:false,error:'INPUT_INVALID'});
  const q=await db.query('SELECT id,username,alias,password_hash,totp_secret,totp_enrolled_at,role,active FROM app_users WHERE username=$1',[p.data.username]);
  const u=q.rows[0];
  const passwordOk=!!u && u.active && await verifyPassword(p.data.password,u.password_hash);
  if(!passwordOk){await new Promise(r=>setTimeout(r,300));return res.status(401).json({ok:false,error:'LOGIN_INVALID'});}

  // First login / reset enrollment: always issue a fresh per-user secret and show QR
  // after username + password are valid. No global MASTER_TOTP_SECRET is required.
  if(!u.totp_enrolled_at && !p.data.otp){
    const secret=generateTotpSecret();
    await db.query('UPDATE app_users SET totp_secret=$2,updated_at=NOW() WHERE id=$1',[u.id,secret]);
    u.totp_secret=secret;
    const uri=otpauthUrl(u.username,cfg.appName,secret);
    const qr=await QRCode.toDataURL(uri,{errorCorrectionLevel:'M',margin:2,width:280});
    return res.json({ok:true,setupRequired:true,username:u.username,totpSecret:secret,qr});
  }
  if(u.totp_enrolled_at && !p.data.otp) return res.json({ok:true,otpRequired:true});
  if(!p.data.otp || !verifyTotp(p.data.otp,u.totp_secret)){
    await new Promise(r=>setTimeout(r,300));
    return res.status(401).json({ok:false,error:'OTP_INVALID'});
  }
  if(!u.totp_enrolled_at) await db.query('UPDATE app_users SET totp_enrolled_at=NOW(),updated_at=NOW() WHERE id=$1',[u.id]);

  req.session.regenerate(err=>{
    if(err) return res.status(500).json({ok:false,error:'SESSION_ERROR'});
    req.session.user={id:u.id,username:u.username,alias:u.alias,role:u.role}; req.session.csrf=newCsrf();
    req.session.save(async()=>{await audit(db,req,u.totp_enrolled_at?'LOGIN':'LOGIN_2FA_ENROLLED');res.json({ok:true,user:req.session.user,csrf:req.session.csrf});});
  });
});
app.get('/api/auth/me',requireAuth,(req,res)=>res.json({ok:true,user:req.session.user,csrf:req.session.csrf}));
app.post('/api/auth/logout',requireAuth,requireCsrf,async(req,res)=>{await audit(db,req,'LOGOUT');req.session.destroy(()=>res.json({ok:true}));});

app.use('/api',(req,res,next)=>{
  if(req.path==='/meta' || req.path.startsWith('/auth/')) return next();
  return requireAuth(req,res,()=>requireCsrf(req,res,next));
});

app.get('/api/session/status',async(req,res)=>{
  const q=await db.query(`SELECT status,last_checked_at,last_error,updated_at,(encrypted_cookie IS NOT NULL) AS configured FROM upstream_sessions WHERE id=1`);
  res.json({ok:true,session:q.rows[0]});
});
app.post('/api/session/set',requireMaster,async(req,res)=>{
  const p=z.object({cookie:z.string().trim().min(3).max(20000)}).safeParse(req.body); if(!p.success)return res.status(400).json({ok:false,error:'COOKIE_INVALID'});
  await upstream.saveCookie(p.data.cookie,req.session.user.id,'untested',null); await audit(db,req,'SESSION_UPDATE','AGWL5');
  const result=await upstream.testSession(); res.status(result.connected?200:422).json({ok:result.connected,...result});
});
app.post('/api/session/test',requireMaster,async(req,res)=>{const result=await upstream.testSession();await audit(db,req,'SESSION_TEST','AGWL5',result);res.status(result.connected?200:422).json(result)});
app.delete('/api/session',requireMaster,async(req,res)=>{await db.query(`UPDATE upstream_sessions SET encrypted_cookie=NULL,status='empty',last_checked_at=NOW(),last_error=NULL,updated_by=$1,updated_at=NOW() WHERE id=1`,[req.session.user.id]);await audit(db,req,'SESSION_DELETE','AGWL5');res.json({ok:true})});

const uid=z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_.-]+$/);
const playerSearchValue=z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9_. -]+$/);
app.post('/api/player/search',async(req,res)=>{
  const p=z.object({type:z.enum(['userid','rekening']).default('userid'),value:playerSearchValue}).safeParse(req.body);
  if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});
  const r=await upstream.searchPlayer(p.data);
  await audit(db,req,'PLAYER_SEARCH',p.data.value,{type:p.data.type,source:'agentplayerlist.php'});
  res.json({ok:true,...r});
});
app.post('/api/player/profile',async(req,res)=>{const p=z.object({userid:uid}).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const r=await upstream.profile(p.data.userid);await audit(db,req,'PLAYER_PROFILE',p.data.userid);res.json({ok:true,http:r.http,profile:r.profile})});
app.post('/api/player/history',async(req,res)=>{const p=z.object({userid:uid}).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const r=await upstream.history(p.data.userid);await audit(db,req,'PLAYER_HISTORY',p.data.userid);res.json({ok:true,...r})});
app.post('/api/player/transaction-history',async(req,res)=>{const p=z.object({userid:uid}).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const r=await upstream.transactionHistory(p.data.userid);await audit(db,req,'PLAYER_TRANSACTION_HISTORY',p.data.userid,{source:r.source,count:r.rows.length});res.json({ok:true,...r})});
app.post('/api/player/transaction-detail',async(req,res)=>{const p=z.object({path:z.string().trim().min(1).max(500)}).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const r=await upstream.transactionDetail(p.data.path);await audit(db,req,'PLAYER_TRANSACTION_DETAIL',r.path);res.json({ok:true,...r})});

app.get('/api/money/pending',async(req,res)=>{const p=z.object({type:z.enum(['deposit','withdraw'])}).safeParse(req.query);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const r=await upstream.pendingMoney(p.data.type);res.set('Cache-Control','no-store');res.json({ok:true,http:r.http,type:r.type,rows:r.rows,banks:r.banks,refreshedAt:new Date().toISOString()})});
app.post('/api/money/decision',async(req,res)=>{const p=z.object({type:z.enum(['deposit','withdraw']),key:z.string().trim().min(3).max(100),decision:z.enum(['accept','reject'])}).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const r=await upstream.decidePendingMoney(p.data);await audit(db,req,`PENDING_${p.data.type.toUpperCase()}_${p.data.decision.toUpperCase()}`,r.row?.userid||p.data.key,{amount:r.row?.amount||'',ok:r.ok});res.status(r.ok?200:502).json(r)});
app.post('/api/money/decision-bulk',async(req,res)=>{const p=z.object({type:z.enum(['deposit','withdraw']),keys:z.array(z.string().trim().min(3).max(100)).min(1).max(100).refine(a=>new Set(a).size===a.length),decision:z.enum(['accept','reject'])}).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const r=await upstream.decidePendingMoneyBulk(p.data);for(const row of r.rows||[])await audit(db,req,`PENDING_${p.data.type.toUpperCase()}_${p.data.decision.toUpperCase()}_BULK`,row.userid||row.key,{amount:row.amount||'',ok:r.ok,batchSize:(r.rows||[]).length});res.status(r.ok?200:502).json(r)});

const marketName=z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_. -]+$/);
app.get('/api/markets',async(req,res)=>{const r=await upstream.markets();res.set('Cache-Control','no-store');res.json({ok:true,...r})});
app.get('/api/markets/state',async(req,res)=>{const p=z.object({market:marketName}).safeParse(req.query);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const r=await upstream.marketState(p.data.market);res.set('Cache-Control','no-store');res.json({ok:true,...r})});
app.post('/api/markets/action',requireMaster,async(req,res)=>{
  const p=z.object({action:z.enum(['prediction','result','calculate']),market:marketName,period:z.string().trim().regex(/^\d{0,8}$/).default(''),n1:z.string().trim().regex(/^\d{0,8}$/).default(''),n2:z.string().trim().regex(/^\d{0,8}$/).default(''),n3:z.string().trim().regex(/^\d{0,8}$/).default('')}).safeParse(req.body);
  if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});
  const before=await upstream.marketState(p.data.market);
  if(p.data.action==='result'&&!before.marketOpen)return res.status(409).json({ok:false,error:'MARKET_CLOSED'});
  let payload={...p.data};
  if(p.data.action==='calculate'){
    if(!before.marketOpen)return res.status(409).json({ok:false,error:'MARKET_CLOSED'});
    if(!before.calculateReady||!before.pendingCalculation)return res.status(409).json({ok:false,error:'MARKET_NOT_READY_TO_CALCULATE'});
    const x=before.pendingCalculation;
    payload={...p.data,period:String(x.period),n1:String(x.n1||''),n2:String(x.n2||''),n3:String(x.n3||'')};
  }else{
    if(!payload.period||!payload.n1)return res.status(400).json({ok:false,error:'INPUT_INVALID'});
    if(before.period&&before.period!==payload.period)return res.status(409).json({ok:false,error:'MARKET_PERIOD_CHANGED',currentPeriod:before.period});
  }
  const r=await upstream.marketAction(payload);
  await audit(db,req,`MARKET_${payload.action.toUpperCase()}`,payload.market,{period:payload.period,n1:payload.n1,n2:payload.n2,n3:payload.n3,ok:r.ok});
  res.json({ok:true,...r});
});

app.post('/api/player/profile/update',async(req,res)=>{const p=z.object({userid:uid,username:z.string().max(100),marketing:z.string().max(100),bank:z.string().min(1).max(60),acc:z.string().min(1).max(120),rek:z.string().min(1).max(60),color:z.string().max(40).default('white')}).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID',details:p.error.issues});const r=await upstream.updateProfile(p.data.userid,p.data);await audit(db,req,'PLAYER_PROFILE_UPDATE',p.data.userid,{ok:r.ok,bank:p.data.bank});res.status(r.ok?200:502).json(r)});
app.post('/api/player/reset-password',async(req,res)=>{const p=z.object({userid:uid,password:z.string().min(6).max(128),confirm:z.string().min(6).max(128)}).refine(x=>x.password===x.confirm).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const r=await upstream.resetPassword(p.data.userid,p.data.password);await audit(db,req,'RESET_PASSWORD',p.data.userid,{ok:r.ok});res.status(r.ok?200:502).json({ok:r.ok,http:r.http,message:r.message})});

app.post('/api/manual-transaction',async(req,res)=>{
  const p=z.object({userid:uid,type:z.enum(['depo','wd']),amount:z.coerce.number().int().positive().max(1000000000),info:z.string().max(120).optional(),idempotencyKey:z.string().min(8).max(120).optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID',details:p.error.issues});
  const k=p.data.idempotencyKey || newIdempotency(); const action=p.data.type==='depo'?'Deposit':'Withdraw'; const u=req.session.user;
  let row;
  try{
    const q=await db.query(`INSERT INTO transactions(idempotency_key,user_id,agent_username,agent_alias,player_userid,action,amount,status) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING') RETURNING *`,[k,u.id,u.username,u.alias,p.data.userid,action,p.data.amount]); row=q.rows[0];
  }catch(e){if(e.code==='23505'){const q=await db.query('SELECT * FROM transactions WHERE idempotency_key=$1',[k]);return res.status(409).json({ok:false,error:'DUPLICATE_REQUEST',transaction:q.rows[0]});}throw e;}
  try{
    const sent=await upstream.manualTransaction({userid:p.data.userid,type:p.data.type,amount:p.data.amount,info:p.data.info||''});
    let verify={verified:false}; if(!sent.rejected) verify=await upstream.verifyTransaction(p.data.userid,p.data.type,p.data.amount);
    const status=sent.rejected?'REJECT':'ACCEPT';
    const q=await db.query(`UPDATE transactions SET status=$2,verified=$3,upstream_http=$4,upstream_message=$5,completed_at=NOW() WHERE id=$1 RETURNING *`,[row.id,status,verify.verified,sent.http,sent.message.slice(0,1500)]);
    await audit(db,req,`MANUAL_${action.toUpperCase()}`,p.data.userid,{amount:p.data.amount,status,verified:verify.verified});
    return res.status(status==='ACCEPT'?200:502).json({ok:status==='ACCEPT',transaction:q.rows[0],verified:verify.verified,verification:verify.match||null});
  }catch(e){
    const q=await db.query(`UPDATE transactions SET status='REJECT',upstream_message=$2,completed_at=NOW() WHERE id=$1 RETURNING *`,[row.id,String(e.message).slice(0,1500)]);
    await audit(db,req,`MANUAL_${action.toUpperCase()}`,p.data.userid,{amount:p.data.amount,status:'REJECT',error:e.message});
    return res.status(502).json({ok:false,error:e.message,transaction:q.rows[0]});
  }
});

app.get('/api/agents',requireMaster,async(req,res)=>{const q=await db.query(`SELECT id,username,alias,role,active,created_at,updated_at FROM app_users ORDER BY role DESC,username ASC`);res.json({ok:true,agents:q.rows})});
app.post('/api/agents',requireMaster,async(req,res)=>{
  const p=z.object({username:z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_.-]+$/),alias:z.string().trim().min(1).max(60),password:z.string().min(8).max(128)}).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});
  const secret=generateTotpSecret(), hash=await hashPassword(p.data.password);
  try{const q=await db.query(`INSERT INTO app_users(username,alias,password_hash,totp_secret,role,active) VALUES($1,$2,$3,$4,'agent',true) RETURNING id,username,alias,role,active,created_at`,[p.data.username,p.data.alias,hash,secret]);await audit(db,req,'AGENT_CREATE',p.data.username);res.json({ok:true,agent:q.rows[0],setupOnFirstLogin:true});}catch(e){if(e.code==='23505')return res.status(409).json({ok:false,error:'USERNAME_EXISTS'});throw e;}
});
app.patch('/api/agents/:id',requireMaster,async(req,res)=>{const p=z.object({alias:z.string().trim().min(1).max(60).optional(),active:z.boolean().optional(),password:z.string().min(8).max(128).optional(),resetTotp:z.boolean().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({ok:false,error:'INPUT_INVALID'});const cur=(await db.query(`SELECT id,username,role FROM app_users WHERE id=$1`,[req.params.id])).rows[0];if(!cur)return res.status(404).json({ok:false,error:'NOT_FOUND'});if(cur.role==='master' && p.data.active===false)return res.status(400).json({ok:false,error:'MASTER_CANNOT_DISABLE'});let hash=null,secret=null,qr=null;if(p.data.password)hash=await hashPassword(p.data.password);if(p.data.resetTotp){secret=generateTotpSecret();}const q=await db.query(`UPDATE app_users SET alias=COALESCE($2,alias),active=COALESCE($3,active),password_hash=COALESCE($4,password_hash),totp_secret=COALESCE($5,totp_secret),totp_enrolled_at=CASE WHEN $5 IS NOT NULL THEN NULL ELSE totp_enrolled_at END,updated_at=NOW() WHERE id=$1 RETURNING id,username,alias,role,active,updated_at`,[req.params.id,p.data.alias??null,p.data.active??null,hash,secret]);await audit(db,req,'AGENT_UPDATE',cur.username,{active:p.data.active,resetTotp:!!p.data.resetTotp,passwordChanged:!!p.data.password});res.json({ok:true,agent:q.rows[0],setupOnNextLogin:!!p.data.resetTotp})});

app.get('/api/report/summary',async(req,res)=>{try{const range=parseDateRange(req.query.from,req.query.to);res.json({ok:true,rows:await getSummary(db,range)})}catch{return res.status(400).json({ok:false,error:'DATE_INVALID'})}});
app.get('/api/report/detail',async(req,res)=>{try{const range=parseDateRange(req.query.from,req.query.to);res.json({ok:true,rows:await getDetail(db,{...range,operator:req.query.operator||null})})}catch{return res.status(400).json({ok:false,error:'DATE_INVALID'})}});
app.get('/api/report/export.xlsx',async(req,res)=>{try{const range=parseDateRange(req.query.from,req.query.to);const mode=req.query.mode==='summary'?'summary':'detail';const operator=req.query.operator||null;const wb=await workbookForReport(db,{...range,mode,operator});const name=`REPORT_${mode.toUpperCase()}_${operator?operator.replace(/[^A-Za-z0-9_-]/g,'_'):'ALL'}_${range.from}_${range.to}.xlsx`;res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="${name}"`);await wb.xlsx.write(res);res.end();}catch(e){console.error(e);res.status(400).json({ok:false,error:'EXPORT_FAILED'})}});
app.get('/api/audit',requireMaster,async(req,res)=>{const q=await db.query(`SELECT id,username,alias,action,target,details,ip,created_at FROM audit_logs ORDER BY id DESC LIMIT 300`);res.json({ok:true,logs:q.rows})});

app.get('/health',async(req,res)=>{try{await db.query('SELECT 1');res.json({ok:true,app:cfg.appName})}catch(e){res.status(503).json({ok:false,error:'DB_UNAVAILABLE'})}});
app.use((req,res,next)=>{if(req.method==='GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(process.cwd(),'public','index.html')); next();});
app.use((err,req,res,next)=>{console.error(err);const msg=err?.message||'INTERNAL_ERROR';res.status(msg.includes('UPSTREAM_SESSION')?502:500).json({ok:false,error:msg})});
app.listen(cfg.port,()=>console.log(`${cfg.appName} listening on :${cfg.port}`));
