import { clientIp } from './security.js';
export async function audit(db,req,action,target=null,details={}){
  const u=req.session?.user || {};
  await db.query(`INSERT INTO audit_logs(user_id,username,alias,action,target,details,ip) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [u.id||null,u.username||null,u.alias||null,action,target,details,clientIp(req)]);
}
