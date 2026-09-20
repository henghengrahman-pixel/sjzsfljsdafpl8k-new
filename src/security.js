import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';

export const newCsrf = () => crypto.randomBytes(24).toString('base64url');
export const newIdempotency = () => crypto.randomUUID();
export const hashPassword = p => bcrypt.hash(p,12);
export const verifyPassword = (p,h) => bcrypt.compare(p,h);
export function verifyTotp(token,secret){
  try { return authenticator.check(String(token||''), String(secret||'')); }
  catch { return false; }
}
export function generateTotpSecret(){ return authenticator.generateSecret(); }
export function otpauthUrl(username,issuer,secret){ return authenticator.keyuri(username,issuer,secret); }

function keyFromSecret(secret){ return crypto.createHash('sha256').update(secret).digest(); }
export function encryptText(plain, secret){
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const enc = Buffer.concat([cipher.update(String(plain),'utf8'),cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv,tag,enc]).toString('base64');
}
export function decryptText(blob, secret){
  const raw = Buffer.from(blob,'base64');
  if(raw.length < 29) throw new Error('VAULT_DATA_INVALID');
  const iv=raw.subarray(0,12), tag=raw.subarray(12,28), enc=raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc),decipher.final()]).toString('utf8');
}
export function requireAuth(req,res,next){
  if(!req.session?.user) return res.status(401).json({ok:false,error:'AUTH_REQUIRED'});
  next();
}
export function requireMaster(req,res,next){
  if(req.session?.user?.role !== 'master') return res.status(403).json({ok:false,error:'MASTER_REQUIRED'});
  next();
}
export function requireCsrf(req,res,next){
  const token=req.get('x-csrf-token');
  if(!token || token !== req.session?.csrf) return res.status(403).json({ok:false,error:'CSRF_INVALID'});
  next();
}
export function clientIp(req){
  return String(req.ip || req.socket?.remoteAddress || '').slice(0,120);
}
