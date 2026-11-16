# Subscriber dashboard setup

The page uses Supabase Auth for sign-in and the `profiles` and `subscriptions`
tables for the dashboard. The `subscriptions` table is read-only to signed-in
users; subscription changes are written atomically by the Lemon Squeezy webhook
through a server-side database function using the service-role key.

## Configure the app

Set these Vite variables in an ignored local `.env.local` file or in the
deployment environment:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Never put `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_` variable or browser code.

Apply the schema:

```sh
supabase db push
```

New Supabase Auth users receive a profile row and a free 2 GB subscription row.
The profile form can update only the signed-in user's name and phone number.
The file-storage migration also creates the private `user-files` bucket and
restricts listing, uploads, and deletes to the signed-in user's UUID prefix.
The page caps individual files at 2 GB and creates seven-day signed share links.

## Configure NOWPayments links

The pricing cards display a crypto checkout link only when its matching Vite
variable is set to an HTTPS NOWPayments URL. Add the five hosted links from the
NOWPayments dashboard to the deployment environment (or a local `.env.local`):

```text
VITE_NOWPAYMENTS_BASIC_URL=
VITE_NOWPAYMENTS_POPULAR_URL=
VITE_NOWPAYMENTS_CREATOR_URL=
VITE_NOWPAYMENTS_PRO_1TB_URL=
VITE_NOWPAYMENTS_ENTERPRISE_URL=
```

These are public checkout URLs, not API credentials. Payment confirmation and
subscription updates still require a trusted server-side payment integration;
opening a hosted payment link alone does not activate a subscription.

## Configure subscription sync

Set the Lemon Squeezy webhook signing secret and the ten variant IDs (one per
paid plan and billing period) as Supabase Edge Function secrets:

```sh
supabase secrets set \
  LEMON_SQUEEZY_WEBHOOK_SECRET=YOUR_WEBHOOK_SIGNING_SECRET \
  LEMON_SQUEEZY_VARIANT_BASIC_MONTHLY=YOUR_VARIANT_ID \
  LEMON_SQUEEZY_VARIANT_BASIC_YEARLY=YOUR_VARIANT_ID \
  LEMON_SQUEEZY_VARIANT_POPULAR_MONTHLY=YOUR_VARIANT_ID \
  LEMON_SQUEEZY_VARIANT_POPULAR_YEARLY=YOUR_VARIANT_ID \
  LEMON_SQUEEZY_VARIANT_CREATOR_MONTHLY=YOUR_VARIANT_ID \
  LEMON_SQUEEZY_VARIANT_CREATOR_YEARLY=YOUR_VARIANT_ID \
  LEMON_SQUEEZY_VARIANT_PRO_1TB_MONTHLY=YOUR_VARIANT_ID \
  LEMON_SQUEEZY_VARIANT_PRO_1TB_YEARLY=YOUR_VARIANT_ID \
  LEMON_SQUEEZY_VARIANT_ENTERPRISE_MONTHLY=YOUR_VARIANT_ID \
  LEMON_SQUEEZY_VARIANT_ENTERPRISE_YEARLY=YOUR_VARIANT_ID
```

Deploy `lemon-squeezy-webhook` and configure Lemon Squeezy to send the
`subscription_created`, `subscription_updated`, `subscription_cancelled`,
`subscription_resumed`, `subscription_expired`, `subscription_paused`, and
`subscription_unpaused` events to its function URL. Checkout creation must put
the authenticated Supabase user's UUID in Lemon Squeezy custom data as
`user_id`, and the checkout email must match that account. Later lifecycle
events are matched by the provider subscription ID. Older out-of-order events
are ignored.

The current pricing page is informational and does not start checkout. Until a
checkout flow is configured to provide that custom data, paid subscriptions
must originate from a separate trusted checkout integration. The dashboard
shows only records actually present in Supabase; it does not invent paid plan
dates.
