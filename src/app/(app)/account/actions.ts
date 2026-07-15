"use server";

import { createClient } from "@/lib/supabase/server";

export async function changePassword(
  _prev: { error?: string; success?: string } | null,
  formData: FormData
) {
  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!current || !next || !confirm) {
    return { error: "All three fields are required." };
  }
  if (next.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (next !== confirm) {
    return { error: "New passwords don't match." };
  }
  if (next === current) {
    return { error: "New password must be different from the current one." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { error: "Not signed in." };
  }

  // Verify the current password before allowing the change.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (reauthError) {
    return { error: "Current password is incorrect." };
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    return { error: error.message };
  }

  return { success: "Password changed. Use the new one next time you sign in." };
}
