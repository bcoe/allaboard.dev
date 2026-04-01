import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { toUser } from "../../route";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const target = await db("users").where({ handle }).first();
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await db("follows")
      .join("users", "follows.follower_id", "users.id")
      .where("follows.following_id", target.id)
      .orderBy("follows.created_at", "desc")
      .select("users.*");

    return NextResponse.json(rows.map(toUser));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
