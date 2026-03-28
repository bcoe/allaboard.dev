import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.userId) return NextResponse.json(null, { status: 401 });

  const user = await db("users").where({ id: session.userId }).first();
  if (!user) return NextResponse.json(null, { status: 401 });

  return NextResponse.json({
    id:                 user.id,
    handle:             user.handle,
    displayName:        user.display_name,
    avatarColor:        user.avatar_color,
    profilePictureUrl:  user.profile_picture_url ?? undefined,
    bio:                user.bio,
    homeBoard:          user.home_board,
    homeBoardAngle:     user.home_board_angle,
    joinedAt:           user.joined_at,
    followersCount:     user.followers_count,
    followingCount:     user.following_count,
    personalBests: {
      ...(user.personal_best_kilter    ? { Kilter:    user.personal_best_kilter    } : {}),
      ...(user.personal_best_moonboard ? { Moonboard: user.personal_best_moonboard } : {}),
    },
  });
}
