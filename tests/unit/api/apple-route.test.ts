import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level switches the mocks read. `identityResult` drives what
// verifyAppleIdentityToken resolves to; `identityThrows` simulates an
// invalid/expired token. `selectQueue` feeds successive
// db.select().from().where().limit() calls in call order — this route
// issues up to three sequential selects (oauth link, then user-by-id
// OR user-by-email, then user-by-id again after an insert), so a
// simple FIFO queue is enough without branching on the table ref.
const state = {
  identityResult: null as {
    appleUserId: string;
    email: string | null;
    emailVerified: boolean;
  } | null,
  identityThrows: false,
  selectQueue: [] as Array<Record<string, unknown>[]>,
};

const verifyAppleIdentityToken = vi.fn(async (_idToken: string) => {
  if (state.identityThrows) throw new Error("invalid Apple identity token");
  return state.identityResult!;
});
vi.mock("$lib/server/api/apple", () => ({
  verifyAppleIdentityToken: (idToken: string) => verifyAppleIdentityToken(idToken),
}));

const createSession = vi.fn(async (_userId: string, _attrs: object) => ({ id: "sess-1" }));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: { createSession: (userId: string, attrs: object) => createSession(userId, attrs) },
}));

vi.mock("$lib/server/db/schema", () => ({
  users: { id: {}, email: {} },
  oauthAccounts: { provider: {}, providerUserId: {}, userId: {} },
}));

const inserts: Array<{ table: unknown; values: unknown }> = [];

// The new-user path now runs both inserts inside dbTx.transaction (see
// commands.ts atomicity fix) — mirror the tx-mock pattern used in
// tests/unit/api/wipe.test.ts: the callback gets a mock tx client whose
// insert() records into the same `inserts` array the old top-level
// db.insert used to, so existing assertions keep working unmodified.
function buildTxClient() {
  return {
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        inserts.push({ table, values });
      },
    }),
  };
}

vi.mock("$lib/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.selectQueue.shift() ?? [],
        }),
      }),
    }),
  },
  dbTx: {
    transaction: async <T>(cb: (tx: ReturnType<typeof buildTxClient>) => Promise<T>) =>
      cb(buildTxClient()),
  },
}));

const { POST } = await import("../../../src/routes/api/v1/auth/apple/+server");

const call = (body: object) =>
  POST({
    request: new Request("http://x", { method: "POST", body: JSON.stringify(body) }),
  } as never);

const baseUser = {
  id: "u1",
  email: "a@b.com",
  name: "Ada",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

beforeEach(() => {
  state.identityResult = null;
  state.identityThrows = false;
  state.selectQueue = [];
  inserts.length = 0;
  verifyAppleIdentityToken.mockClear();
  createSession.mockClear();
});

describe("POST /api/v1/auth/apple", () => {
  it("signs in via an existing oauth_accounts (apple, sub) link", async () => {
    state.identityResult = { appleUserId: "000123.abc", email: "a@b.com", emailVerified: true };
    // 1st select: oauthAccounts lookup finds the link. 2nd select: user-by-id.
    state.selectQueue = [[{ userId: "u1" }], [baseUser]];

    const res = await call({ identityToken: "tok" });
    expect(res.status).toBe(200);
    const resBody = await res.json();
    expect(resBody).toEqual({
      token: "sess-1",
      user: {
        id: "u1",
        email: "a@b.com",
        name: "Ada",
        avatarUrl: null,
        timezone: "UTC",
        twoFactorEnabled: false,
        emailVerified: true,
      },
    });
    expect(createSession).toHaveBeenCalledWith("u1", {});
    expect(inserts).toHaveLength(0);
  });

  it("refuses to auto-link when the email matches an existing non-Apple account (409)", async () => {
    state.identityResult = {
      appleUserId: "000456.def",
      email: "existing@b.com",
      emailVerified: true,
    };
    // 1st select: oauthAccounts lookup finds nothing. 2nd select: user-by-email finds an existing account.
    state.selectQueue = [[], [{ ...baseUser, id: "u2", email: "existing@b.com" }]];

    await expect(call({ identityToken: "tok" })).rejects.toMatchObject({ status: 409 });
    expect(createSession).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("creates a new user + oauth link when there is no existing link or matching account", async () => {
    state.identityResult = { appleUserId: "000789.ghi", email: "new@b.com", emailVerified: true };
    const newUser = { ...baseUser, id: "u3", email: "new@b.com", name: "Apple User" };
    // 1st select: oauthAccounts lookup finds nothing. 2nd select: user-by-email finds nothing.
    // 3rd select: user-by-id after the insert.
    state.selectQueue = [[], [], [newUser]];

    const res = await call({ identityToken: "tok" });
    expect(res.status).toBe(200);
    const resBody = await res.json();
    expect(resBody).toEqual({
      token: "sess-1",
      user: {
        id: "u3",
        email: "new@b.com",
        name: "Apple User",
        avatarUrl: null,
        timezone: "UTC",
        twoFactorEnabled: false,
        emailVerified: true,
      },
    });

    expect(inserts).toHaveLength(2);
    const userInsert = inserts.find(
      (i) => (i.values as Record<string, unknown>).email === "new@b.com",
    );
    expect(userInsert?.values).toMatchObject({
      email: "new@b.com",
      passwordHash: null,
      avatarUrl: null,
      emailVerified: true,
    });
    // The route mints its own cuid2 for the new user rather than reusing
    // the id from the (mocked) post-insert select — assert the two
    // inserts agree with each other and with the session that gets created.
    const newUserId = (userInsert?.values as Record<string, unknown>).id as string;
    expect(newUserId).toEqual(expect.any(String));

    const linkInsert = inserts.find(
      (i) => (i.values as Record<string, unknown>).providerUserId === "000789.ghi",
    );
    expect(linkInsert?.values).toMatchObject({
      provider: "apple",
      providerUserId: "000789.ghi",
      userId: newUserId,
    });
    expect(createSession).toHaveBeenCalledWith(newUserId, {});
  });

  it("returns 401 when the Apple identity token is invalid", async () => {
    state.identityThrows = true;

    await expect(call({ identityToken: "garbage" })).rejects.toMatchObject({ status: 401 });
    expect(createSession).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});
