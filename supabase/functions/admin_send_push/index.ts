// Push notification dispatcher
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface PushRequest {
  title: string;
  body: string;
  type?: "signal" | "trade";
  user_ids?: string[];
  data?: Record<string, unknown>;
}

const FCM_SERVER_KEY = Deno.env.get("FCM_SERVER_KEY");

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body: PushRequest = await req.json();

    if (!FCM_SERVER_KEY) {
      console.warn("[admin_send_push] Missing FCM_SERVER_KEY env var; skipping actual send");
      return new Response(JSON.stringify({
        status: "noop",
        message: `FCM not configured; would send: ${body.title}`,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!body.user_ids || body.user_ids.length === 0) {
      return new Response(JSON.stringify({ error: "user_ids is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Look up active devices for the target users
    const { data: devices, error } = await supabase
      .from("user_devices")
      .select("user_id, platform, push_token, is_active")
      .in("user_id", body.user_ids)
      .eq("is_active", true);

    if (error) {
      console.error("[admin_send_push] Failed to load user_devices", error);
      return new Response(JSON.stringify({ error: "failed_to_load_devices" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const tokens = (devices || []).map((d) => d.push_token as string).filter(Boolean);

    if (tokens.length === 0) {
      return new Response(JSON.stringify({ status: "no_devices" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = {
      registration_ids: tokens,
      notification: {
        title: body.title,
        body: body.body,
      },
      data: body.data || {},
    };

    const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${FCM_SERVER_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const fcmText = await fcmRes.text();
    console.log("[admin_send_push] FCM response", fcmRes.status, fcmText.slice(0, 300));

    return new Response(
      JSON.stringify({
        status: "sent",
        count: tokens.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
