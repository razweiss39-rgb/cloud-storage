# Subscriber dashboard setup

The page uses Supabase Auth for sign-in and the `profiles` and `subscriptions`
tables for the dashboard. The `subscriptions` table is read-only to signed-in
users; subscription changes are written atomically by the Lemon Squeezy webhook
through a server-side database function using the service-role key.

## Configure the app

The static page does not read build-time environment variables. Its public
Supabase URL and publishable key are configured directly in `index.html`, so
the Cloudflare Pages deployment does not require a Vite build step. The service
role key must never be placed in browser code.

Apply the schema:

```sh
supabase db push
```

New Supabase Auth users receive a profile row and a free 2 GB subscription row.
The profile form can update only the signed-in user's name and phone number.
The file-storage migration also creates the private `user-files` bucket and
restricts listing, uploads, and deletes to the signed-in user's UUID prefix.
The page caps individual files at 2 GB and creates seven-day signed share links.

## NOWPayments links

The five pricing cards currently link to the public `https://nowpayments.io`
site. Replace the corresponding URLs in `index.html` with the plan-specific
hosted checkout URLs from the NOWPayments dashboard when available. Payment
confirmation and subscription updates still require a trusted server-side
payment integration; opening a hosted payment link alone does not activate a
subscription.

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

NOWPayments links do not currently pass authenticated user data to the existing
Lemon Squeezy webhook. Paid subscriptions must originate from a trusted
integration that associates checkout with the authenticated Supabase user. The
dashboard shows only records actually present in Supabase; it does not invent
paid plan dates.
