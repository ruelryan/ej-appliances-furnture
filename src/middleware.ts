import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_COOKIE } from "@/lib/preview";
import { VERIFIED_UID_HEADER } from "@/lib/auth-headers";

export async function middleware(request: NextRequest) {
  // Collected rather than written straight onto a response, because the final
  // response cannot be built until the verified user id is known — it has to
  // carry the forwarded request headers as well as any refreshed session
  // cookies. Building it early and replacing it later silently dropped the
  // cookies and signed people out.
  let refreshed: { name: string; value: string; options: CookieOptions }[] = [];

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
          refreshed = cookiesToSet;
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Hand the verified user id downstream so getProfile() does not have to call
  // auth.getUser() a second time. That call is a network round trip to Supabase
  // in Mumbai (~0.3s from Singapore), and it was happening two or three times
  // per request: here, then again inside getProfile in the layout, then again
  // in any page that calls getProfile itself.
  //
  // SECURITY: this header is only trustworthy because it is ALWAYS written here
  // — set when there is a user, DELETED when there is not. A client can send
  // `x-eandj-uid: <someone else's uuid>`; if this middleware ever left an
  // incoming value untouched, that would be a straight privilege escalation.
  // Never make either branch conditional.
  const forwarded = new Headers(request.headers);
  if (user) forwarded.set(VERIFIED_UID_HEADER, user.id);
  else forwarded.delete(VERIFIED_UID_HEADER);

  const response = NextResponse.next({ request: { headers: forwarded } });
  // Session refresh must survive on every path out of here, including the
  // redirects below.
  const withCookies = <T extends NextResponse>(r: T) => {
    refreshed.forEach(({ name, value, options }) => r.cookies.set(name, value, options));
    return r;
  };
  withCookies(response);

  const path = request.nextUrl.pathname;
  const isLogin = path.startsWith("/login");
  const isPublic =
    path === "/api/health" || path.startsWith("/api/backup");

  if (!user && !isLogin && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withCookies(NextResponse.redirect(url));
  }

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return withCookies(NextResponse.redirect(url));
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
