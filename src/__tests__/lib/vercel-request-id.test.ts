/**
 * @jest-environment node
 *
 * Unit tests for src/lib/server/vercel-request-id.ts — publishing Vercel's
 * `x-vercel-id` request header as the `vercel-request-id` Sentry attribute.
 *
 * Test scenarios:
 *  - Outside Vercel (VERCEL unset) → nothing is set, no hooks registered
 *  - On Vercel with the header     → global scope attribute + active root span
 *  - Error events                  → carried as a tag (attributes are dropped
 *                                    from events by applyDataToEvent())
 *  - Missing / empty header        → no-op
 *  - httpServerRequest hook        → reads the header off the normalized request
 *  - spanStart hook                → stamps spans opened later in the request
 */

const setAttributes = jest.fn();
const setTag = jest.fn();
const rootSpanSetAttribute = jest.fn();
const clientOn = jest.fn();

let activeSpan: object | undefined;
let client: object | undefined;

// setAttributes()/setTag() are chainable on a real Scope.
const globalScope = { setAttributes, setTag };
setAttributes.mockReturnValue(globalScope);
setTag.mockReturnValue(globalScope);

jest.mock("@sentry/nextjs", () => ({
  getGlobalScope: () => globalScope,
  getActiveSpan: () => activeSpan,
  getRootSpan: () => ({ setAttribute: rootSpanSetAttribute }),
  getClient: () => client,
}));

/** Re-imports the module so its cached request ID starts empty each test. */
async function loadModule() {
  jest.resetModules();
  return import("@/lib/server/vercel-request-id");
}

/** Returns the callback registered for a given client hook. */
function hookFor(name: string) {
  const entry = clientOn.mock.calls.find(([hook]) => hook === name);
  return entry?.[1];
}

describe("vercel-request-id", () => {
  const originalVercel = process.env.VERCEL;

  beforeEach(() => {
    setAttributes.mockClear();
    setTag.mockClear();
    rootSpanSetAttribute.mockClear();
    clientOn.mockClear();
    activeSpan = undefined;
    client = { on: clientOn };
    process.env.VERCEL = "1";
  });

  afterAll(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it("is a no-op when not running on Vercel", async () => {
    delete process.env.VERCEL;
    const mod = await loadModule();

    mod.setVercelRequestId("iad1::abc-123");
    mod.instrumentVercelRequestId();

    expect(setAttributes).not.toHaveBeenCalled();
    expect(setTag).not.toHaveBeenCalled();
    expect(clientOn).not.toHaveBeenCalled();
  });

  it("sets the attribute on the global scope", async () => {
    const mod = await loadModule();

    mod.setVercelRequestId("iad1::abc-123");

    expect(setAttributes).toHaveBeenCalledWith({
      "vercel-request-id": "iad1::abc-123",
    });
  });

  // Scope attributes are dropped by applyDataToEvent(), so errors need a tag.
  it("sets a tag so error events carry the request ID too", async () => {
    const mod = await loadModule();

    mod.setVercelRequestId("iad1::abc-123");

    expect(setTag).toHaveBeenCalledWith("vercel-request-id", "iad1::abc-123");
  });

  it("stamps the in-flight span when one is active", async () => {
    activeSpan = {};
    const mod = await loadModule();

    mod.setVercelRequestId("iad1::abc-123");

    expect(rootSpanSetAttribute).toHaveBeenCalledWith(
      "vercel-request-id",
      "iad1::abc-123",
    );
  });

  it("ignores a missing or empty request ID", async () => {
    const mod = await loadModule();

    mod.setVercelRequestId(undefined);
    mod.setVercelRequestId(null);
    mod.setVercelRequestId("");

    expect(setAttributes).not.toHaveBeenCalled();
    expect(setTag).not.toHaveBeenCalled();
  });

  it("reads the ID off a Headers object", async () => {
    const mod = await loadModule();

    mod.setVercelRequestIdFromHeaders(
      new Headers({ "x-vercel-id": "sfo1::xyz-789" }),
    );

    expect(setAttributes).toHaveBeenCalledWith({
      "vercel-request-id": "sfo1::xyz-789",
    });
  });

  it("picks up the header from the httpServerRequest hook", async () => {
    const mod = await loadModule();
    mod.instrumentVercelRequestId();

    hookFor("httpServerRequest")?.({}, {}, {
      headers: { "x-vercel-id": "iad1::req-1" },
    });

    expect(setAttributes).toHaveBeenCalledWith({
      "vercel-request-id": "iad1::req-1",
    });
  });

  it("stamps spans opened after the request ID is known", async () => {
    const mod = await loadModule();
    mod.instrumentVercelRequestId();

    const spanStart = hookFor("spanStart")!;
    const setAttribute = jest.fn();

    // Before the request ID is known, spans are left untouched.
    spanStart({ setAttribute });
    expect(setAttribute).not.toHaveBeenCalled();

    hookFor("httpServerRequest")?.({}, {}, {
      headers: { "x-vercel-id": "iad1::req-2" },
    });
    spanStart({ setAttribute });

    expect(setAttribute).toHaveBeenCalledWith(
      "vercel-request-id",
      "iad1::req-2",
    );
  });

  it("does nothing when the Sentry client is not initialised", async () => {
    client = undefined;
    const mod = await loadModule();

    expect(() => mod.instrumentVercelRequestId()).not.toThrow();
    expect(clientOn).not.toHaveBeenCalled();
  });
});
