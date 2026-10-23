// Settings from environment variables (see .env.example).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '..', '.env')); } catch { /* no .env */ }
const e = process.env;
const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  port: Number(e.PORT || 8080),
  publicUrl: (e.PUBLIC_URL || `http://localhost:${e.PORT || 8080}`).replace(/\/+$/, ''),
  databaseUrl: e.DATABASE_URL || 'postgres://f8:f8@localhost:5432/f8cloud',
  adminEmails: list(e.ADMIN_EMAILS),
  trialDays: Number(e.TRIAL_DAYS || 14),
  licenseDays: Number(e.LICENSE_DAYS || 14),     // how long the app keeps working offline
  licensePrivateKey: (e.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  dataDir: e.DATA_DIR || path.join(here, '..', 'data'),
  smtpUrl: e.SMTP_URL || '',
  mailFrom: e.MAIL_FROM || 'F8 Scripture Presenter <no-reply@localhost>',
  stripe: {
    secretKey: e.STRIPE_SECRET_KEY || '',
    webhookSecret: e.STRIPE_WEBHOOK_SECRET || '',
    automaticTax: e.STRIPE_AUTOMATIC_TAX === '1',   // EU VAT via Stripe Tax (turn on in the Stripe dashboard first)
    host: e.STRIPE_API_HOST || '',                  // tests only
    prices: {
      'pro:month': e.STRIPE_PRICE_PRO_MONTHLY || '', 'pro:year': e.STRIPE_PRICE_PRO_YEARLY || '',
      'ministry:month': e.STRIPE_PRICE_MINISTRY_MONTHLY || '', 'ministry:year': e.STRIPE_PRICE_MINISTRY_YEARLY || '',
      // US dollars (separate Stripe prices in USD)
      'pro:month:usd': e.STRIPE_PRICE_PRO_MONTHLY_USD || '', 'pro:year:usd': e.STRIPE_PRICE_PRO_YEARLY_USD || '',
      'ministry:month:usd': e.STRIPE_PRICE_MINISTRY_MONTHLY_USD || '', 'ministry:year:usd': e.STRIPE_PRICE_MINISTRY_YEARLY_USD || '',
    },
  },
  paystack: {
    secretKey: e.PAYSTACK_SECRET_KEY || '',
    currency: e.PAYSTACK_CURRENCY || 'GHS',
    base: (e.PAYSTACK_API || 'https://api.paystack.co').replace(/\/+$/, ''),
  },
  secureCookies: (e.PUBLIC_URL || '').startsWith('https://'),
};
