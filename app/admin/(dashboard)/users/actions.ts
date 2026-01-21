'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateUserRole(userId: string, newRole: string) {
  const supabase = await createAdminClient()
  const result = await persistRole(supabase, userId, newRole)
  if (!result.success) {
    return result
  }
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return { success: true }
}

export async function disableUser(userId: string) {
  const supabase = await createAdminClient()
  const result = await persistRole(supabase, userId, 'disabled')
  if (!result.success) {
    return result
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return { success: true }
}

export async function enableUser(userId: string) {
  const supabase = await createAdminClient()
  const result = await persistRole(supabase, userId, 'free')
  if (!result.success) {
    return result
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return { success: true }
}

type AdminSupabaseClient = Awaited<ReturnType<typeof createAdminClient>>

async function persistRole(supabase: AdminSupabaseClient, userId: string, tier: string) {
  const now = new Date().toISOString()
  const { error: profileError } = await supabase
    .from('user_profile')
    .update({ subscription_tier: tier, updated_at: now })
    .eq('user_id', userId)

  if (profileError) {
    return { success: false as const, error: profileError.message }
  }

  const { error: statusError } = await supabase
    .from('subscription_status')
    .upsert(
      {
        user_id: userId,
        tier,
        renewed_at: now,
      },
      { onConflict: 'user_id' },
    )

  if (statusError) {
    return { success: false as const, error: statusError.message }
  }

  return { success: true as const }
}
