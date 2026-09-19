function bool(v, fallback=false){
  if(v == null || v === '') return fallback;
  return ['1','true','yes','on'].includes(String(v).toLowerCase());
}
function int(v, fallback){
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
export function loadConfig(){
  const production = process.env.NODE_ENV === 'production';
  const required = ['DATABASE_URL','SESSION_SECRET','SESSION_VAULT_KEY','MASTER_USERNAME','MASTER_PASSWORD','MASTER_TOTP_SECRET'];
  const missing = required.filter(k => !process.env[k]);
  if(missing.length) throw new Error(`CONFIG_ERROR: env wajib belum diisi: ${missing.join(', ')}`);
  if(process.env.SESSION_SECRET.length < 32) throw new Error('CONFIG_ERROR: SESSION_SECRET minimal 32 karakter');
  if(process.env.SESSION_VAULT_KEY.length < 32) throw new Error('CONFIG_ERROR: SESSION_VAULT_KEY minimal 32 karakter');
  return {
    port: int(process.env.PORT,8080),
    production,
    appName: process.env.APP_NAME || 'AGENT MASTER 8008',
    databaseUrl: process.env.DATABASE_URL,
    databaseSsl: bool(process.env.DATABASE_SSL, production),
    sessionSecret: process.env.SESSION_SECRET,
    vaultKey: process.env.SESSION_VAULT_KEY,
    masterUsername: process.env.MASTER_USERNAME,
    masterPassword: process.env.MASTER_PASSWORD,
    masterTotpSecret: process.env.MASTER_TOTP_SECRET,
    upstreamBaseUrl: (process.env.UPSTREAM_BASE_URL || 'https://agwl5.suksesbogil.com').replace(/\/$/,''),
    upstreamTimeoutMs: int(process.env.UPSTREAM_TIMEOUT_MS,20000),
    verifyRetries: Math.max(1,int(process.env.UPSTREAM_VERIFY_RETRIES,3)),
    verifyDelayMs: Math.max(250,int(process.env.UPSTREAM_VERIFY_DELAY_MS,1200)),
    idleMinutes: Math.max(10,int(process.env.SESSION_IDLE_MINUTES,60)),
    loginRateLimit: Math.max(3,int(process.env.LOGIN_RATE_LIMIT,10))
  };
}
