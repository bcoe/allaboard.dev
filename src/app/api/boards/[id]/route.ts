import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";
import { toBoard } from "../route";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const { id } = await params;
    const board = await db("boards").where({ id }).first();
    if (!board) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (board.created_by !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { name, location, description } =
      await req.json() as { name?: string; location?: string; description?: string };

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name.trim();
    if (location !== undefined) patch.location = location.trim() || null;
    if (description !== undefined) patch.description = description.trim() || null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await db("boards").where({ id }).update(patch);
    const updated = await db("boards").where({ id }).first();
    return NextResponse.json(toBoard(updated));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
