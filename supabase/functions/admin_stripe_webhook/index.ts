// Edge Function: Handle Stripe webhooks
// Endpoint: POST /functions/v1/admin_stripe_webhook
// Purpose: Track subscription events, payment status, refunds

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { sendDiscordAlert } from "../_admin_shared/discord_helper.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const eventType = body.type;
    const data = body.data?.object;

    console.log(`Stripe webhook: ${eventType}`);

    // TODO: In Phase 2, verify webhook signature with STRIPE_WEBHOOK_SECRET

    switch (eventType) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionChange(data);
        break;
      case "invoice.payment_succeeded":
        await handlePaymentSuccess(data);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(data);
        break;
      case "charge.refunded":
        await handleRefund(data);
        break;
      default:
        console.log(`Unhandled event: ${eventType}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    await sendDiscordAlert({
      severity: "CRITICAL",
      title: "Stripe Webhook Failed",
      message: String(err),
    });

    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

async function handleSubscriptionChange(data: any) {
  const { customer, id, status } = data;
  await supabase.from("subscription_logs").insert({
    stripe_customer_id: customer,
    event_type: status === "active" ? "subscription.activated" : "subscription.updated",
    metadata: { subscription_id: id, status },
  });
}

async function handlePaymentSuccess(data: any) {
  const { customer, amount_paid } = data;
  await supabase.from("subscription_logs").insert({
    stripe_customer_id: customer,
    event_type: "payment.success",
    amount_usd: (amount_paid / 100).toFixed(2),
    metadata: { status: "succeeded" },
  });
}

async function handlePaymentFailed(data: any) {
  const { customer } = data;
  await supabase.from("system_alerts").insert({
    type: "payment_failed",
    message: `Payment failed for customer ${customer}`,
    metadata: { stripe_customer: customer },
  });

  await sendDiscordAlert({
    severity: "WARN",
    title: "Payment Failed",
    message: `Customer: ${customer}`,
  });
}

async function handleRefund(data: any) {
  const { customer, amount } = data;
  await supabase.from("subscription_logs").insert({
    stripe_customer_id: customer,
    event_type: "refund.issued",
    amount_usd: (amount / 100).toFixed(2),
  });
}
