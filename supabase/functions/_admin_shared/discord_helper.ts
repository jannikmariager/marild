// Discord alert helper for admin backend
// Uses native fetch instead of external library for better compatibility

export type AlertSeverity = "INFO" | "WARN" | "CRITICAL";

interface DiscordAlertParams {
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, unknown>;
}

const COLOR_MAP: Record<AlertSeverity, number> = {
  INFO: 0x3498db,      // Blue
  WARN: 0xf39c12,      // Orange
  CRITICAL: 0xe74c3c,  // Red
};

export async function sendDiscordAlert(params: DiscordAlertParams) {
  // Try DISCORD_ALERT_WEBHOOK_URL first, fallback to DISCORD_SIGNALS_WEBHOOK
  let webhookUrl = Deno.env.get("DISCORD_ALERT_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_ALERT_WEBHOOK_URL not configured, falling back to DISCORD_SIGNALS_WEBHOOK");
    webhookUrl = Deno.env.get("DISCORD_SIGNALS_WEBHOOK");
    
    if (!webhookUrl) {
      console.warn("Neither DISCORD_ALERT_WEBHOOK_URL nor DISCORD_SIGNALS_WEBHOOK configured, skipping Discord alert");
      return;
    }
  }

  const embed = {
    title: `[${params.severity}] ${params.title}`,
    description: params.message,
    color: COLOR_MAP[params.severity],
    timestamp: new Date().toISOString(),
    fields: params.context
      ? Object.entries(params.context).map(([key, value]) => ({
          name: key,
          value: String(value),
          inline: true,
        }))
      : [],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      console.error('Discord webhook failed:', response.status, await response.text());
    }
  } catch (err) {
    console.error("Failed to send Discord alert:", err);
  }
}
