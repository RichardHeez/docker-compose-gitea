// Stripe: card, Bancontact and SEPA Direct Debit subscriptions in euros that renew automatically.
// Turn the payment methods on in the Stripe dashboard (Settings → Payment methods); Checkout then
// offers the ones that suit the customer's country. Optional EU VAT via Stripe Tax.
import Stripe from 'stripe';

export function createStripe(cfg) {
  if (!cfg.secretKey) return null;
  const opts = { maxNetworkRetries: 2 };
  if (cfg.host) { const u = new URL(cfg.host); Object.assign(opts, { host: u.hostname, port: Number(u.port), protocol: u.protocol.replace(':', '') }); }
  return new Stripe(cfg.secretKey, opts);
}

// Card prices come in euros (keys "pro:month") and US dollars ("pro:month:usd").
export const priceFor = (cfg, plan, interval, currency = 'eur') => cfg.prices[currency === 'usd' ? `${plan}:${interval}:usd` : `${plan}:${interval}`] || '';
export const stripeCurrencies = (cfg) => ['eur', 'usd'].filter((c) => ['pro', 'ministry'].some((p) => ['month', 'year'].some((i) => priceFor(cfg, p, i, c))));
export function planForPrice(cfg, priceId) {
  const hit = Object.entries(cfg.prices).find(([, id]) => id && id === priceId);
  if (!hit) return null;
  const [plan, interval, currency = 'eur'] = hit[0].split(':');
  return { plan, interval, currency };
}

export async function stripeCheckout({ stripe, cfg, db, org, user, plan, interval, currency = 'eur', publicUrl, trialDays }) {
  const price = priceFor(cfg, plan, interval, currency);
  if (!price) throw Object.assign(new Error(`This plan is not set up for card payments in ${currency.toUpperCase()} yet`), { status: 400 });
  let customer = org.stripe_customer_id;
  if (!customer) {
    const c = await stripe.customers.create({ email: user.email, name: org.name, metadata: { org_id: org.id } });
    customer = c.id;
    await db.query('UPDATE orgs SET stripe_customer_id = $1 WHERE id = $2', [customer, org.id]);
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: org.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { org_id: org.id }, ...(org.trial_used || !trialDays ? {} : { trial_period_days: trialDays }) },
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    tax_id_collection: { enabled: true }, // churches/companies can add a VAT number
    ...(cfg.automaticTax ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto', name: 'auto' } } : {}),
    success_url: `${publicUrl}/account?org=${org.id}&paid=1`,
    cancel_url: `${publicUrl}/account?org=${org.id}&cancelled=1`,
  });
  return session.url;
}

export async function stripePortal({ stripe, org, publicUrl }) {
  if (!org.stripe_customer_id) throw Object.assign(new Error('No card subscription yet'), { status: 400 });
  const s = await stripe.billingPortal.sessions.create({ customer: org.stripe_customer_id, return_url: `${publicUrl}/account?org=${org.id}` });
  return s.url;
}

// Keep our subscriptions table in step with a Stripe subscription object.
export async function syncStripeSubscription({ db, cfg, sub }) {
  const item = sub.items?.data?.[0];
  const mapped = planForPrice(cfg, item?.price?.id);
  let orgId = sub.metadata?.org_id;
  if (!orgId) orgId = (await db.one('SELECT id FROM orgs WHERE stripe_customer_id = $1', [typeof sub.customer === 'string' ? sub.customer : sub.customer?.id]))?.id;
  if (!orgId || !mapped) return null;
  const end = item?.current_period_end ?? sub.current_period_end; // newer API versions keep it on the item
  const status = sub.status === 'unpaid' || sub.status === 'incomplete_expired' ? 'canceled' : sub.status;
  await db.query(`INSERT INTO subscriptions (org_id, provider, provider_ref, plan, interval, status, trial_end, current_period_end, cancel_at_period_end, currency, updated_at)
      VALUES ($1, 'stripe', $2, $3, $4, $5, to_timestamp($6), to_timestamp($7), $8, $9, now())
    ON CONFLICT (org_id) DO UPDATE SET provider = 'stripe', provider_ref = EXCLUDED.provider_ref, plan = EXCLUDED.plan, interval = EXCLUDED.interval, currency = EXCLUDED.currency,
      status = EXCLUDED.status, trial_end = EXCLUDED.trial_end, current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end, updated_at = now()
    WHERE subscriptions.provider = 'stripe' OR EXCLUDED.status IN ('active', 'trialing')`,
  [orgId, sub.id, mapped.plan, mapped.interval, status, sub.trial_end || null, end || null, !!sub.cancel_at_period_end, String(sub.currency || mapped.currency).toLowerCase()]);
  if (sub.trial_end) await db.query('UPDATE orgs SET trial_used = true WHERE id = $1', [orgId]);
  return { orgId, ...mapped, status };
}

export async function handleStripeEvent({ db, cfg, stripe, event }) {
  const seen = await db.one(`INSERT INTO provider_events (provider, event_id, type) VALUES ('stripe', $1, $2) ON CONFLICT DO NOTHING RETURNING event_id`, [event.id, event.type]);
  if (!seen) return { duplicate: true };
  const o = event.data.object;
  if (event.type.startsWith('customer.subscription.')) return syncStripeSubscription({ db, cfg, sub: o });
  if (event.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) {
    return syncStripeSubscription({ db, cfg, sub: await stripe.subscriptions.retrieve(typeof o.subscription === 'string' ? o.subscription : o.subscription.id) });
  }
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
    const org = await db.one('SELECT id FROM orgs WHERE stripe_customer_id = $1', [o.customer]);
    const line = o.lines?.data?.[0];
    const mapped = planForPrice(cfg, line?.pricing?.price_details?.price || line?.price?.id) || { plan: '', interval: 'month' };
    if (org && o.amount_paid > 0) {
      await db.query(`INSERT INTO payments (org_id, provider, reference, amount, currency, channel, plan, interval) VALUES ($1, 'stripe', $2, $3, $4, '', $5, $6) ON CONFLICT DO NOTHING`,
        [org.id, o.id, o.amount_paid, o.currency, mapped.plan || 'pro', mapped.interval]);
    }
  }
  return { ok: true };
}
