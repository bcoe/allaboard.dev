/**
 * Individual tick endpoint — update or delete a tick.
 *
 * @module api/ticks/id
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

/**
 * Update an existing tick.
 *
 * **Authentication:** Required — session cookie or `?token=`. Only the
 * tick owner may edit it (`403` otherwise).
 *
 * @param req - Incoming request. JSON body (all fields optional):
 *   - `date` — ISO date string (`"YYYY-MM-DD"`).
 *   - `sent` — whether the climb was completed.
 *   - `attempts` — number of attempts.
 *   - `suggestedGrade` — grade opinion (`"V0"`–`"V18"`).
 *   - `rating` — star rating 1–4.
 *   - `comment` — free-form notes.
 *   - `instagramUrl` — Instagram post URL of the send.
 * @param params - Route params. `id` is the tick UUID.
 *
 * @remarks
 * `climbs.star_rating` and `climbs.sends` are kept in sync automatically
 * by a database trigger on the ticks table.
 *
 * @returns The updated tick row.
 *
 * @returns `400` if `rating` is provided and outside 1–4.
 * @returns `401` if not authenticated.
 * @returns `403` if the caller does not own the tick.
 * @returns `404` if the tick does not exist.
 * @returns `500` on database error.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const tick = await db("ticks").where({ id }).first();
    if (!tick) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (tick.user_id !== userId) {
      Sentry.logger.warn("tick_update_forbidden", {
        tickId: id,
        ownerId: tick.user_id,
        action: "patch",
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { date, sent, attempts, suggestedGrade, rating, comment, instagramUrl } =
      await req.json() as {
        date?: string;
        sent?: boolean;
        attempts?: number;
        suggestedGrade?: string;
        rating?: number;
        comment?: string;
        instagramUrl?: string;
      };

    if (rating !== undefined && (rating < 1 || rating > 4)) {
      return NextResponse.json({ error: "rating must be 1–4" }, { status: 400 });
    }

    const now = new Date();
    let tickTimestamp: Date | undefined;
    if (date) {
      const [y, m, d] = date.split("-").map(Number);
      tickTimestamp = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    }

    const patch: Record<string, unknown> = { updated_at: now };
    if (tickTimestamp !== undefined) patch.date            = tickTimestamp;
    if (sent      !== undefined)      patch.sent           = sent;
    if (attempts  !== undefined)      patch.attempts       = attempts ?? null;
    if (rating    !== undefined)      patch.rating         = rating;
    if (suggestedGrade !== undefined) patch.suggested_grade = suggestedGrade || null;
    if (comment   !== undefined)      patch.comment        = comment?.trim() || null;
    if (instagramUrl !== undefined)   patch.instagram_url  = instagramUrl?.trim() || null;

    await db("ticks").where({ id }).update(patch);

    const updated = await db("ticks").where({ id }).first();
    return NextResponse.json(updated);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update tick" }, { status: 500 });
  }
}

/**
 * Delete a tick.
 *
 * **Authentication:** Required — session cookie or `?token=`. Only the
 * tick owner may delete it (`403` otherwise).
 *
 * @param req - Incoming request.
 * @param params - Route params. `id` is the tick UUID.
 *
 * @remarks
 * `climbs.star_rating` and `climbs.sends` are kept in sync automatically
 * by a database trigger on the ticks table.
 *
 * @returns `204 No Content` on success.
 *
 * @returns `401` if not authenticated.
 * @returns `403` if the caller does not own the tick.
 * @returns `404` if the tick does not exist.
 * @returns `500` on database error.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const tick = await db("ticks").where({ id }).first();
    if (!tick) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (tick.user_id !== userId) {
      Sentry.logger.warn("tick_delete_forbidden", {
        tickId: id,
        ownerId: tick.user_id,
        action: "delete",
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db("ticks").where({ id }).delete();

    Sentry.logger.info("tick_deleted", { tickId: id, climbId: tick.climb_id });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete tick" }, { status: 500 });
  }
}
