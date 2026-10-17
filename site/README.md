# VINDR Pro 40 – product website

Static one-page shop for the BLFS-03 cordless blower, aimed at the UK, Germany and the Nordics.

- Open `index.html` directly or host the `site/` folder on any static host (Netlify, Vercel, GitHub Pages).
- Prices, packages, delivery fees and the checkout link are set at the top of the `<script>` in `index.html`
  (`PACKAGES`, `COUNTRIES`, `FREE_FROM`, `CHECKOUT_URL`).
- Set `CHECKOUT_URL` to a Stripe Payment Link or Shopify checkout to take real payments.
- Footer legal links (Imprint, Terms, Privacy, Right of withdrawal) are placeholders and are required for selling in Germany/EU.
