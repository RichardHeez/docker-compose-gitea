-- F8 Cloud schema. Money is never stored here: the payment providers hold card/MoMo details.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX users_email ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,                 -- sha256 of the cookie value
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE email_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('verify', 'reset')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- A church (organisation). Subscriptions and devices belong to the church, not to a person.
CREATE TABLE orgs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  country            text NOT NULL DEFAULT '',
  stripe_customer_id text UNIQUE,
  trial_used         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'operator')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One current subscription per church. provider 'stripe' renews by itself; 'paystack' (MoMo) is prepaid
-- and runs until current_period_end.
CREATE TABLE subscriptions (
  org_id               uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  provider             text NOT NULL CHECK (provider IN ('stripe', 'paystack', 'manual')),
  provider_ref         text,                    -- Stripe subscription id / last Paystack reference
  plan                 text NOT NULL,
  interval             text NOT NULL CHECK (interval IN ('month', 'year')),
  status               text NOT NULL,           -- trialing, active, past_due, canceled, expired, incomplete
  trial_end            timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  reminded_at          timestamptz,             -- MoMo renewal reminder sent
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_ref ON subscriptions (provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- Every payment we were told about (receipts history; Paystack references for idempotency).
CREATE TABLE payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  reference   text NOT NULL,
  amount      bigint NOT NULL,                  -- minor units (cents / pesewas)
  currency    text NOT NULL,
  channel     text NOT NULL DEFAULT '',         -- card, mobile_money, sepa_debit, bancontact…
  plan        text NOT NULL,
  interval    text NOT NULL,
  paid_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, reference)
);

-- Computers running F8 for a church. A device signs in once (device code) and then refreshes its licence.
CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  name          text NOT NULL DEFAULT 'F8 computer',
  platform      text NOT NULL DEFAULT '',
  refresh_hash  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);
CREATE INDEX devices_org ON devices (org_id) WHERE revoked_at IS NULL;

-- Device sign-in in progress: the app shows a short code, someone approves it on the website.
CREATE TABLE device_codes (
  device_code_hash text PRIMARY KEY,
  user_code        text NOT NULL UNIQUE,
  name             text NOT NULL DEFAULT '',
  platform         text NOT NULL DEFAULT '',
  expires_at       timestamptz NOT NULL,
  approved_org     uuid REFERENCES orgs(id) ON DELETE CASCADE,
  approved_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id        uuid REFERENCES devices(id) ON DELETE CASCADE,
  refresh_token    text                          -- handed to the app once, then cleared
);

CREATE TABLE provider_events (
  provider    text NOT NULL,
  event_id    text NOT NULL,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE audit_log (
  id      bigserial PRIMARY KEY,
  org_id  uuid REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action  text NOT NULL,
  detail  jsonb NOT NULL DEFAULT '{}',
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org ON audit_log (org_id, at DESC);
