"use server";

import { revalidatePath } from "next/cache";
import { getProfile, type Role } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Roles an owner may assign in the UI (legacy 'staff' is not offered).
const ASSIGNABLE_ROLES: Role[] = [
  "owner",
  "admin",
  "collector",
  "sales_agent",
  "delivery",
];

function normalizeRole(value: string): Role {
  return (ASSIGNABLE_ROLES as string[]).includes(value)
    ? (value as Role)
    : "collector"; // least-privilege fallback
}

async function requireOwner() {
  const profile = await getProfile();
  if (profile?.role !== "owner") throw new Error("Owner access required");
  return profile;
}

export async function createUser(_prev: unknown, formData: FormData) {
  try {
    await requireOwner();
  } catch {
    return { error: "Owner access required." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = normalizeRole(String(formData.get("role") ?? "collector"));

  if (!email || !password || !fullName) {
    return { error: "Name, email, and password are all required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) return { error: error.message };

  // handle_new_user trigger creates the profile; set the requested role
  const { error: roleErr } = await admin
    .from("profiles")
    .update({ role, full_name: fullName })
    .eq("id", data.user.id);

  if (roleErr) return { error: roleErr.message };

  revalidatePath("/admin");
  return { success: `Account created for ${fullName} (${email}).` };
}

export async function setUserRole(userId: string, role: string) {
  const me = await requireOwner();
  if (userId === me.id) {
    throw new Error("You cannot change your own role.");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: normalizeRole(role) })
    .eq("id", userId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function setUserActive(userId: string, active: boolean) {
  const me = await requireOwner();
  if (userId === me.id) throw new Error("You cannot deactivate your own account.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ active })
    .eq("id", userId);

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
