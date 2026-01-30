import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://www.marild.com";
const resendApiKey = Deno.env.get("RESEND_API_KEY");

if (!resendApiKey) {
  console.warn("RESEND_API_KEY is not set - send-welcome-email will fail to send emails");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface RequestBody {
  user_id: string;
  email: string;
  mode?: "welcome" | "resend";
}

interface ResendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as RequestBody;
    const { user_id, email, mode = "welcome" } = body;

    if (!user_id || !email) {
      return new Response(JSON.stringify({ error: "Missing user_id or email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Rate limiting for resend
    if (mode === "resend") {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error: countError } = await supabase
        .from("email_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user_id)
        .in("type", ["welcome_sent", "resend"])
        .gte("created_at", oneHourAgo);

      if (countError) {
        console.error("Error checking resend rate limit", countError);
      } else if ((count ?? 0) >= 3) {
        return new Response(
          JSON.stringify({
            error: "Too many verification emails requested. Please try again in about an hour.",
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // Generate Supabase email verification link
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "signup",
      email,
      options: {
        redirectTo: `${publicSiteUrl}/auth/verified`,
      },
    });

    if (linkError || !linkData?.action_link) {
      console.error("Error generating verification link", linkError);
      return new Response(JSON.stringify({ error: "Failed to generate verification link" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const verifyUrl = linkData.action_link;

    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "Email service is not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build email payload
    const subject = "Welcome to Marild — confirm your email";
    const html = buildWelcomeEmailHtml({ verifyUrl });

    const payload: ResendEmailPayload = {
      from: "Marild <welcome@marild.com>",
      to: [email],
      subject,
      html,
    };

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resendResp.ok) {
      const text = await resendResp.text();
      console.error("Resend API error", resendResp.status, text);
      return new Response(JSON.stringify({ error: "Failed to send verification email" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Log email event
    const { error: insertError } = await supabase.from("email_events").insert({
      user_id,
      email,
      type: mode === "resend" ? "resend" : "welcome_sent",
    });

    if (insertError) {
      console.error("Failed to log email_events row", insertError);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-welcome-email error", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

function buildWelcomeEmailHtml({ verifyUrl }: { verifyUrl: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Welcome to Marild</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.12);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <tr>
              <td style="padding:24px 24px 16px 24px;background:linear-gradient(135deg,#020617,#0f172a);">
                <div style="color:#e5e7eb;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Marild</div>
                <div style="color:#f9fafb;font-size:22px;font-weight:600;margin-top:4px;">Welcome to the Live Trading Dashboard</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 24px 16px 24px;">
                <p style="margin:0 0 12px 0;color:#111827;font-size:16px;font-weight:500;">You're almost ready.</p>
                <p style="margin:0 0 16px 0;color:#4b5563;font-size:14px;line-height:1.6;">
                  Confirm your email to activate your account and unlock verified signals, live model portfolios, and full performance transparency.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 24px 24px 24px;">
                <a href="${verifyUrl}" style="display:inline-block;background-color:#0f766e;color:#ecfeff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 32px;border-radius:999px;box-shadow:0 8px 20px rgba(15,118,110,0.35);">
                  Verify Email
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px 24px;">
                <p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;line-height:1.6;">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <p style="margin:0;color:#4b5563;font-size:11px;word-break:break-all;">
                  <a href="${verifyUrl}" style="color:#0f766e;text-decoration:underline;">${verifyUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 20px 24px;border-top:1px solid #e5e7eb;background-color:#f9fafb;">
                <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.6;">
                  You received this email because you signed up for Marild. If you didn't create an account, you can safely ignore this message.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
