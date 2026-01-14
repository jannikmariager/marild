import { createBrowserClient } from '@supabase/ssr'

function getBrowserSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Supabase env vars missing')
    }
    console.warn('Supabase browser env vars missing; using placeholder')
    return {
      url: 'https://placeholder.supabase.co',
      anonKey: 'anon-placeholder',
    }
  }

  return { url, anonKey }
}

export function createSupabaseBrowserClient() {
  const { url, anonKey } = getBrowserSupabaseConfig()
  return createBrowserClient(url, anonKey)
}

export const createClient = createSupabaseBrowserClient
