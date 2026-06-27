import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

export async function GET(req: NextRequest) {
  const { origin, searchParams } = new URL(req.url);
  const code        = searchParams.get("code");
  const state       = searchParams.get("state");
  const storedState = req.cookies.get("oauth_state")?.value;

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(`${origin}/?auth_error=invalid_state`);
  }

  // Exchange authorisation code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  `${origin}/api/auth/callback`,
      grant_type:    "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    // Google rejected the code exchange. The user is redirected gracefully (no
    // exception thrown), so this never surfaces as a Sentry error — log it as a
    // warning with the upstream status so a spike in OAuth failures is visible.
    // Log the status only, not the response body, which can carry token details.
    Sentry.logger.warn("Google OAuth token exchange failed", {
      "auth.provider": "google",
      "auth.stage": "token_exchange",
      "auth.response_status": tokenRes.status,
    });
    return NextResponse.redirect(`${origin}/?auth_error=token_exchange`);
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Fetch Google profile (sub, email, name, picture)
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!profileRes.ok) {
    Sentry.logger.warn("Google OAuth profile fetch failed", {
      "auth.provider": "google",
      "auth.stage": "profile_fetch",
      "auth.response_status": profileRes.status,
    });
    return NextResponse.redirect(`${origin}/?auth_error=profile_fetch`);
  }

  const { sub, email, picture } = await profileRes.json() as {
    sub: string;
    email: string;
    picture: string;
  };

  const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

  // Upsert oauth_accounts
  let oauthAccount = await db("oauth_accounts")
    .where({ provider: "google", provider_user_id: sub })
    .first();
  const isNewOauthAccount = !oauthAccount;

  if (!oauthAccount) {
    [oauthAccount] = await db("oauth_accounts")
      .insert({
        provider:            "google",
        provider_user_id:    sub,
        email,
        profile_picture_url: picture,
        access_token,
        refresh_token:       refresh_token ?? null,
        token_expires_at:    tokenExpiresAt,
        updated_at:          new Date(),
      })
      .returning("*");
  } else {
    await db("oauth_accounts").where({ id: oauthAccount.id }).update({
      email,
      profile_picture_url: picture,
      access_token,
      refresh_token:       refresh_token ?? oauthAccount.refresh_token,
      token_expires_at:    tokenExpiresAt,
      updated_at:          new Date(),
    });
    oauthAccount = await db("oauth_accounts").where({ id: oauthAccount.id }).first();
  }

  // Keep users.profile_picture_url in sync on every login
  if (oauthAccount.user_id) {
    await db("users").where({ id: oauthAccount.user_id }).update({
      profile_picture_url: picture,
    });
  }

  // Write iron-session cookie
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.oauthAccountId = oauthAccount.id;
  session.userId         = oauthAccount.user_id ?? undefined;
  await session.save();

  // Audit the successful sign-in. The routing decision (home vs. onboarding) is
  // the key runtime branch here, so it's logged alongside whether this is a
  // brand-new Google account. Identify by opaque handle / account id — never
  // the email address, which is PII.
  const onboardingRequired = !oauthAccount.user_id;
  Sentry.setUser({ id: oauthAccount.user_id ?? oauthAccount.id });
  Sentry.logger.info("User signed in", {
    "auth.provider": "google",
    "auth.new_account": isNewOauthAccount,
    "auth.onboarding_required": onboardingRequired,
    "routing.decision": onboardingRequired ? "onboarding" : "home",
  });

  // Clear the CSRF state cookie and redirect
  const destination = oauthAccount.user_id ? "/" : "/onboarding";
  const response = NextResponse.redirect(`${origin}${destination}`);
  response.cookies.delete("oauth_state");
  return response;
}
