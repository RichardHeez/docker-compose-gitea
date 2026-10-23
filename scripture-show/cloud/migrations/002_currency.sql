-- Which currency a subscription is billed in (eur, usd, ghs) — for the admin income figures.
ALTER TABLE subscriptions ADD COLUMN currency text;
UPDATE subscriptions SET currency = CASE WHEN provider = 'paystack' THEN 'ghs' ELSE 'eur' END;
