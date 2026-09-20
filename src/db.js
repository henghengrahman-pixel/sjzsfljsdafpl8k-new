import pg from 'pg';
import bcrypt from 'bcryptjs';
import { generateTotpSecret } from './security.js';

export function createDb(cfg){
  return new pg.Pool({
    connectionString: cfg.databaseUrl,
    ssl: cfg.databaseSsl ? { rejectUnauthorized:false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}

export async function migrate(db){
  await db.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL UNIQUE,
      alias text NOT NULL,
      password_hash text NOT NULL,
      totp_secret text NOT NULL,
      role text NOT NULL CHECK (role IN ('master','agent')),
      active boolean NOT NULL DEFAULT true,
      totp_enrolled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE app_users ADD COLUMN IF NOT EXISTS totp_enrolled_at timestamptz;
    CREATE TABLE IF NOT EXISTS upstream_sessions (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
      encrypted_cookie text,
      status text NOT NULL DEFAULT 'empty',
      last_checked_at timestamptz,
      last_error text,
      updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO upstream_sessions(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS transactions (
      id bigserial PRIMARY KEY,
      request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      idempotency_key text NOT NULL UNIQUE,
      user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
      agent_username text NOT NULL,
      agent_alias text NOT NULL,
      player_userid text NOT NULL,
      action text NOT NULL CHECK(action IN ('Deposit','Withdraw')),
      amount bigint NOT NULL CHECK(amount > 0),
      from_bank text,
      to_bank text,
      status text NOT NULL CHECK(status IN ('PENDING','ACCEPT','REJECT')),
      verified boolean NOT NULL DEFAULT false,
      upstream_http integer,
      upstream_message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_agent ON transactions(agent_username, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_player ON transactions(player_userid, created_at DESC);
    CREATE TABLE IF NOT EXISTS audit_logs (
      id bigserial PRIMARY KEY,
      user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
      username text,
      alias text,
      action text NOT NULL,
      target text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      ip text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
    CREATE TABLE IF NOT EXISTS app_meta (
      key text PRIMARY KEY,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO app_meta(key,value) VALUES('active_login_link','https://omtogelcity.com/clearcache') ON CONFLICT(key) DO NOTHING;
  `);

  // One-time repair for installations that previously skipped/broke first-login enrollment.
  // It deliberately forces every existing account through a clean QR enrollment once.
  const marker='2fa_first_login_v3';
  const done=await db.query('SELECT 1 FROM app_meta WHERE key=$1',[marker]);
  if(!done.rows[0]){
    await db.query('BEGIN');
    try{
      await db.query('UPDATE app_users SET totp_enrolled_at=NULL, updated_at=NOW()');
      await db.query(`INSERT INTO app_meta(key,value) VALUES($1,'applied') ON CONFLICT(key) DO NOTHING`,[marker]);
      await db.query('COMMIT');
      console.log('2FA_FIRST_LOGIN_REPAIR_APPLIED');
    }catch(e){
      await db.query('ROLLBACK');
      throw e;
    }
  }
}

export async function bootstrapMaster(db,cfg){
  const hash = await bcrypt.hash(cfg.masterPassword,12);
  const found = await db.query(
    'SELECT id,username FROM app_users WHERE role=$1 ORDER BY created_at ASC LIMIT 1',
    ['master']
  );

  if(!found.rows[0]){
    await db.query(
      `INSERT INTO app_users(username,alias,password_hash,totp_secret,role,active)
       VALUES($1,$2,$3,$4,'master',true)`,
      [cfg.masterUsername,'MASTER',hash,generateTotpSecret()]
    );
    console.log(`MASTER_CREATED username=${cfg.masterUsername}`);
    return;
  }

  const master=found.rows[0];
  const conflict=await db.query(
    'SELECT id,role FROM app_users WHERE username=$1 AND id<>$2 LIMIT 1',
    [cfg.masterUsername,master.id]
  );
  if(conflict.rows[0]){
    throw new Error(`CONFIG_ERROR: MASTER_USERNAME '${cfg.masterUsername}' sudah dipakai akun lain`);
  }

  // Railway MASTER_USERNAME / MASTER_PASSWORD are the source of truth for the
  // master credential. Keep the existing per-user TOTP enrollment untouched.
  await db.query(
    `UPDATE app_users
        SET username=$2,password_hash=$3,active=true,updated_at=NOW()
      WHERE id=$1`,
    [master.id,cfg.masterUsername,hash]
  );
  console.log(`MASTER_SYNCED username=${cfg.masterUsername}`);
}
