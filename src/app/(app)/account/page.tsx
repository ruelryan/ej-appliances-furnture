import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { SectionCard } from "@/components/section-card";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <BackLink /> My account
        </h1>
        <p className="mt-1 text-sm text-muted">
          {profile.full_name} · {user?.email}
        </p>
      </div>

      <SectionCard title="Change password">
        <PasswordForm />
      </SectionCard>
    </div>
  );
}
