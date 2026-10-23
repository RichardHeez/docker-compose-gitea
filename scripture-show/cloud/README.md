# F8 Cloud

The online side of F8 Scripture Presenter: accounts, churches, team members, plans and payments,
and licences for the computers that run F8.

| Part | What it does |
|---|---|
| **Accounts** | Sign up, email confirmation, sign in, password reset, change password. Passwords stored as scrypt hashes; sessions in an HttpOnly cookie. |
| **Churches & team** | Each subscription belongs to a church. Owners and admins invite people by email (owner / admin / operator), limited by the plan’s seats. One person can belong to several churches. |
| **Plans** | Free (2 screens, 1 computer, F8 mark on screens), Pro (8 screens, 3 computers, everything) and Ministry (16 screens, 10 computers). Edit them in `src/plans.mjs`. |
| **Card, Bancontact, SEPA** | Stripe Checkout subscriptions in euros or US dollars with a 14-day trial (once per church), promo codes, VAT numbers and optional Stripe Tax. Changes and cancellations through Stripe’s billing portal. |
| **Mobile Money** | Paystack (MTN MoMo, Telecel Cash, AirtelTigo Money, cards) in cedis. Prepaid month/year — each payment adds time; reminder email 5 days before the end; 3 days’ grace. |
| **Computers** | F8 shows a code; someone approves it at `/activate` and picks the church. The computer gets a **signed licence** (Ed25519) saying the plan and limits, valid offline for 14 days and refreshed in the background. Removing a computer stops its refreshes. |
| **Admin** | `/admin` for the emails in `ADMIN_EMAILS`: numbers (churches, plans, trials, monthly income) and giving a church a plan by hand (bank transfer, partners). |
| **Privacy (GDPR)** | Download my data, delete my account, one necessary cookie, privacy and terms templates in `public/`. |

## Run it

```bash
cp .env.example .env      # fill it in
docker compose up -d      # starts PostgreSQL + F8 Cloud on port 8080
```

Put it behind HTTPS (Caddy, Traefik, Cloudflare or your host’s proxy) and set `PUBLIC_URL` to that address.

Without Docker: Node 20+, a PostgreSQL 13+ database in `DATABASE_URL`, then `npm ci && npm start`.

## Setting up payments

**Stripe** (Belgian company — card, Bancontact, SEPA Direct Debit)
1. dashboard.stripe.com → Settings → Payment methods: switch on Cards, Bancontact, SEPA Direct Debit.
2. Product catalogue: create *F8 Pro* (€19 / $19 a month, €190 / $190 a year) and *F8 Ministry* (€35 / $35 a month, €350 / $350 a year): a monthly and a yearly recurring price in EUR, and the same in USD if you want dollars. Put the price ids in `.env` (`STRIPE_PRICE_*` and `STRIPE_PRICE_*_USD`).
3. Developers → Webhooks: add `https://YOUR-SITE/api/webhooks/stripe` with `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Settings → Billing → Customer portal: allow cancelling and switching between the prices of the same currency.
5. VAT: talk to your accountant; to let Stripe charge it, set up Stripe Tax and `STRIPE_AUTOMATIC_TAX=1`.

**Paystack** (Mobile Money)
Paystack opens merchant accounts for businesses registered in Ghana, Nigeria, Kenya, South Africa and Côte d’Ivoire. From Belgium you need a registered entity or partner there. Then: Settings → API Keys → `PAYSTACK_SECRET_KEY`; Settings → API Keys & Webhooks → webhook URL `https://YOUR-SITE/api/webhooks/paystack`. Prices in cedis are set with `PRICES_JSON`.
The Paystack code is in `src/billing/paystack.mjs`; another Mobile Money provider can replace it there.

## The F8 app

Build F8 with `F8_CLOUD_URL` set to this site and `F8_LICENSE_PUBLIC_KEY` set to the key from `/api/license/public-key`. Churches then sign in from F8 → Settings → F8 account.

**Back up** the licence signing key (`LICENSE_PRIVATE_KEY`, or the file in the `clouddata` volume) and the database. Losing the key means every installed F8 needs the new public key.

## Tests

`npm test` runs the whole flow against a real PostgreSQL (set `TEST_DATABASE_URL` to a server where the user can create databases), with fake Stripe and Paystack servers.
