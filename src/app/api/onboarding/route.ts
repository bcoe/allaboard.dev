import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

function toHandle(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
}

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  if (!session.oauthAccountId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.userId) {
    return NextResponse.json({ error: "Already onboarded" }, { status: 400 });
  }

  const { displayName, boardId } =
    await req.json() as { displayName: string; boardId: string };

  if (!displayName?.trim() || !boardId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const handle = toHandle(displayName);
  if (handle.length < 2) {
    return NextResponse.json({ error: "Display name too short" }, { status: 400 });
  }

  // Re-check handle availability (client debounce is UX only — always verify server-side)
  const existing = await db("users").where({ handle }).first();
  if (existing) {
    return NextResponse.json({ error: "That name is already taken" }, { status: 409 });
  }

  const board = await db("boards").where({ id: boardId }).first();
  if (!board) {
    return NextResponse.json({ error: "Invalid board" }, { status: 400 });
  }

  const oauthAccount = await db("oauth_accounts")
    .where({ id: session.oauthAccountId })
    .first();
  if (!oauthAccount) {
    return NextResponse.json({ error: "OAuth account not found" }, { status: 400 });
  }

  // Create the user row
  await db("users").insert({
    id:                   handle,
    handle,
    display_name:         displayName.trim(),
    avatar_color:         "bg-orange-500",
    bio:                  "",
    home_board:           board.name,
    home_board_angle:     40,
    email:                oauthAccount.email,
    profile_picture_url:  oauthAccount.profile_picture_url ?? null,
  });

  // Link oauth_accounts → users
  await db("oauth_accounts")
    .where({ id: session.oauthAccountId })
    .update({ user_id: handle, updated_at: new Date() });

  // Promote the session to a fully authenticated state
  session.userId = handle;
  await session.save();

  return NextResponse.json({ ok: true });
}
