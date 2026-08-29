import { NextResponse, type NextRequest } from "next/server";
import { getRealProfile } from "@/lib/supabase/server";
import { PREVIEW_COOKIE, isPreviewable } from "@/lib/preview";

/**
 * Start or end a "view as" preview.
 *
 *   GET /api/preview?role=collector   start
 *   GET /api/preview?exit=1           end
 *
 * GET rather than a server action on purpose: middleware refuses every non-GET
 * request while a preview is running (that is what makes the preview
 * read-only), so the way out cannot itself be a POST or the owner would be
 * locked in.
 *
 * Authorised against getRealProfile(), never getProfile() — the previewed role
 * must not be able to decide anything about the preview. A collector-preview
 * calling this route reads as a real owner and is allowed to switch or exit,
 * which is correct: it is still the owner holding the session.
 */
export async function GET(request: NextRequest) {
  const profile = await getRealProfile();
  const home = new URL("/", request.url);

  // Not an owner: no preview, and no acknowledgement that one exists.
  if (profile?.role !== "owner") {
    return NextResponse.redirect(home);
  }

  const params = request.nextUrl.searchParams;
  const back = params.get("back");
  // Only same-origin relative paths, so this cannot be turned into an open
  // redirect by handing the owner a crafted link.
  const target =
    back && back.startsWith("/") && !back.startsWith("//")
      ? new URL(back, request.url)
      : home;

  const response = NextResponse.redirect(target);

  if (params.get("exit")) {
    response.cookies.delete(PREVIEW_COOKIE);
    return response;
  }

  const role = params.get("role");
  if (isPreviewable(role)) {
    response.cookies.set(PREVIEW_COOKIE, role, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Deliberately short. A preview left running would quietly hide
      // Analytics and Admin from the owner the next morning, and the cause
      // would be hard to guess.
      maxAge: 60 * 60,
    });
  }
  return response;
}
