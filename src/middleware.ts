import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_COOKIE } from "@/lib/preview";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLogin = path.startsWith("/login");
  const isPublic = path === "/api/health";

  if (!user && !isLogin && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // "View as" is read-only, and THIS is what enforces it.
  //
  // A preview only changes the role the UI renders against; the database still
  // sees the owner, so RLS would happily accept a write. Hiding the buttons is
  // not enough — the owner could still reach an action that the previewed role
  // is allowed to perform, and it would go through for real. Server actions
  // and route handlers are all non-GET, so refusing those here covers every
  // write path in the app at one point instead of ~30 individual guards.
  //
  // /api/preview is a GET for exactly this reason: the way out must not be a
  // write, or starting a preview would lock the owner inside it.
  if (
    request.cookies.get(PREVIEW_COOKIE) &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    return NextResponse.json(
      { error: "Read-only while viewing as another role. Exit the preview to make changes." },
      { status: 403 }
    );
  }

  return response;
}

export const config = {
  matcher: [
    // everything except static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
