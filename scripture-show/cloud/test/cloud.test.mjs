// End-to-end tests on a real PostgreSQL database, with small fake Stripe and Paystack servers.
// Needs a Postgres the tests can create databases on: TEST_DATABASE_URL (default postgres://f8:f8@localhost:5432/postgres).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import Stripe from 'stripe';
import { createApp } from '../src/server.mjs';
import { verifyLicense } from '../src/license.mjs';
import { effectivePlan } from '../src/plans.mjs';

const ADMIN = postgresUrl(process.env.TEST_DATABASE_URL || 'postgres://f8:f8@localhost:5432/postgres');
function postgresUrl(u) { return u; }
const DB_NAME = `f8test_${process.pid}`;
let pgOk = true;
try { const c = new pg.Client(ADMIN); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${DB_NAME}`); await c.query(`CREATE DATABASE ${DB_NAME}`); await c.end(); }
catch (e) { pgOk = false; console.warn('Skipping cloud tests: no Postgres —', e.message); }

// ------------------------------------------------------------ fake Stripe
const stripeCalls = []; const stripeSubs = new Map();
const fakeStripe = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const params = Object.fromEntries(new URLSearchParams(body));
  stripeCalls.push({ method: req.method, url: req.url, params });
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/v1/customers' && req.method === 'POST') return json({ id: `cus_${stripeCalls.length}`, object: 'customer' });
  if (req.url.startsWith('/v1/customers/')) return json({ id: req.url.split('/')[3], object: 'customer' });
  if (req.url === '/v1/checkout/sessions') return json({ id: 'cs_1', object: 'checkout.session', url: 'https://checkout.stripe.test/pay/cs_1' });
  if (req.url === '/v1/billing_portal/sessions') return json({ id: 'bps_1', object: 'billing_portal.session', url: 'https://billing.stripe.test/p/1' });
  const m = req.url.match(/^\/v1\/subscriptions\/(\w+)/); if (m) return json(stripeSubs.get(m[1]));
  res.writeHead(404); res.end('{}');
});
// ------------------------------------------------------------ fake Paystack
const paystackTx = new Map(); const paystackInits = [];
const fakePaystack = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers.authorization !== 'Bearer sk_test_paystack') return json({ status: false, message: 'Invalid key' }, 401);
  if (req.url === '/transaction/initialize') { const b = JSON.parse(body); paystackInits.push(b); return json({ status: true, data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, reference: b.reference } }); }
  const m = req.url.match(/^\/transaction\/verify\/(.+)$/);
  if (m) { const tx = paystackTx.get(decodeURIComponent(m[1])); return tx ? json({ status: true, data: tx }) : json({ status: false, message: 'Transaction reference not found' }, 400); }
  json({ status: false }, 404);
});

const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv.address().port)));

test('F8 Cloud', { skip: !pgOk && 'no Postgres' }, async (t) => {
  const sPort = await listen(fakeStripe); const pPort = await listen(fakePaystack);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8cloud-'));
  const cfg = {
    port: 0, publicUrl: 'http://localhost:9', databaseUrl: ADMIN.replace(/\/[^/]*$/, `/${DB_NAME}`), adminEmails: ['boss@f8.test'],
    trialDays: 14, licenseDays: 14, licensePrivateKey: '', dataDir, smtpUrl: '', mailFrom: 'F8 <x@f8.test>', secureCookies: false,
    stripe: { secretKey: 'sk_test_x', webhookSecret: 'whsec_test', automaticTax: false, host: `http://127.0.0.1:${sPort}`,
      prices: { 'pro:month': 'price_pro_m', 'pro:year': 'price_pro_y', 'ministry:month': 'price_min_m', 'ministry:year': 'price_min_y' } },
    paystack: { secretKey: 'sk_test_paystack', currency: 'GHS', base: `http://127.0.0.1:${pPort}` },
  };
  const app = await createApp(cfg);
  const port = await listen(app.server);
  const B = `http://127.0.0.1:${port}`;

  // tiny browser: keeps the session cookie
  const browser = () => {
    let cookie = '';
    const call = async (method, p, body, headers = {}) => {
      const r = await fetch(B + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', origin: 'http://localhost:9', ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
      return { status: r.status, body: json, location: r.headers.get('location') };
    };
    return { get: (p) => call('GET', p), post: (p, b = {}, h) => call('POST', p, b, h) };
  };
  const lastMail = (to) => [...app.mail.outbox].reverse().find((m) => m.to === to);
  const tokenIn = (text, key) => new URL(text.match(/https?:\/\/\S+/)[0]).searchParams.get(key);

  const alice = browser(); let orgId;

  await t.test('sign up, verify email, log in', async () => {
    let r = await alice.post('/api/signup', { email: 'Alice@Church.test', password: 'short', church: 'Grace Chapel', acceptTerms: true });
    assert.equal(r.status, 400);
    r = await alice.post('/api/signup', { email: 'Alice@Church.test', password: 'correct horse', name: 'Alice', church: 'Grace Chapel', country: 'be', acceptTerms: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await alice.get('/api/me');
    assert.equal(r.body.user.email, 'alice@church.test'); assert.equal(r.body.user.verified, false);
    assert.equal(r.body.orgs[0].name, 'Grace Chapel'); assert.equal(r.body.orgs[0].role, 'owner'); assert.equal(r.body.orgs[0].plan, 'free');
    orgId = r.body.orgs[0].id;
    r = await alice.post('/api/verify', { token: tokenIn(lastMail('alice@church.test').text, 'token') });
    assert.equal(r.status, 200);
    assert.equal((await alice.get('/api/me')).body.user.verified, true);
    assert.equal((await browser().post('/api/signup', { email: 'alice@church.test', password: 'whatever1', church: 'X', acceptTerms: true })).status, 409);
    const other = browser();
    assert.equal((await other.post('/api/login', { email: 'alice@church.test', password: 'wrong pass' })).status, 401);
    assert.equal((await other.post('/api/login', { email: 'ALICE@church.test', password: 'correct horse' })).status, 200);
  });

  await t.test('cross-site posts are refused', async () => {
    const r = await alice.post('/api/orgs', { name: 'Evil' }, { origin: 'https://evil.test' });
    assert.equal(r.status, 403);
  });

  await t.test('password reset signs out other sessions', async () => {
    const r1 = await browser().post('/api/password/forgot', { email: 'nobody@x.test' }); assert.equal(r1.status, 200);
    await browser().post('/api/password/forgot', { email: 'alice@church.test' });
    const t1 = tokenIn(lastMail('alice@church.test').text, 'token');
    const fresh = browser();
    assert.equal((await fresh.post('/api/password/reset', { token: t1, password: 'new password 1' })).status, 200);
    assert.equal((await alice.get('/api/me')).body.user, null); // old session gone
    assert.equal((await fresh.post('/api/password/reset', { token: t1, password: 'another one 2' })).status, 400); // single use
    assert.equal((await alice.post('/api/login', { email: 'alice@church.test', password: 'new password 1' })).status, 200);
  });

  const bob = browser();
  await t.test('team invites respect the plan’s seats', async () => {
    let r = await alice.post(`/api/orgs/${orgId}/invites`, { email: 'bob@church.test', role: 'operator' }); assert.equal(r.status, 200);
    const tok = tokenIn(lastMail('bob@church.test').text, 'token');
    r = await alice.post(`/api/orgs/${orgId}/invites`, { email: 'carol@church.test' }); assert.equal(r.status, 402); // Free = 2 seats
    await bob.post('/api/signup', { email: 'bob@church.test', password: 'bobs password', church: 'Bob Home', acceptTerms: true });
    assert.equal((await bob.get(`/api/invites/${tok}`)).body.church, 'Grace Chapel');
    assert.equal((await bob.post('/api/invites/accept', { token: tok })).status, 200);
    r = await bob.get(`/api/orgs/${orgId}`);
    assert.equal(r.body.org.role, 'operator'); assert.equal(r.body.members.length, 2); assert.deepEqual(r.body.payments, []);
    assert.equal((await bob.post(`/api/orgs/${orgId}/invites`, { email: 'x@y.test' })).status, 403); // operators can't invite
    assert.equal((await browser().get(`/api/orgs/${orgId}`)).status, 401);
  });

  let device; let pub;
  await t.test('a computer signs in with a code and gets a signed licence', async () => {
    const app1 = browser();
    let r = await app1.post('/api/device/start', { name: 'Media booth PC', platform: 'win32' });
    const { device_code: dc, user_code: uc } = r.body; assert.match(uc, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.deepEqual((await app1.post('/api/device/poll', { device_code: dc })).body, { pending: true });
    assert.equal((await bob.get(`/api/device/lookup?code=${uc.toLowerCase()}`)).body.name, 'Media booth PC');
    assert.equal((await bob.post('/api/device/approve', { user_code: uc, org_id: orgId })).status, 200);
    r = await app1.post('/api/device/poll', { device_code: dc });
    pub = r.body.public_key; device = r.body;
    const lic = verifyLicense(r.body.license, pub);
    assert.equal(lic.plan, 'free'); assert.equal(lic.orgName, 'Grace Chapel'); assert.equal(lic.limits.outputs, 2); assert.equal(lic.watermark, true);
    assert.ok(!lic.features.includes('ndi'));
    assert.equal((await app1.post('/api/device/poll', { device_code: dc })).status, 410); // used up
    assert.equal(verifyLicense(r.body.license.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), pub), null); // tampered
    assert.equal(verifyLicense(r.body.license, pub, Date.now() + 15 * 864e5), null); // expired offline
    // Free allows 1 computer
    const app2 = browser(); const s2 = (await app2.post('/api/device/start', { name: 'Laptop' })).body;
    assert.equal((await alice.post('/api/device/approve', { user_code: s2.user_code, org_id: orgId })).status, 402);
  });

  const signStripe = (event) => {
    const payload = JSON.stringify(event);
    return { payload, header: Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' }) };
  };
  const postStripe = async (event, header) => {
    const { payload, header: h } = signStripe(event);
    return fetch(`${B}/api/webhooks/stripe`, { method: 'POST', headers: { 'stripe-signature': header || h, 'content-type': 'application/json' }, body: payload });
  };
  const subObj = (id, status, price, extra = {}) => ({ id, object: 'subscription', status, customer: 'cus_1', metadata: { org_id: orgId }, cancel_at_period_end: false,
    trial_end: status === 'trialing' ? Math.floor(Date.now() / 1000) + 14 * 86400 : null,
    items: { data: [{ price: { id: price }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] }, ...extra });

  await t.test('card subscription through Stripe (trial, webhooks, licence upgrade, cancel)', async () => {
    let r = await bob.post(`/api/orgs/${orgId}/checkout`, { plan: 'pro', interval: 'month' }); assert.equal(r.status, 403); // operator
    r = await alice.post(`/api/orgs/${orgId}/checkout`, { plan: 'pro', interval: 'month' });
    assert.equal(r.body.url, 'https://checkout.stripe.test/pay/cs_1');
    const cs = stripeCalls.find((c) => c.url === '/v1/checkout/sessions').params;
    assert.equal(cs['line_items[0][price]'], 'price_pro_m'); assert.equal(cs['subscription_data[trial_period_days]'], '14'); assert.equal(cs.mode, 'subscription');
    assert.equal(cs['tax_id_collection[enabled]'], 'true');
    // bad signature
    assert.equal((await postStripe({ id: 'evt_x', type: 'customer.subscription.created', data: { object: {} } }, 't=1,v1=bad')).status, 400);
    stripeSubs.set('sub_1', subObj('sub_1', 'trialing', 'price_pro_m'));
    assert.equal((await postStripe({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1' } } })).status, 200);
    r = await alice.get(`/api/orgs/${orgId}`);
    assert.equal(r.body.plan, 'pro'); assert.equal(r.body.subscription.status, 'trialing'); assert.equal(r.body.org.trialUsed, true);
    // licence refresh now says Pro
    r = await browser().post('/api/license/refresh', { device_id: device.device_id, refresh_token: device.refresh_token });
    const lic = verifyLicense(r.body.license, pub); assert.equal(lic.plan, 'pro'); assert.ok(lic.features.includes('ndi')); assert.equal(lic.watermark, false);
    // same event twice is ignored; a later one updates
    assert.equal((await postStripe({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1' } } })).status, 200);
    await postStripe({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: subObj('sub_1', 'active', 'price_min_y') } });
    r = await alice.get(`/api/orgs/${orgId}`); assert.equal(r.body.plan, 'ministry'); assert.equal(r.body.subscription.interval, 'year');
    assert.equal((await alice.post(`/api/orgs/${orgId}/checkout`, { plan: 'pro', interval: 'month' })).status, 409); // already subscribed
    assert.equal((await alice.post(`/api/orgs/${orgId}/portal`)).body.url, 'https://billing.stripe.test/p/1');
    // MoMo is refused while a card subscription is running
    assert.equal((await alice.post(`/api/orgs/${orgId}/checkout`, { plan: 'pro', interval: 'month', provider: 'paystack' })).status, 409);
    await postStripe({ id: 'evt_3', type: 'customer.subscription.deleted', data: { object: subObj('sub_1', 'canceled', 'price_min_y') } });
    assert.equal((await alice.get(`/api/orgs/${orgId}`)).body.plan, 'free');
    // trial only once
    await alice.post(`/api/orgs/${orgId}/checkout`, { plan: 'pro', interval: 'year' });
    const cs2 = stripeCalls.filter((c) => c.url === '/v1/checkout/sessions').at(-1).params;
    assert.equal(cs2['subscription_data[trial_period_days]'], undefined);
  });

  await t.test('Mobile Money through Paystack (prepaid, verified, no double counting)', async () => {
    let r = await alice.post(`/api/orgs/${orgId}/checkout`, { plan: 'pro', interval: 'month', provider: 'paystack' });
    assert.match(r.body.url, /^https:\/\/checkout\.paystack\.test\/f8_/);
    const init = paystackInits.at(-1);
    assert.equal(init.amount, 15000); assert.equal(init.currency, 'GHS'); assert.deepEqual(init.channels, ['mobile_money', 'card']);
    assert.equal(init.metadata.org_id, orgId);
    const tx = { status: 'success', reference: init.reference, amount: 15000, currency: 'GHS', channel: 'mobile_money', metadata: init.metadata, id: 9001 };
    paystackTx.set(init.reference, tx);
    r = await browser().get(`/api/paystack/callback?reference=${init.reference}`);
    assert.equal(r.status, 302); assert.match(r.location, /paid=1/);
    let o = (await alice.get(`/api/orgs/${orgId}`)).body;
    assert.equal(o.plan, 'pro'); assert.equal(o.subscription.provider, 'paystack');
    const end1 = new Date(o.subscription.periodEnd);
    assert.ok(Math.abs(end1 - Date.now() - 30.5 * 864e5) < 2 * 864e5);
    // the same payment again (callback + webhook) adds nothing
    await browser().get(`/api/paystack/callback?reference=${init.reference}`);
    const raw = JSON.stringify({ event: 'charge.success', data: { id: 9001, reference: init.reference } });
    const sig = createHmac('sha512', 'sk_test_paystack').update(raw).digest('hex');
    assert.equal((await fetch(`${B}/api/webhooks/paystack`, { method: 'POST', headers: { 'x-paystack-signature': 'nope' }, body: raw })).status, 400);
    assert.equal((await fetch(`${B}/api/webhooks/paystack`, { method: 'POST', headers: { 'x-paystack-signature': sig }, body: raw })).status, 200);
    o = (await alice.get(`/api/orgs/${orgId}`)).body;
    assert.equal(new Date(o.subscription.periodEnd).getTime(), end1.getTime());
    assert.equal(o.payments.length, 1); assert.equal(o.payments[0].channel, 'mobile_money');
    // renewing early adds a year on top
    await alice.post(`/api/orgs/${orgId}/checkout`, { plan: 'pro', interval: 'year', provider: 'paystack' });
    const init2 = paystackInits.at(-1);
    paystackTx.set(init2.reference, { status: 'success', reference: init2.reference, amount: 150000, currency: 'GHS', channel: 'mobile_money', metadata: init2.metadata, id: 9002 });
    await browser().get(`/api/paystack/callback?reference=${init2.reference}`);
    o = (await alice.get(`/api/orgs/${orgId}`)).body;
    assert.ok(new Date(o.subscription.periodEnd) - end1 > 360 * 864e5);
    // an underpaid transaction does nothing
    await alice.post(`/api/orgs/${orgId}/checkout`, { plan: 'ministry', interval: 'year', provider: 'paystack' });
    const init3 = paystackInits.at(-1);
    paystackTx.set(init3.reference, { status: 'success', reference: init3.reference, amount: 100, currency: 'GHS', channel: 'mobile_money', metadata: init3.metadata, id: 9003 });
    await browser().get(`/api/paystack/callback?reference=${init3.reference}`);
    assert.equal((await alice.get(`/api/orgs/${orgId}`)).body.plan, 'pro');
  });

  await t.test('prepaid plans remind before the end and expire after', async () => {
    await app.db.query(`UPDATE subscriptions SET current_period_end = now() + interval '2 days', reminded_at = NULL WHERE org_id = $1`, [orgId]);
    await app.housekeeping();
    assert.match(lastMail('alice@church.test').subject, /Renew F8 Pro/);
    const before = app.mail.outbox.length; await app.housekeeping(); assert.equal(app.mail.outbox.length, before); // once
    await app.db.query(`UPDATE subscriptions SET current_period_end = now() - interval '4 days' WHERE org_id = $1`, [orgId]);
    await app.housekeeping();
    assert.equal((await alice.get(`/api/orgs/${orgId}`)).body.plan, 'free');
    assert.equal(effectivePlan({ provider: 'paystack', plan: 'pro', status: 'active', current_period_end: new Date(Date.now() - 2 * 864e5) }), 'pro'); // grace
  });

  await t.test('removed computers lose their licence', async () => {
    assert.equal((await alice.post(`/api/orgs/${orgId}/devices/${device.device_id}/revoke`)).status, 200);
    const r = await browser().post('/api/license/refresh', { device_id: device.device_id, refresh_token: device.refresh_token });
    assert.equal(r.status, 401);
  });

  await t.test('admin numbers and manual plans', async () => {
    assert.equal((await alice.get('/api/admin/stats')).status, 403);
    const boss = browser();
    await boss.post('/api/signup', { email: 'boss@f8.test', password: 'boss password', church: 'HQ', acceptTerms: true });
    let r = await boss.get('/api/admin/stats');
    assert.equal(r.status, 200); assert.equal(r.body.users, 3); assert.equal(r.body.churches, 3);
    r = await boss.get('/api/admin/orgs?q=grace'); assert.equal(r.body.orgs[0].name, 'Grace Chapel');
    assert.equal((await boss.post(`/api/admin/orgs/${orgId}/grant`, { plan: 'ministry', until: new Date(Date.now() + 90 * 864e5).toISOString() })).status, 200);
    assert.equal((await alice.get(`/api/orgs/${orgId}`)).body.plan, 'ministry');
  });

  await t.test('export my data and delete my account', async () => {
    const r = await bob.get('/api/me/export');
    assert.equal(r.body.user.email, 'bob@church.test'); assert.equal(r.body.memberships.length, 2);
    assert.equal((await bob.post('/api/me/delete', { password: 'wrong' })).status, 400);
    assert.equal((await bob.post('/api/me/delete', { password: 'bobs password' })).status, 200);
    assert.equal((await alice.get(`/api/orgs/${orgId}`)).body.members.length, 1);
    assert.equal((await browser().post('/api/login', { email: 'bob@church.test', password: 'bobs password' })).status, 401);
  });

  await app.close(); fakeStripe.close(); fakePaystack.close();
  const c = new pg.Client(ADMIN); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`); await c.end();
});
