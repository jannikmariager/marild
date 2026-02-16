import { BetaAnalyticsDataClient } from '@google-analytics/data';

export type Ga4Env = {
  propertyId: string;
  credentialsJson: string;
};

function readEnvString(name: string): string | null {
  const v = process.env[name];
  if (!v || typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s : null;
}

function decodeMaybeBase64Json(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  // Allow base64 encoded JSON (common in Vercel env vars).
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(decoded);
}

export function getGa4Env(): Ga4Env | null {
  const propertyId = readEnvString('GA4_PROPERTY_ID') ?? readEnvString('GA_PROPERTY_ID');
  const credentialsJson = readEnvString('GA4_SERVICE_ACCOUNT_JSON') ?? readEnvString('GA_SERVICE_ACCOUNT_JSON');
  if (!propertyId || !credentialsJson) return null;
  return { propertyId, credentialsJson };
}

export function createGa4ClientFromEnv(env: Ga4Env): BetaAnalyticsDataClient {
  const cred = decodeMaybeBase64Json(env.credentialsJson);
  const client_email = String(cred.client_email ?? '');
  const private_key = String(cred.private_key ?? '');
  const projectId = typeof cred.project_id === 'string' ? cred.project_id : undefined;

  if (!client_email || !private_key) {
    throw new Error('GA service account credentials missing client_email/private_key');
  }

  // Vercel env vars sometimes escape newlines in private keys.
  const normalizedKey = private_key.includes('\\n') ? private_key.replace(/\\n/g, '\n') : private_key;

  return new BetaAnalyticsDataClient({
    projectId,
    credentials: {
      client_email,
      private_key: normalizedKey,
    },
  });
}
