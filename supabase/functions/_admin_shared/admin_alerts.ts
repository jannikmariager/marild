/**
 * Admin Alerts Module
 * Posts system errors and alerts to admin-alerts Discord channel
 */

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

async function sendWebhook(url: string, embeds: DiscordEmbed[]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds }),
  });
  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status}`);
  }
}

export enum AlertSeverity {
  WARNING = "WARNING",
  ERROR = "ERROR",
  CRITICAL = "CRITICAL",
}

export interface AdminAlert {
  severity: AlertSeverity;
  function_name: string;
  error_message: string;
  details?: string;
  fallback_action?: string;
  stack_trace?: string;
}

/**
 * Post alert to admin-alerts Discord channel
 */
export async function postAdminAlert(alert: AdminAlert): Promise<boolean> {
  const channelId = Deno.env.get("DISCORD_ADMIN_ALERTS_CHANNEL_ID");
  
  if (!channelId) {
    console.warn("DISCORD_ADMIN_ALERTS_CHANNEL_ID not configured");
    return false;
  }

  const webhookUrl = `https://discord.com/api/webhooks/${channelId}`;

  // Determine emoji and color based on severity
  let emoji = "🟡";
  let embedColor = 0xFFD60A; // Yellow
  let severityLabel = "Warning";

  if (alert.severity === AlertSeverity.ERROR) {
    emoji = "🔴";
    embedColor = 0xFF3B30; // Red
    severityLabel = "Error";
  } else if (alert.severity === AlertSeverity.CRITICAL) {
    emoji = "🚨";
    embedColor = 0xFF0000; // Bright red
    severityLabel = "CRITICAL";
  }

  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    {
      name: "Function",
      value: alert.function_name,
      inline: true,
    },
    {
      name: "Severity",
      value: severityLabel,
      inline: true,
    },
    {
      name: "Error",
      value: alert.error_message.substring(0, 1024), // Discord field limit
      inline: false,
    },
  ];

  if (alert.details) {
    fields.push({
      name: "Details",
      value: alert.details.substring(0, 1024),
      inline: false,
    });
  }

  if (alert.fallback_action) {
    fields.push({
      name: "Fallback Action",
      value: alert.fallback_action,
      inline: false,
    });
  }

  if (alert.stack_trace) {
    // Truncate stack trace to fit Discord limits
    const truncatedStack = alert.stack_trace.substring(0, 1000);
    fields.push({
      name: "Stack Trace",
      value: `\`\`\`\n${truncatedStack}\n\`\`\``,
      inline: false,
    });
  }

  const embed: DiscordEmbed = {
    title: `${emoji} ${severityLabel}: ${alert.function_name}`,
    description: "System alert - requires attention",
    color: embedColor,
    fields,
    footer: {
      text: "TradeLens AI System Monitor",
    },
    timestamp: new Date().toISOString(),
  };

  try {
    await sendWebhook(webhookUrl, [embed]);
    console.log(`Posted ${alert.severity} alert for ${alert.function_name}`);
    return true;
  } catch (error) {
    console.error("Failed to post admin alert:", error);
    return false;
  }
}

/**
 * Quick helper for evaluation errors
 */
export async function postEvaluationError(
  functionName: string,
  error: Error | string,
  fallbackAction?: string
): Promise<boolean> {
  const errorMessage = typeof error === "string" ? error : error.message;
  const stackTrace = typeof error === "string" ? undefined : error.stack;

  return postAdminAlert({
    severity: AlertSeverity.ERROR,
    function_name: functionName,
    error_message: errorMessage,
    fallback_action: fallbackAction,
    stack_trace: stackTrace,
  });
}

/**
 * Quick helper for API failures
 */
export async function postAPIFailure(
  functionName: string,
  apiName: string,
  error: string,
  fallbackAction?: string
): Promise<boolean> {
  return postAdminAlert({
    severity: AlertSeverity.WARNING,
    function_name: functionName,
    error_message: `${apiName} API failed`,
    details: error,
    fallback_action: fallbackAction,
  });
}

/**
 * Quick helper for critical system failures
 */
export async function postCriticalFailure(
  functionName: string,
  error: Error | string
): Promise<boolean> {
  const errorMessage = typeof error === "string" ? error : error.message;
  const stackTrace = typeof error === "string" ? undefined : error.stack;

  return postAdminAlert({
    severity: AlertSeverity.CRITICAL,
    function_name: functionName,
    error_message: errorMessage,
    details: "System evaluation stopped - immediate attention required",
    stack_trace: stackTrace,
  });
}
