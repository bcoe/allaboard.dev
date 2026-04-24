/**
 * Individual inbox item — mark as read.
 *
 * @module api/inbox/id
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

/**
 * Mark an inbox item as read.
 *
 * **Authentication:** Required. Only the inbox owner may mark items.
 *
 * @param req - Incoming request (body ignored).
 * @param params - Route params. `id` is the inbox item UUID.
 *
 * @returns `{ read: true }` on success.
 *
 * @returns `401` if not authenticated.
 * @returns `403` if not the inbox owner.
 * @returns `404` if item does not exist.
 * @returns `500` on database error.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  try {
    const { id } = await params;
    const item = await db("inbox_items").where({ id }).first();
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (item.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await db("inbox_items").where({ id }).update({ read: true });
    return NextResponse.json({ read: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to mark as read" }, { status: 500 });
  }
}
