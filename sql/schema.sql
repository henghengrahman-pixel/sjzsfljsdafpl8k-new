-- Dokumentasi skema. Aplikasi menjalankan migrasi otomatis dari src/db.js.
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

CREATE TABLE IF NOT EXISTS upstream_sessions (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  encrypted_cookie text,
  status text NOT NULL DEFAULT 'empty',
  last_checked_at timestamptz,
  last_error text,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
