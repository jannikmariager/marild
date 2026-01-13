'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function resolveAlert(alertId: string) {
  const supabase = await createAdminClient()

  const { error } = await supabase
    .from('system_alerts')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', alertId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin/errors')
  return { success: true }
}

export async function resolveAllAlerts() {
  const supabase = await createAdminClient()

  const { error } = await supabase
    .from('system_alerts')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
    })
    .eq('resolved', false)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin/errors')
  return { success: true }
}
