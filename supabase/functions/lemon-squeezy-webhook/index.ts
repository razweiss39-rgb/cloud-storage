import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const encoder = new TextEncoder();
const lifecycleEvents = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
]);

const variants = [
  ["LEMON_SQUEEZY_VARIANT_BASIC_MONTHLY", "basic", "monthly"],
  ["LEMON_SQUEEZY_VARIANT_BASIC_YEARLY", "basic", "yearly"],
  ["LEMON_SQUEEZY_VARIANT_POPULAR_MONTHLY", "popular", "monthly"],
  ["LEMON_SQUEEZY_VARIANT_POPULAR_YEARLY", "popular", "yearly"],
  ["LEMON_SQUEEZY_VARIANT_CREATOR_MONTHLY", "creator", "monthly"],
  ["LEMON_SQUEEZY_VARIANT_CREATOR_YEARLY", "creator", "yearly"],
  ["LEMON_SQUEEZY_VARIANT_PRO_1TB_MONTHLY", "pro_1tb", "monthly"],
  ["LEMON_SQUEEZY_VARIANT_PRO_1TB_YEARLY", "pro_1tb", "yearly"],
  ["LEMON_SQUEEZY_VARIANT_ENTERPRISE_MONTHLY", "enterprise", "monthly"],
  ["LEMON_SQUEEZY_VARIANT_ENTERPRISE_YEARLY", "enterprise", "yearly"],
];

function jsonResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function equalSignature(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(signed), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return equalSignature(signature.toLowerCase(), expected);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, "Method not allowed.");
  }

  const webhookSecret = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, "Webhook configuration is incomplete.");
  }

  const body = await request.text();
  if (encoder.encode(body).byteLength > 1_000_000) {
    return jsonResponse(413, "Webhook payload is too large.");
  }

  const signature = request.headers.get("X-Signature");
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) {
    return jsonResponse(401, "Invalid webhook signature.");
  }

  let signatureIsValid: boolean;
  try {
    signatureIsValid = await verifySignature(body, signature, webhookSecret);
  } catch {
    return jsonResponse(500, "Unable to verify webhook signature.");
  }
  if (!signatureIsValid) {
    return jsonResponse(401, "Invalid webhook signature.");
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body);
    const parsedObject = asObject(parsed);
    if (!parsedObject) return jsonResponse(400, "Invalid webhook payload.");
    payload = parsedObject;
  } catch {
    return jsonResponse(400, "Invalid webhook payload.");
  }

  const meta = asObject(payload.meta);
  const eventName = meta?.event_name;
  if (typeof eventName !== "string") {
    return jsonResponse(400, "Webhook event name is missing.");
  }
  if (!lifecycleEvents.has(eventName)) {
    return jsonResponse(202, "Event ignored.");
  }

  const data = asObject(payload.data);
  const attributes = asObject(data?.attributes);
  const subscriptionId = data?.id;
  const variantId = attributes?.variant_id;
  const status = attributes?.status;
  const createdAt = attributes?.created_at;
  const updatedAt = attributes?.updated_at;
  if (
    (typeof subscriptionId !== "string" && typeof subscriptionId !== "number") ||
    (typeof variantId !== "string" && typeof variantId !== "number") ||
    typeof status !== "string" ||
    typeof createdAt !== "string" ||
    Number.isNaN(Date.parse(createdAt)) ||
    typeof updatedAt !== "string" ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    return jsonResponse(400, "Subscription details are incomplete.");
  }

  const allowedStatuses = new Set([
    "active",
    "cancelled",
    "expired",
    "past_due",
    "paused",
    "on_trial",
    "unpaid",
  ]);
  if (!allowedStatuses.has(status)) {
    return jsonResponse(400, "Subscription status is not supported.");
  }

  const variant = variants.find(([environmentName]) =>
    Deno.env.get(environmentName) === String(variantId)
  );
  if (!variant) {
    return jsonResponse(400, "Subscription variant is not configured.");
  }
  const [, planId, billingPeriod] = variant;

  const customData = asObject(meta?.custom_data);
  const customUserId = customData?.user_id;
  if (
    customUserId !== undefined &&
    (typeof customUserId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(customUserId))
  ) {
    return jsonResponse(400, "Checkout user reference is invalid.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: existing, error: lookupError } = await supabase
    .from("subscriptions")
    .select("user_id, started_at, provider_updated_at")
    .eq("external_subscription_id", String(subscriptionId))
    .maybeSingle();
  if (lookupError) {
    return jsonResponse(500, "Unable to read existing subscription.");
  }
  if (
    existing?.provider_updated_at &&
    Date.parse(existing.provider_updated_at) >= Date.parse(updatedAt)
  ) {
    return jsonResponse(200, "Duplicate or stale subscription event ignored.");
  }

  const attributesRecord = attributes as Record<string, unknown>;
  if (existing && customUserId && customUserId !== existing.user_id) {
    return jsonResponse(403, "Webhook user does not match the stored subscription.");
  }

  const userId = existing?.user_id || customUserId;
  if (typeof userId !== "string") {
    return jsonResponse(400, "Checkout must include the authenticated user ID.");
  }

  if (!existing) {
    const customerEmail = attributesRecord.user_email;
    if (typeof customerEmail !== "string") {
      return jsonResponse(400, "Checkout customer email is missing.");
    }

    const { data: accountResult, error: accountError } = await supabase.auth.admin.getUserById(userId);
    if (accountError || !accountResult.user?.email) {
      return jsonResponse(403, "Checkout user does not match an account.");
    }
    if (accountResult.user.email.toLowerCase() !== customerEmail.toLowerCase()) {
      return jsonResponse(403, "Checkout email does not match the account.");
    }
  }

  const endDate = status === "cancelled" || status === "expired"
    ? attributesRecord.ends_at || attributesRecord.renews_at
    : attributesRecord.renews_at || attributesRecord.ends_at;
  const currentPeriodEnd = typeof endDate === "string" && !Number.isNaN(Date.parse(endDate))
    ? endDate
    : null;
  const startedAt = existing?.started_at || createdAt;
  const subscription = {
    user_id: userId,
    plan_id: planId,
    billing_period: billingPeriod,
    status,
    provider: "lemon_squeezy",
    external_subscription_id: String(subscriptionId),
    started_at: startedAt,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: status === "cancelled",
    provider_updated_at: updatedAt,
  };

  const { error: syncError } = await supabase.rpc("sync_paid_subscription", {
    p_user_id: subscription.user_id,
    p_plan_id: subscription.plan_id,
    p_billing_period: subscription.billing_period,
    p_status: subscription.status,
    p_external_subscription_id: subscription.external_subscription_id,
    p_started_at: subscription.started_at,
    p_current_period_end: subscription.current_period_end,
    p_cancel_at_period_end: subscription.cancel_at_period_end,
    p_provider_updated_at: subscription.provider_updated_at,
  });
  if (syncError) {
    return jsonResponse(500, "Unable to save subscription details.");
  }

  return jsonResponse(200, "Subscription synchronized.");
});
