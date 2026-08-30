/**
 * The request header the auth middleware uses to hand a VERIFIED user id to
 * the server components downstream.
 *
 * Why it exists: `supabase.auth.getUser()` is a network round trip to Supabase
 * in Mumbai — about 0.3s from the Singapore region — and it was running two or
 * three times per request. Once in middleware (the auth gate), again inside
 * getProfile() in the app layout, and again in any page that calls getProfile
 * for itself. Only the first one is doing real work; the rest re-verify a token
 * that was verified milliseconds earlier on the same request.
 *
 * Why it is safe: middleware ALWAYS writes this header — setting it when a user
 * is verified and DELETING it when one is not. A client is free to send
 * `x-eandj-uid: <any uuid>`; the value only ever survives if middleware put it
 * there. Both branches must stay unconditional, or this becomes a privilege
 * escalation rather than an optimisation.
 *
 * getProfile() still falls back to auth.getUser() when the header is absent, so
 * anything running outside the middleware matcher keeps working unchanged.
 */
export const VERIFIED_UID_HEADER = "x-eandj-uid";
