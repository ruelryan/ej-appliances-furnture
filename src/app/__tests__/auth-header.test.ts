import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VERIFIED_UID_HEADER } from "@/lib/auth-headers";

/**
 * getProfile() trusts a request header for the caller's identity instead of
 * re-verifying the token, which saves a ~0.3s round trip to Supabase on every
 * page. That trade is only sound while middleware writes the header on BOTH
 * paths — setting it for a verified user, and DELETING it when there is none.
 *
 * If the delete is ever dropped, a client can simply send
 * `x-eandj-uid: <the owner's uuid>` and be treated as the owner. That is a
 * privilege escalation, it would pass every type check and every existing
 * test, and nothing about the app would look broken.
 *
 * Source-level rather than behavioural because exercising the real middleware
 * needs a live Supabase session. It is coarse, but it catches the deletion of
 * the line that matters.
 */
const middleware = fs.readFileSync(
  path.join(process.cwd(), "src", "middleware.ts"),
  "utf8"
);

describe("verified-uid header", () => {
  it("is set from the verified user", () => {
    expect(middleware).toMatch(/\.set\(\s*VERIFIED_UID_HEADER\s*,\s*user\.id\s*\)/);
  });

  it("is DELETED when there is no verified user — the anti-spoofing half", () => {
    expect(
      middleware,
      "middleware must delete the header when unauthenticated, or a client can forge it"
    ).toMatch(/\.delete\(\s*VERIFIED_UID_HEADER\s*\)/);
  });

  it("never leaves the incoming value untouched — no conditional guard around either branch", () => {
    // Both must appear in the same if/else, not behind some other condition.
    const block = middleware.match(
      /if \(user\) [^\n]*\.set\(\s*VERIFIED_UID_HEADER[\s\S]{0,120}?\.delete\(\s*VERIFIED_UID_HEADER\s*\);/
    );
    expect(block, "set and delete must be the two halves of one unconditional if/else").not.toBeNull();
  });

  it("uses a header name the app controls", () => {
    expect(VERIFIED_UID_HEADER).toMatch(/^x-/);
    expect(VERIFIED_UID_HEADER.toLowerCase()).toBe(VERIFIED_UID_HEADER);
  });

  it("still falls back to auth.getUser() when the header is absent", () => {
    const server = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "supabase", "server.ts"),
      "utf8"
    );
    expect(
      server,
      "getRealProfile must work outside the middleware matcher"
    ).toContain("supabase.auth.getUser()");
  });
});
