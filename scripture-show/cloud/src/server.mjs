// F8 Cloud — accounts, churches, team, subscriptions (Stripe + Paystack MoMo) and licences for F8 computers.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { createDb, migrate } from './db.mjs';
import { hashPassword, newToken, normEmail, passwordProblem, sha256, userCode, validEmail, verifyPassword } from './auth.mjs';
import { loadSigningKey, signLicense } from './license.mjs';
import { createMailer } from './mail.mjs';
import { PLANS, PRICES, effectivePlan, isPaid, planOf } from './plans.mjs';
import { createStripe, handleStripeEvent, stripeCheckout, stripePortal } from './billing/stripe.mjs';
import { amountFor, applyPaystackPayment, paystackCheckout, paystackEnabled, validWebhook, verifyTransaction } from './billing/paystack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');

export async function createApp(cfg = config) {
  const db = createDb(cfg.databaseUrl);
  await migrate(db);
  const keys = loadSigningKey({ privatePem: cfg.licensePrivateKey, dataDir: cfg.dataDir });
  const mail = createMailer({ smtpUrl: cfg.smtpUrl, from: cfg.mailFrom });
  const stripe = createStripe(cfg.stripe);
  const origin = new URL(cfg.publicUrl).origin;

  // ------------------------------------------------------------ helpers
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const fail = (status, message) => { throw new HttpError(status, message); };
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  async function readRaw(req, limit = 200_000) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) fail(413, 'Too large'); chunks.push(c); }
    return Buffer.concat(chunks);
  }
  const readJson = async (req) => { const raw = await readRaw(req); try { return raw.length ? JSON.parse(raw) : {}; } catch { fail(400, 'Bad JSON'); } };
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  const sessionCookie = (token, maxAge) => `f8s=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.secureCookies ? '; Secure' : ''}`;
  const audit = (orgId, userId, action, detail = {}) => db.query('INSERT INTO audit_log (org_id, user_id, action, detail) VALUES ($1, $2, $3, $4)', [orgId, userId, action, detail]).catch(() => {});

  // Small in-memory rate limiter (per IP + bucket).
  const hits = new Map();
  function limit(req, bucket, max, windowMs) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const key = `${bucket}:${ip}`; const now = Date.now();
    const h = hits.get(key)?.filter((t) => now - t < windowMs) || [];
    if (h.length >= max) fail(429, 'Too many attempts — wait a few minutes and try again');
    h.push(now); hits.set(key, h);
  }
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k); }, 600_000).unref();

  async function startSession(res, userId, req) {
    const token = newToken();
    await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, now() + interval '30 days', $3)`, [sha256(token), userId, String(req.headers['user-agent'] || '').slice(0, 200)]);
    res.setHeader('set-cookie', sessionCookie(token, 30 * 86400));
  }
  async function currentUser(req) {
    const t = cookies(req).f8s; if (!t) return null;
    return db.one(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.deleted_at IS NULL`, [sha256(t)]);
  }
  const requireUser = async (req) => (await currentUser(req)) || fail(401, 'Please sign in');
  const isAdmin = (u) => u.is_admin || cfg.adminEmails.includes(normEmail(u.email));

  async function membership(orgId, user, roles = ['owner', 'admin', 'operator']) {
    if (!/^[0-9a-f-]{36}$/.test(String(orgId))) fail(404, 'Church not found');
    const m = await db.one('SELECT m.role, o.* FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.org_id = $1 AND m.user_id = $2', [orgId, user.id]);
    if (!m) fail(404, 'Church not found');
    if (!roles.includes(m.role)) fail(403, 'Only the church’s owner or admins can do that');
    return m;
  }
  const subOf = (orgId) => db.one('SELECT * FROM subscriptions WHERE org_id = $1', [orgId]);
  async function orgPlan(orgId) { const sub = await subOf(orgId); return { sub, plan: effectivePlan(sub) }; }

  async function sendVerify(user) {
    const t = newToken();
    await db.query(`INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES ($1, $2, 'verify', now() + interval '3 days')`, [sha256(t), user.id]);
    await mail.send(user.email, 'Confirm your email for F8', `Hello ${user.name || ''},\n\nConfirm your email address for F8 Scripture Presenter:\n${cfg.publicUrl}/verify?token=${t}\n\nIf you did not sign up, ignore this email.`);
  }

  function licenseFor(org, plan, sub, deviceId) {
    const p = planOf(plan); const now = Math.floor(Date.now() / 1000);
    let exp = now + cfg.licenseDays * 86400;
    // A prepaid plan's licence never outlives what was paid for (+ grace) by more than the offline window.
    return signLicense(keys.privateKey, {
      v: 1, org: org.id, orgName: org.name, plan, device: deviceId,
      limits: { outputs: p.outputs, devices: p.devices, seats: p.seats }, features: p.features, watermark: p.watermark,
      sub: sub ? { provider: sub.provider, status: sub.status, until: sub.current_period_end } : null,
      iat: now, exp,
    });
  }

  // ------------------------------------------------------------ routes
  const routes = [];
  const route = (method, pattern, fn, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn, opts });

  // Accounts
  route('POST', '/api/signup', async (req, res) => {
    limit(req, 'signup', 10, 3600_000);
    const b = await readJson(req);
    const email = normEmail(b.email); const name = String(b.name || '').trim().slice(0, 100); const church = String(b.church || '').trim().slice(0, 120);
    if (!validEmail(email)) fail(400, 'Enter a valid email address');
    const bad = passwordProblem(b.password); if (bad) fail(400, bad);
    if (!church) fail(400, 'Enter your church’s name');
    if (!b.acceptTerms) fail(400, 'Please accept the terms and privacy policy');
    if (await db.one('SELECT 1 FROM users WHERE lower(email) = $1 AND deleted_at IS NULL', [email])) fail(409, 'There is already an account with this email — sign in instead');
    const hash = await hashPassword(b.password);
    const user = await db.tx(async (t) => {
      const u = await t.one('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *', [email, name, hash]);
      const o = await t.one('INSERT INTO orgs (name, country) VALUES ($1, $2) RETURNING id', [church, String(b.country || '').slice(0, 2).toUpperCase()]);
      await t.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [o.id, u.id]);
      return u;
    });
    await startSession(res, user.id, req);
    sendVerify(user);
    send(res, 200, { ok: true });
  });

  route('POST', '/api/login', async (req, res) => {
    limit(req, 'login', 20, 900_000);
    const b = await readJson(req);
    const user = await db.one('SELECT * FROM users WHERE lower(email) = $1 AND deleted_at IS NULL', [normEmail(b.email)]);
    if (!user || !(await verifyPassword(b.password, user.password_hash))) fail(401, 'Email or password is not right');
    await startSession(res, user.id, req);
    send(res, 200, { ok: true });
  });

  route('POST', '/api/logout', async (req, res) => {
    const t = cookies(req).f8s; if (t) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(t)]);
    send(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
  });

  route('GET', '/api/me', async (req, res) => {
    const user = await currentUser(req);
    if (!user) return send(res, 200, { user: null });
    const orgs = await db.all(`SELECT o.id, o.name, o.country, m.role, s.plan AS sub_plan, s.status, s.provider, s.current_period_end, s.trial_end, s.cancel_at_period_end, s.interval
      FROM memberships m JOIN orgs o ON o.id = m.org_id LEFT JOIN subscriptions s ON s.org_id = o.id WHERE m.user_id = $1 ORDER BY o.created_at`, [user.id]);
    send(res, 200, {
      user: { id: user.id, email: user.email, name: user.name, verified: !!user.email_verified_at, admin: isAdmin(user) },
      orgs: orgs.map((o) => ({ id: o.id, name: o.name, country: o.country, role: o.role, plan: effectivePlan(o.sub_plan ? { plan: o.sub_plan, status: o.status, provider: o.provider, current_period_end: o.current_period_end } : null) })),
    });
  });

  route('POST', '/api/verify', async (req, res) => {
    const { token } = await readJson(req);
    const row = await db.one(`UPDATE email_tokens SET used_at = now() WHERE token_hash = $1 AND kind = 'verify' AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [sha256(token)]);
    if (!row) fail(400, 'This link has expired — sign in and send a new one');
    await db.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [row.user_id]);
    send(res, 200, { ok: true });
  });
  route('POST', '/api/verify/resend', async (req, res) => { limit(req, 'resend', 5, 3600_000); const u = await requireUser(req); if (!u.email_verified_at) await sendVerify(u); send(res, 200, { ok: true }); });

  route('POST', '/api/password/forgot', async (req, res) => {
    limit(req, 'forgot', 5, 3600_000);
    const { email } = await readJson(req);
    const u = await db.one('SELECT * FROM users WHERE lower(email) = $1 AND deleted_at IS NULL', [normEmail(email)]);
    if (u) {
      const t = newToken();
      await db.query(`INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES ($1, $2, 'reset', now() + interval '1 hour')`, [sha256(t), u.id]);
      await mail.send(u.email, 'Reset your F8 password', `Someone asked to reset the password for this F8 account.\n\nChoose a new password (link valid for 1 hour):\n${cfg.publicUrl}/reset?token=${t}\n\nIf it wasn't you, ignore this email.`);
    }
    send(res, 200, { ok: true }); // same answer either way, so emails can't be discovered
  });
  route('POST', '/api/password/reset', async (req, res) => {
    limit(req, 'reset', 10, 3600_000);
    const b = await readJson(req);
    const bad = passwordProblem(b.password); if (bad) fail(400, bad);
    const row = await db.one(`UPDATE email_tokens SET used_at = now() WHERE token_hash = $1 AND kind = 'reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [sha256(b.token)]);
    if (!row) fail(400, 'This link has expired — ask for a new one');
    await db.query('UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $2', [await hashPassword(b.password), row.user_id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]); // sign out everywhere
    await startSession(res, row.user_id, req);
    send(res, 200, { ok: true });
  });
  route('POST', '/api/me/password', async (req, res) => {
    const u = await requireUser(req); const b = await readJson(req);
    if (!(await verifyPassword(b.current, u.password_hash))) fail(400, 'Current password is not right');
    const bad = passwordProblem(b.password); if (bad) fail(400, bad);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(b.password), u.id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [u.id, sha256(cookies(req).f8s)]);
    send(res, 200, { ok: true });
  });

  // GDPR: a copy of your data, and deleting your account.
  route('GET', '/api/me/export', async (req, res) => {
    const u = await requireUser(req);
    const data = {
      user: { email: u.email, name: u.name, created_at: u.created_at, email_verified_at: u.email_verified_at },
      memberships: await db.all('SELECT o.name AS church, m.role, m.created_at FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1', [u.id]),
      devices_approved: await db.all('SELECT name, platform, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = $1', [u.id]),
      sessions: await db.all('SELECT created_at, expires_at, user_agent FROM sessions WHERE user_id = $1', [u.id]),
    };
    res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="f8-my-data.json"' });
    res.end(JSON.stringify(data, null, 2));
  });
  route('POST', '/api/me/delete', async (req, res) => {
    const u = await requireUser(req); const b = await readJson(req);
    if (!(await verifyPassword(b.password, u.password_hash))) fail(400, 'Password is not right');
    const owned = await db.all(`SELECT o.id, o.name, (SELECT count(*) FROM memberships x WHERE x.org_id = o.id AND x.role = 'owner') AS owners
      FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1 AND m.role = 'owner'`, [u.id]);
    for (const o of owned) {
      if (Number(o.owners) > 1) continue;
      const sub = await subOf(o.id);
      if (sub?.provider === 'stripe' && ['active', 'trialing', 'past_due'].includes(sub.status) && !sub.cancel_at_period_end) fail(400, `Cancel the subscription for “${o.name}” first (Billing → Manage)`);
    }
    await db.tx(async (t) => {
      for (const o of owned) if (Number(o.owners) <= 1) await t.query('DELETE FROM orgs WHERE id = $1', [o.id]); // church goes with its only owner
      await t.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
      await t.query(`UPDATE users SET deleted_at = now(), email = 'deleted-' || id || '@invalid', name = '', password_hash = '' WHERE id = $1`, [u.id]);
      await t.query('DELETE FROM memberships WHERE user_id = $1', [u.id]);
    });
    send(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
  });

  // Churches
  route('POST', '/api/orgs', async (req, res) => {
    const u = await requireUser(req); const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 120); if (!name) fail(400, 'Enter the church’s name');
    const o = await db.tx(async (t) => {
      const org = await t.one('INSERT INTO orgs (name, country) VALUES ($1, $2) RETURNING *', [name, String(b.country || '').slice(0, 2).toUpperCase()]);
      await t.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [org.id, u.id]);
      return org;
    });
    send(res, 200, { id: o.id });
  });

  route('GET', '/api/orgs/:id', async (req, res, { id }) => {
    const u = await requireUser(req); const m = await membership(id, u);
    const { sub, plan } = await orgPlan(id);
    const manager = ['owner', 'admin'].includes(m.role);
    send(res, 200, {
      org: { id: m.id, name: m.name, country: m.country, role: m.role, trialUsed: m.trial_used, hasStripe: !!m.stripe_customer_id },
      plan, limits: planOf(plan),
      subscription: sub && { provider: sub.provider, plan: sub.plan, interval: sub.interval, status: sub.status, trialEnd: sub.trial_end, periodEnd: sub.current_period_end, cancelAtPeriodEnd: sub.cancel_at_period_end },
      members: await db.all('SELECT u.id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY m.created_at', [id]),
      invites: manager ? await db.all('SELECT id, email, role, expires_at FROM invites WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at', [id]) : [],
      devices: await db.all('SELECT id, name, platform, created_at, last_seen_at FROM devices WHERE org_id = $1 AND revoked_at IS NULL ORDER BY created_at', [id]),
      payments: manager ? await db.all('SELECT provider, amount, currency, channel, plan, interval, paid_at FROM payments WHERE org_id = $1 ORDER BY paid_at DESC LIMIT 24', [id]) : [],
    });
  });

  route('POST', '/api/orgs/:id', async (req, res, { id }) => {
    const u = await requireUser(req); await membership(id, u, ['owner', 'admin']); const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 120); if (!name) fail(400, 'Enter the church’s name');
    await db.query('UPDATE orgs SET name = $1, country = $2 WHERE id = $3', [name, String(b.country || '').slice(0, 2).toUpperCase(), id]);
    if (stripe) { const o = await db.one('SELECT stripe_customer_id FROM orgs WHERE id = $1', [id]); if (o.stripe_customer_id) stripe.customers.update(o.stripe_customer_id, { name }).catch(() => {}); }
    send(res, 200, { ok: true });
  });

  // Team
  route('POST', '/api/orgs/:id/invites', async (req, res, { id }) => {
    limit(req, 'invite', 30, 3600_000);
    const u = await requireUser(req); const m = await membership(id, u, ['owner', 'admin']); const b = await readJson(req);
    const email = normEmail(b.email); if (!validEmail(email)) fail(400, 'Enter a valid email address');
    const role = b.role === 'admin' ? 'admin' : 'operator';
    const { plan } = await orgPlan(id);
    const used = await db.one(`SELECT (SELECT count(*) FROM memberships WHERE org_id = $1) + (SELECT count(*) FROM invites WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now()) AS n`, [id]);
    if (Number(used.n) >= planOf(plan).seats) fail(402, `The ${planOf(plan).name} plan allows ${planOf(plan).seats} team members — upgrade for more`);
    if (await db.one('SELECT 1 FROM memberships m JOIN users x ON x.id = m.user_id WHERE m.org_id = $1 AND lower(x.email) = $2', [id, email])) fail(409, 'Already on the team');
    const t = newToken();
    await db.query(`INSERT INTO invites (org_id, email, role, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')`, [id, email, role, sha256(t), u.id]);
    await mail.send(email, `Join ${m.name} on F8`, `${u.name || u.email} invited you to help run the screens at ${m.name} with F8 Scripture Presenter.\n\nAccept (link valid for 7 days):\n${cfg.publicUrl}/invite?token=${t}`);
    audit(id, u.id, 'invite', { email, role });
    send(res, 200, { ok: true });
  });
  route('POST', '/api/orgs/:id/invites/:inv/cancel', async (req, res, { id, inv }) => {
    const u = await requireUser(req); await membership(id, u, ['owner', 'admin']);
    await db.query('DELETE FROM invites WHERE id = $1 AND org_id = $2', [inv, id]); send(res, 200, { ok: true });
  });
  route('GET', '/api/invites/:token', async (req, res, { token }) => {
    const inv = await db.one(`SELECT i.email, i.role, o.name AS church FROM invites i JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`, [sha256(token)]);
    if (!inv) fail(404, 'This invitation has expired or was already used'); send(res, 200, inv);
  });
  route('POST', '/api/invites/accept', async (req, res) => {
    const u = await requireUser(req); const { token } = await readJson(req);
    const inv = await db.one(`SELECT * FROM invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`, [sha256(token)]);
    if (!inv) fail(404, 'This invitation has expired or was already used');
    if (normEmail(inv.email) !== normEmail(u.email)) fail(403, `This invitation is for ${inv.email} — sign in with that email`);
    await db.tx(async (t) => {
      await t.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [inv.org_id, u.id, inv.role]);
      await t.query('UPDATE invites SET accepted_at = now() WHERE id = $1', [inv.id]);
    });
    audit(inv.org_id, u.id, 'join', { role: inv.role });
    send(res, 200, { org: inv.org_id });
  });
  route('POST', '/api/orgs/:id/members/:uid', async (req, res, { id, uid }) => {
    const u = await requireUser(req); const me = await membership(id, u, ['owner', 'admin']); const b = await readJson(req);
    const target = await db.one('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [id, uid]); if (!target) fail(404, 'Not on the team');
    if (target.role === 'owner' && me.role !== 'owner') fail(403, 'Only an owner can change another owner');
    if (b.remove) {
      if (target.role === 'owner' && Number((await db.one(`SELECT count(*) AS n FROM memberships WHERE org_id = $1 AND role = 'owner'`, [id])).n) <= 1) fail(400, 'A church needs at least one owner');
      await db.query('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2', [id, uid]);
    } else {
      const role = ['owner', 'admin', 'operator'].includes(b.role) ? b.role : fail(400, 'Unknown role');
      if (role === 'owner' && me.role !== 'owner') fail(403, 'Only an owner can make someone an owner');
      if (target.role === 'owner' && role !== 'owner' && Number((await db.one(`SELECT count(*) AS n FROM memberships WHERE org_id = $1 AND role = 'owner'`, [id])).n) <= 1) fail(400, 'A church needs at least one owner');
      await db.query('UPDATE memberships SET role = $1 WHERE org_id = $2 AND user_id = $3', [role, id, uid]);
    }
    audit(id, u.id, b.remove ? 'member-remove' : 'member-role', { user: uid, role: b.role });
    send(res, 200, { ok: true });
  });
  route('POST', '/api/orgs/:id/devices/:did/revoke', async (req, res, { id, did }) => {
    const u = await requireUser(req); await membership(id, u, ['owner', 'admin']);
    await db.query('UPDATE devices SET revoked_at = now() WHERE id = $1 AND org_id = $2', [did, id]);
    audit(id, u.id, 'device-revoke', { device: did }); send(res, 200, { ok: true });
  });

  // Billing
  route('GET', '/api/plans', async (req, res) => send(res, 200, {
    plans: PLANS, prices: PRICES, trialDays: cfg.trialDays,
    providers: { stripe: !!stripe && Object.values(cfg.stripe.prices).some(Boolean), paystack: paystackEnabled(cfg.paystack) },
    paystackCurrency: cfg.paystack.currency,
  }));
  route('POST', '/api/orgs/:id/checkout', async (req, res, { id }) => {
    limit(req, 'checkout', 20, 3600_000);
    const u = await requireUser(req); const org = await membership(id, u, ['owner', 'admin']); const b = await readJson(req);
    if (!isPaid(b.plan) || !['month', 'year'].includes(b.interval)) fail(400, 'Choose a plan');
    const sub = await subOf(id);
    if (b.provider === 'paystack') {
      if (!paystackEnabled(cfg.paystack)) fail(400, 'Mobile Money is not set up');
      if (sub?.provider === 'stripe' && ['active', 'trialing', 'past_due'].includes(sub.status) && !sub.cancel_at_period_end) fail(409, 'This church pays by card — manage or cancel it under Billing first');
      return send(res, 200, { url: await paystackCheckout({ cfg: cfg.paystack, org, user: u, plan: b.plan, interval: b.interval, publicUrl: cfg.publicUrl, channel: b.channel }) });
    }
    if (!stripe) fail(400, 'Card payments are not set up');
    if (sub?.provider === 'stripe' && ['active', 'trialing', 'past_due'].includes(sub.status)) fail(409, 'Already subscribed — use Manage billing to change plan');
    send(res, 200, { url: await stripeCheckout({ stripe, cfg: cfg.stripe, db, org, user: u, plan: b.plan, interval: b.interval, publicUrl: cfg.publicUrl, trialDays: cfg.trialDays }) });
  });
  route('POST', '/api/orgs/:id/portal', async (req, res, { id }) => {
    const u = await requireUser(req); const org = await membership(id, u, ['owner', 'admin']);
    if (!stripe) fail(400, 'Card payments are not set up');
    send(res, 200, { url: await stripePortal({ stripe, org, publicUrl: cfg.publicUrl }) });
  });

  route('POST', '/api/webhooks/stripe', async (req, res) => {
    if (!stripe || !cfg.stripe.webhookSecret) fail(404, 'Not set up');
    const raw = await readRaw(req, 1_000_000);
    let event;
    try { event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], cfg.stripe.webhookSecret); }
    catch { fail(400, 'Bad signature'); }
    const r = await handleStripeEvent({ db, cfg: cfg.stripe, stripe, event });
    if (r?.orgId) audit(r.orgId, null, 'subscription', { provider: 'stripe', plan: r.plan, status: r.status });
    send(res, 200, { received: true });
  }, { noOrigin: true });

  route('POST', '/api/webhooks/paystack', async (req, res) => {
    if (!paystackEnabled(cfg.paystack)) fail(404, 'Not set up');
    const raw = await readRaw(req, 1_000_000);
    if (!validWebhook(cfg.paystack, raw, req.headers['x-paystack-signature'])) fail(400, 'Bad signature');
    const event = JSON.parse(raw);
    const fresh = await db.one(`INSERT INTO provider_events (provider, event_id, type) VALUES ('paystack', $1, $2) ON CONFLICT DO NOTHING RETURNING event_id`, [String(event.data?.id || event.data?.reference || newToken(8)), event.event]);
    if (fresh && event.event === 'charge.success') {
      // Don't trust the webhook body alone: ask Paystack about the transaction.
      await applyPaystackPayment({ db, cfg: cfg.paystack, tx: await verifyTransaction(cfg.paystack, event.data.reference) });
    }
    send(res, 200, { received: true });
  }, { noOrigin: true });

  // Paystack sends the payer back here after paying.
  route('GET', '/api/paystack/callback', async (req, res, _p, url) => {
    const ref = url.searchParams.get('reference') || url.searchParams.get('trxref') || '';
    let target = '/account?cancelled=1';
    try {
      const tx = await verifyTransaction(cfg.paystack, ref);
      const r = await applyPaystackPayment({ db, cfg: cfg.paystack, tx });
      if (tx.status === 'success') target = `/account?org=${encodeURIComponent(r.orgId || tx.metadata?.org_id || '')}&paid=1`;
    } catch (e) { console.warn('paystack callback', e.message); target = '/account?payfail=1'; }
    res.writeHead(302, { location: target }); res.end();
  });

  // Computers: device-code sign-in from the F8 app, then licence refreshes.
  route('POST', '/api/device/start', async (req, res) => {
    limit(req, 'device', 30, 3600_000);
    const b = await readJson(req);
    const deviceCode = newToken(); let code;
    for (let i = 0; i < 5; i++) {
      code = userCode();
      const ok = await db.one(`INSERT INTO device_codes (device_code_hash, user_code, name, platform, expires_at) VALUES ($1, $2, $3, $4, now() + interval '15 minutes') ON CONFLICT (user_code) DO NOTHING RETURNING user_code`,
        [sha256(deviceCode), code, String(b.name || 'F8 computer').slice(0, 80), String(b.platform || '').slice(0, 40)]);
      if (ok) break; code = null;
    }
    if (!code) fail(503, 'Try again');
    send(res, 200, { device_code: deviceCode, user_code: code, verify_url: `${cfg.publicUrl}/activate?code=${code}`, interval: 5, expires_in: 900 });
  }, { noOrigin: true });

  route('GET', '/api/device/lookup', async (req, res, _p, url) => {
    await requireUser(req);
    const d = await db.one(`SELECT name, platform, approved_org FROM device_codes WHERE user_code = $1 AND expires_at > now()`, [String(url.searchParams.get('code') || '').toUpperCase().trim()]);
    if (!d) fail(404, 'That code has expired — start sign-in again in F8'); send(res, 200, { name: d.name, platform: d.platform, approved: !!d.approved_org });
  });

  route('POST', '/api/device/approve', async (req, res) => {
    const u = await requireUser(req); const b = await readJson(req);
    await membership(b.org_id, u);
    const code = String(b.user_code || '').toUpperCase().trim();
    const dc = await db.one(`SELECT * FROM device_codes WHERE user_code = $1 AND expires_at > now() AND approved_org IS NULL`, [code]);
    if (!dc) fail(404, 'That code has expired — start sign-in again in F8');
    const { plan } = await orgPlan(b.org_id);
    const n = Number((await db.one('SELECT count(*) AS n FROM devices WHERE org_id = $1 AND revoked_at IS NULL', [b.org_id])).n);
    if (n >= planOf(plan).devices) fail(402, `The ${planOf(plan).name} plan allows ${planOf(plan).devices} computer${planOf(plan).devices === 1 ? '' : 's'} — remove one under Computers or upgrade`);
    await db.tx(async (t) => {
      const dev = await t.one('INSERT INTO devices (org_id, user_id, name, platform, refresh_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id', [b.org_id, u.id, dc.name, dc.platform, 'pending']);
      await t.query('UPDATE device_codes SET approved_org = $1, approved_by = $2, device_id = $3 WHERE device_code_hash = $4', [b.org_id, u.id, dev.id, dc.device_code_hash]);
    });
    audit(b.org_id, u.id, 'device-add', { name: dc.name });
    send(res, 200, { ok: true });
  });

  route('POST', '/api/device/poll', async (req, res) => {
    limit(req, 'poll', 400, 900_000);
    const { device_code: deviceCode } = await readJson(req);
    const dc = await db.one('SELECT * FROM device_codes WHERE device_code_hash = $1', [sha256(deviceCode)]);
    if (!dc || (new Date(dc.expires_at) < new Date() && !dc.device_id)) fail(410, 'Sign-in expired — start again');
    if (!dc.device_id) return send(res, 200, { pending: true });
    const refresh = newToken();
    await db.query('UPDATE devices SET refresh_hash = $1 WHERE id = $2', [sha256(refresh), dc.device_id]);
    await db.query('DELETE FROM device_codes WHERE device_code_hash = $1', [dc.device_code_hash]); // one use only
    const org = await db.one('SELECT * FROM orgs WHERE id = $1', [dc.approved_org]);
    const { sub, plan } = await orgPlan(org.id);
    send(res, 200, { device_id: dc.device_id, refresh_token: refresh, license: licenseFor(org, plan, sub, dc.device_id), public_key: keys.publicPem });
  }, { noOrigin: true });

  route('POST', '/api/license/refresh', async (req, res) => {
    limit(req, 'refresh', 120, 3600_000);
    const b = await readJson(req);
    if (!/^[0-9a-f-]{36}$/.test(String(b.device_id))) fail(401, 'Unknown computer');
    const dev = await db.one('SELECT * FROM devices WHERE id = $1', [b.device_id]);
    if (!dev || dev.revoked_at || dev.refresh_hash !== sha256(b.refresh_token)) fail(401, 'This computer was removed from the church account — sign in again');
    await db.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [dev.id]);
    const org = await db.one('SELECT * FROM orgs WHERE id = $1', [dev.org_id]);
    const { sub, plan } = await orgPlan(org.id);
    send(res, 200, { license: licenseFor(org, plan, sub, dev.id) });
  }, { noOrigin: true });

  route('GET', '/api/license/public-key', async (req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(keys.publicPem); });

  // Admin (you): numbers and a way to give a church a plan by hand (e.g. paid by bank transfer).
  const requireAdmin = async (req) => { const u = await requireUser(req); if (!isAdmin(u)) fail(403, 'Admins only'); return u; };
  route('GET', '/api/admin/stats', async (req, res) => {
    await requireAdmin(req);
    const subs = await db.all('SELECT * FROM subscriptions');
    const byPlan = { free: 0, pro: 0, ministry: 0 }; let mrrEur = 0, mrrGhs = 0;
    const orgCount = Number((await db.one('SELECT count(*) AS n FROM orgs')).n);
    for (const s of subs) {
      const p = effectivePlan(s); if (p === 'free') continue; byPlan[p]++;
      if (s.status === 'trialing') continue;
      if (s.provider === 'stripe') mrrEur += s.interval === 'year' ? PRICES.eur[p].year / 12 : PRICES.eur[p].month;
      if (s.provider === 'paystack') mrrGhs += s.interval === 'year' ? PRICES.ghs[p].year / 12 : PRICES.ghs[p].month;
    }
    byPlan.free = orgCount - byPlan.pro - byPlan.ministry;
    send(res, 200, {
      users: Number((await db.one('SELECT count(*) AS n FROM users WHERE deleted_at IS NULL')).n), churches: orgCount, byPlan,
      trialing: subs.filter((s) => s.status === 'trialing').length,
      devices: Number((await db.one('SELECT count(*) AS n FROM devices WHERE revoked_at IS NULL')).n),
      mrr: { eur: Math.round(mrrEur), ghs: Math.round(mrrGhs) },
      signups30: Number((await db.one(`SELECT count(*) AS n FROM users WHERE created_at > now() - interval '30 days' AND deleted_at IS NULL`)).n),
    });
  });
  route('GET', '/api/admin/orgs', async (req, res, _p, url) => {
    await requireAdmin(req);
    const q = `%${String(url.searchParams.get('q') || '').toLowerCase()}%`;
    const rows = await db.all(`SELECT o.id, o.name, o.country, o.created_at, s.plan, s.status, s.provider, s.current_period_end,
        (SELECT string_agg(u.email, ', ') FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND m.role = 'owner') AS owners,
        (SELECT count(*) FROM devices d WHERE d.org_id = o.id AND d.revoked_at IS NULL) AS devices
      FROM orgs o LEFT JOIN subscriptions s ON s.org_id = o.id
      WHERE lower(o.name) LIKE $1 OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = o.id AND lower(u.email) LIKE $1)
      ORDER BY o.created_at DESC LIMIT 100`, [q]);
    send(res, 200, { orgs: rows.map((r) => ({ ...r, effective: effectivePlan(r.plan ? r : null) })) });
  });
  route('POST', '/api/admin/orgs/:id/grant', async (req, res, { id }) => {
    const u = await requireAdmin(req); const b = await readJson(req);
    if (!['free', 'pro', 'ministry'].includes(b.plan)) fail(400, 'Unknown plan');
    if (b.plan === 'free') await db.query(`DELETE FROM subscriptions WHERE org_id = $1 AND provider = 'manual'`, [id]);
    else {
      const until = new Date(b.until); if (!(until > new Date())) fail(400, 'Choose an end date in the future');
      await db.query(`INSERT INTO subscriptions (org_id, provider, plan, interval, status, current_period_end, cancel_at_period_end) VALUES ($1, 'manual', $2, 'year', 'active', $3, true)
        ON CONFLICT (org_id) DO UPDATE SET provider = 'manual', provider_ref = NULL, plan = $2, interval = 'year', status = 'active', current_period_end = $3, cancel_at_period_end = true, updated_at = now()`, [id, b.plan, until]);
    }
    audit(id, u.id, 'admin-grant', { plan: b.plan, until: b.until });
    send(res, 200, { ok: true });
  });

  route('GET', '/healthz', async (req, res) => { await db.query('SELECT 1'); send(res, 200, { ok: true }); });

  // ------------------------------------------------------------ static pages
  const PAGES = { '/': 'index.html', '/pricing': 'index.html', '/login': 'login.html', '/signup': 'signup.html', '/account': 'account.html',
    '/activate': 'activate.html', '/reset': 'reset.html', '/verify': 'verify.html', '/invite': 'invite.html', '/admin': 'admin.html', '/privacy': 'privacy.html', '/terms': 'terms.html' };
  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  async function serveStatic(res, p) {
    const file = PAGES[p] ? path.join(PUBLIC, PAGES[p]) : path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC)) return false;
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; form-action 'self'" });
      res.end(data); return true;
    } catch { return false; }
  }

  // ------------------------------------------------------------ server
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname); if (!m) continue;
        // Browser POSTs must come from our own site (blocks cross-site form tricks).
        if (req.method === 'POST' && !r.opts.noOrigin && req.headers.origin && req.headers.origin !== origin) fail(403, 'Bad origin');
        const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
        return await r.fn(req, res, params, url);
      }
      if (req.method === 'GET' && await serveStatic(res, url.pathname)) return;
      send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (!(e instanceof HttpError) && !e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong — try again' });
    }
  });

  // ------------------------------------------------------------ background jobs
  async function housekeeping() {
    try {
      await db.query('DELETE FROM sessions WHERE expires_at < now()');
      await db.query(`DELETE FROM device_codes WHERE expires_at < now() - interval '1 day'`);
      await db.query(`DELETE FROM email_tokens WHERE expires_at < now() - interval '7 days'`);
      // Prepaid plans that have run out (after 3 days' grace).
      await db.query(`UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE provider IN ('paystack', 'manual') AND status = 'active' AND current_period_end < now() - interval '3 days'`);
      // MoMo renewal reminders 5 days before the end.
      const due = await db.all(`SELECT s.*, o.name FROM subscriptions s JOIN orgs o ON o.id = s.org_id
        WHERE s.provider = 'paystack' AND s.status = 'active' AND s.reminded_at IS NULL AND s.current_period_end < now() + interval '5 days'`);
      for (const s of due) {
        const owners = await db.all(`SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.role IN ('owner', 'admin')`, [s.org_id]);
        const price = amountFor(cfg.paystack, s.plan, s.interval) / 100;
        for (const o of owners) await mail.send(o.email, `Renew F8 ${planOf(s.plan).name} for ${s.name}`, `Hello ${o.name || ''},\n\nThe ${planOf(s.plan).name} plan for ${s.name} ends on ${new Date(s.current_period_end).toDateString()}.\nRenew with Mobile Money (${cfg.paystack.currency} ${price.toLocaleString()} per ${s.interval}) so the screens keep every feature:\n${cfg.publicUrl}/account?org=${s.org_id}\n\nThank you!`);
        await db.query('UPDATE subscriptions SET reminded_at = now() WHERE org_id = $1', [s.org_id]);
      }
    } catch (e) { console.error('housekeeping', e.message); }
  }
  const timer = setInterval(housekeeping, 3600_000); timer.unref();

  return { server, db, mail, keys, housekeeping, close: async () => { clearInterval(timer); server.close(); await db.close(); } };
}

// Run directly: `node src/server.mjs`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  app.server.listen(config.port, () => {
    console.log(`F8 Cloud on ${config.publicUrl} (port ${config.port})`);
    if (!config.stripe.secretKey) console.log('  Card payments: off (set STRIPE_SECRET_KEY and the STRIPE_PRICE_* ids)');
    if (!config.paystack.secretKey) console.log('  Mobile Money: off (set PAYSTACK_SECRET_KEY)');
    if (!config.smtpUrl) console.log('  Email: printing to the console (set SMTP_URL to send real email)');
  });
}
