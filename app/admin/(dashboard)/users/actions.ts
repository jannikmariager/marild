'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateUserRole(userId: string, newRole: string) {
  const supabase = await createAdminClient()

  const { error } = await supabase
    .from('users')
    .update({ role: newRole })
    .eq('id', userId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin/users')
  return { success: true }
}

export async function disableUser(userId: string) {
  const supabase = await createAdminClient()

  // In a real app, you'd disable via Supabase Auth API
  // For now, we'll just change their role
  const { error } = await supabase
    .from('users')
    .update({ role: 'disabled' })
    .eq('id', userId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin/users')
  return { success: true }
}

export async function enableUser(userId: string) {
  const supabase = await createAdminClient()

  const { error } = await supabase
    .from('users')
    .update({ role: 'user' })
    .eq('id', userId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/admin/users')
  return { success: true }
}
