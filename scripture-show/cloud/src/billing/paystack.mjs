// Paystack: Mobile Money (MTN, Telecel, AirtelTigo) and cards, in cedis. MoMo can't be charged again
// automatically, so these plans are prepaid: each payment adds a month or a year, and we email a
// reminder before it runs out.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PRICES } from '../plans.mjs';

export const paystackEnabled = (cfg) => !!cfg.secretKey;

async function call(cfg, method, path, body) {
  const r = await fetch(`${cfg.base}${path}`, {
    method, headers: { authorization: `Bearer ${cfg.secretKey}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) throw Object.assign(new Error(j.message || `Paystack error ${r.status}`), { status: 502 });
  return j.data;
}

export const amountFor = (cfg, plan, interval) => PRICES[cfg.currency.toLowerCase()]?.[plan]?.[interval] || 0;

export async function paystackCheckout({ cfg, org, user, plan, interval, publicUrl, channel }) {
  const amount = amountFor(cfg, plan, interval);
  if (!amount) throw Object.assign(new Error(`No ${cfg.currency} price set for this plan`), { status: 400 });
  const reference = `f8_${randomUUID().replace(/-/g, '')}`;
  const data = await call(cfg, 'POST', '/transaction/initialize', {
    email: user.email, amount, currency: cfg.currency, reference,
    channels: channel === 'card' ? ['card'] : ['mobile_money', 'card'],
    callback_url: `${publicUrl}/api/paystack/callback`,
    metadata: { org_id: org.id, plan, interval, custom_fields: [{ display_name: 'Church', variable_name: 'church', value: org.name }] },
  });
  return data.authorization_url;
}

export const verifyTransaction = (cfg, reference) => call(cfg, 'GET', `/transaction/verify/${encodeURIComponent(reference)}`);

export function validWebhook(cfg, raw, signature) {
  const want = createHmac('sha512', cfg.secretKey).update(raw).digest('hex');
  const got = String(signature || '');
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

const addPeriod = (from, interval) => { const d = new Date(from); if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1); return d; };

// Record a successful payment and extend the church's plan. Safe to call twice for the same reference.
export async function applyPaystackPayment({ db, cfg, tx }) {
  if (tx?.status !== 'success') return { ignored: 'not successful' };
  const { org_id: orgId, plan, interval } = tx.metadata || {};
  if (!orgId || !['pro', 'ministry'].includes(plan) || !['month', 'year'].includes(interval)) return { ignored: 'not an F8 payment' };
  const expected = amountFor(cfg, plan, interval);
  if (String(tx.currency).toUpperCase() !== cfg.currency.toUpperCase() || Number(tx.amount) < expected) return { ignored: 'amount does not match the plan' };
  return db.tx(async (t) => {
    const fresh = await t.one(`INSERT INTO payments (org_id, provider, reference, amount, currency, channel, plan, interval)
      VALUES ($1, 'paystack', $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, tx.reference, tx.amount, tx.currency, tx.channel || '', plan, interval]);
    if (!fresh) return { duplicate: true };
    const cur = await t.one('SELECT * FROM subscriptions WHERE org_id = $1 FOR UPDATE', [orgId]);
    // Paying again before the end adds time on top; otherwise it starts today.
    const base = cur && cur.provider !== 'stripe' && cur.status === 'active' && cur.plan === plan && new Date(cur.current_period_end) > new Date() ? cur.current_period_end : new Date();
    const end = addPeriod(base, interval);
    await t.query(`INSERT INTO subscriptions (org_id, provider, provider_ref, plan, interval, status, current_period_end, cancel_at_period_end, reminded_at, updated_at)
        VALUES ($1, 'paystack', $2, $3, $4, 'active', $5, true, NULL, now())
      ON CONFLICT (org_id) DO UPDATE SET provider = 'paystack', provider_ref = EXCLUDED.provider_ref, plan = EXCLUDED.plan, interval = EXCLUDED.interval,
        status = 'active', current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = true, reminded_at = NULL, updated_at = now()`,
    [orgId, tx.reference, plan, interval, end]);
    await t.query(`INSERT INTO audit_log (org_id, action, detail) VALUES ($1, 'payment', $2)`, [orgId, { provider: 'paystack', reference: tx.reference, plan, interval, until: end }]);
    return { orgId, plan, interval, until: end };
  });
}
