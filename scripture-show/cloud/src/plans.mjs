// Plans and what each one unlocks in the F8 app. The app reads these limits from its signed licence.
// Prices shown on the website come from PRICES (override with the PRICES_JSON env var); the real
// amounts charged are the Stripe Prices you create (STRIPE_PRICE_* env vars) and the Paystack amounts below.
export const FEATURES = ['ndi', 'record', 'stream', 'ai', 'khaya', 'pco', 'stock', 'aiMotion', 'timelines', 'edgeBlend', 'remote', 'designer'];

export const PLANS = {
  free: { name: 'Free', outputs: 2, devices: 1, seats: 2, watermark: true,
    features: ['designer', 'remote'], blurb: 'Try F8 in a small church or at home' },
  pro: { name: 'Pro', outputs: 8, devices: 3, seats: 10, watermark: false,
    features: FEATURES, blurb: 'Everything for one church' },
  ministry: { name: 'Ministry', outputs: 16, devices: 10, seats: 50, watermark: false,
    features: FEATURES, blurb: 'Several campuses, many computers and a bigger team' },
};
export const PAID = ['pro', 'ministry'];

const DEFAULT_PRICES = {
  // Stripe (EUR and USD) — display only; Stripe charges what the Price IDs say.
  eur: { pro: { month: 1900, year: 19000 }, ministry: { month: 3500, year: 35000 } },
  usd: { pro: { month: 1900, year: 19000 }, ministry: { month: 3500, year: 35000 } },
  // Paystack Mobile Money / card in Ghana cedis (pesewas) — this IS the amount charged.
  ghs: { pro: { month: 15000, year: 150000 }, ministry: { month: 40000, year: 400000 } },
};
export const PRICES = (() => { try { return { ...DEFAULT_PRICES, ...JSON.parse(process.env.PRICES_JSON || '{}') }; } catch { return DEFAULT_PRICES; } })();

export const isPaid = (plan) => PAID.includes(plan);
export const planOf = (id) => PLANS[id] || PLANS.free;

// Which plan does this subscription row give right now?
export function effectivePlan(sub, at = Date.now()) {
  if (!sub || !isPaid(sub.plan)) return 'free';
  const end = sub.current_period_end ? new Date(sub.current_period_end).getTime() : 0;
  if (sub.provider === 'stripe') {
    if (['active', 'trialing'].includes(sub.status)) return sub.plan;
    if (sub.status === 'past_due' && end + 7 * 864e5 > at) return sub.plan; // a week's grace while Stripe retries the card
    return 'free';
  }
  // Prepaid (Paystack MoMo, manual): valid until the period ends, plus 3 days' grace to renew.
  return ['active'].includes(sub.status) && end + 3 * 864e5 > at ? sub.plan : 'free';
}
