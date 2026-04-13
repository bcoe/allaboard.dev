/**
 * @jest-environment node
 *
 * API contract tests for GET /api/setters
 */

import { NextRequest } from "next/server";
import { GET } from "@/app/api/setters/route";
import { qb } from "./helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/lib/server/db", () => ({ __esModule: true, default: jest.fn() }));

import db from "@/lib/server/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extends the shared `qb` stub with a `.modify()` method, required by the
 * setters GET handler's `db("setters").modify(fn)...` call chain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qbm(arrayResult: unknown = [], firstResult?: unknown): Record<string, any> {
  const b = qb(arrayResult, firstResult);
  b.modify = jest.fn().mockImplementation((fn: (q: typeof b) => void) => {
    fn(b);
    return b;
  });
  return b;
}

function req(qs = "") {
  return new NextRequest(`http://localhost/api/setters${qs ? `?${qs}` : ""}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

describe("GET /api/setters", () => {
  it("returns 200 with an array of setter names", async () => {
    const rows = [{ name: "Chris Sharma" }, { name: "Adam Ondra" }];
    mockDb.mockReturnValue(qbm(rows));
    const res = await GET(req("q=sh"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(["Chris Sharma", "Adam Ondra"]);
  });

  it("returns an empty array when no setters match the query", async () => {
    mockDb.mockReturnValue(qbm([]));
    const res = await GET(req("q=zzz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns an empty array when no query is provided and the table is empty", async () => {
    mockDb.mockReturnValue(qbm([]));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("applies whereILike when a query is given", async () => {
    mockDb.mockReturnValue(qbm([]));
    await GET(req("q=sharma"));
    const qbInstance = mockDb.mock.results[0].value;
    // modify is called, and inside it whereILike is applied
    expect(qbInstance.modify).toHaveBeenCalled();
    expect(qbInstance.whereILike).toHaveBeenCalledWith("name", "%sharma%");
  });

  it("does not apply whereILike when the query is empty", async () => {
    mockDb.mockReturnValue(qbm([]));
    await GET(req());
    const qbInstance = mockDb.mock.results[0].value;
    expect(qbInstance.whereILike).not.toHaveBeenCalled();
  });

  it("respects the ?limit= parameter", async () => {
    mockDb.mockReturnValue(qbm([]));
    await GET(req("q=a&limit=3"));
    const qbInstance = mockDb.mock.results[0].value;
    expect(qbInstance.limit).toHaveBeenCalledWith(3);
  });

  it("caps the limit at 50 even if a larger value is requested", async () => {
    mockDb.mockReturnValue(qbm([]));
    await GET(req("q=a&limit=999"));
    const qbInstance = mockDb.mock.results[0].value;
    expect(qbInstance.limit).toHaveBeenCalledWith(50);
  });

  it("defaults the limit to 10 when no ?limit= is provided", async () => {
    mockDb.mockReturnValue(qbm([]));
    await GET(req("q=a"));
    const qbInstance = mockDb.mock.results[0].value;
    expect(qbInstance.limit).toHaveBeenCalledWith(10);
  });

  it("returns 500 on a database error", async () => {
    jest.spyOn(console, "error").mockImplementationOnce(() => {});
    mockDb.mockImplementation(() => { throw new Error("db down"); });
    const res = await GET(req("q=x"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/failed to fetch setters/i);
  });
});
