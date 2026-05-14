import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for @learnlife/pb-client query functions.
 *
 * The pb-client package has no test runner of its own; we exercise it from
 * here so it picks up the existing vitest setup. The mocks below shape a
 * single fake PocketBase instance that every collection() call returns the
 * same set of stub methods on — tests reach into the stubs directly to
 * stage return values per-call.
 */

type StubResult = unknown;

function makeStub() {
  return vi.fn(() => Promise.resolve<StubResult>(undefined));
}

function makePB() {
  const collectionStub = {
    getFirstListItem: makeStub(),
    getOne: makeStub(),
    getFullList: makeStub(),
    getList: makeStub(),
    create: makeStub(),
    update: makeStub(),
    delete: makeStub(),
    subscribe: makeStub(),
  };
  const collection = vi.fn(() => collectionStub);
  const send = makeStub();
  const authStoreSave = vi.fn();
  return {
    pb: {
      collection,
      send,
      authStore: { save: authStoreSave },
      // Faithful enough echo of pb.filter for the assertions below: substitutes
      // {:key} placeholders, quoting strings and stringifying everything else.
      filter: (template: string, params: Record<string, unknown> = {}) =>
        template.replace(/\{:(\w+)\}/g, (_, key) => {
          const v = params[key];
          if (v === null) return "null";
          return typeof v === "string" ? `"${v}"` : String(v);
        }),
    },
    stubs: collectionStub,
    send,
    authStoreSave,
    collection,
  };
}

type PBHandle = ReturnType<typeof makePB>;

// ── attendance ───────────────────────────────────────────────────────────────
import { attendance } from "@learnlife/pb-client";
const { batchUpdateAttendance, resetAttendance, listAttendance, justifyAttendance } = attendance;

describe("attendance.batchUpdateAttendance", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("returns the existing record when found and no fields are passed", async () => {
    const existing = {
      id: "a1",
      learner: "L1",
      date: "2026-05-14",
      arrival: "present",
      justified: false,
    };
    h.stubs.getFirstListItem.mockResolvedValueOnce(existing);

    const result = await batchUpdateAttendance(h.pb as never, {
      learnerId: "L1",
      date: "2026-05-14",
    });

    expect(result.created).toBe(false);
    expect(result.existing).toEqual(existing);
    expect(result.attendance).toEqual(existing);
    expect(h.stubs.create).not.toHaveBeenCalled();
    expect(h.stubs.update).not.toHaveBeenCalled();
  });

  it("creates a blank record when none exists for the date", async () => {
    h.stubs.getFirstListItem.mockRejectedValueOnce(new Error("not found"));
    h.stubs.create.mockResolvedValueOnce({ id: "new1", learner: "L1", date: "2026-05-14" });

    const result = await batchUpdateAttendance(h.pb as never, {
      learnerId: "L1",
      date: "2026-05-14",
    });

    expect(h.stubs.create).toHaveBeenCalledWith({
      learner: "L1",
      date: "2026-05-14",
    });
    expect(result.created).toBe(true);
  });

  it("applies fields when provided and derives status from arrival + justified", async () => {
    h.stubs.getFirstListItem.mockResolvedValueOnce({
      id: "a1",
      learner: "L1",
      date: "2026-05-14",
      arrival: null,
      justified: false,
    });
    h.stubs.update.mockResolvedValueOnce({ id: "a1", arrival: "late", justified: true, status: "jLate" });

    await batchUpdateAttendance(h.pb as never, {
      learnerId: "L1",
      date: "2026-05-14",
      fields: { arrival: "late", justified: true },
    });

    expect(h.stubs.update).toHaveBeenCalledWith("a1", {
      arrival: "late",
      justified: true,
      status: "jLate",
    });
  });

  it("does not override an explicit status in fields", async () => {
    h.stubs.getFirstListItem.mockResolvedValueOnce({
      id: "a1",
      learner: "L1",
      arrival: null,
      justified: false,
    });
    h.stubs.update.mockResolvedValueOnce({ id: "a1" });

    await batchUpdateAttendance(h.pb as never, {
      learnerId: "L1",
      date: "2026-05-14",
      fields: { arrival: "late", status: "present" },
    });

    expect(h.stubs.update).toHaveBeenCalledWith("a1", {
      arrival: "late",
      status: "present",
    });
  });

  it("rejects malformed dates before touching the network", async () => {
    await expect(
      batchUpdateAttendance(h.pb as never, {
        learnerId: "L1",
        date: "May 14, 2026",
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    expect(h.stubs.getFirstListItem).not.toHaveBeenCalled();
  });
});

describe("attendance.resetAttendance", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("clears time / status fields but preserves justified_by/at", async () => {
    h.stubs.getFirstListItem.mockResolvedValueOnce({ id: "a1" });
    h.stubs.update.mockResolvedValueOnce({ id: "a1", arrival: null });

    const result = await resetAttendance(h.pb as never, "L1", "2026-05-14");

    expect(result.status).toBe("reset");
    expect(h.stubs.update).toHaveBeenCalledTimes(1);
    const patch = h.stubs.update.mock.calls[0][1] as Record<string, unknown>;
    expect(patch).toMatchObject({
      time_in: null,
      time_out: null,
      lunch_out: null,
      lunch_in: null,
      lunch_events: null,
      status: null,
      lunch_status: null,
      arrival: null,
      justified: false,
      justification_reason: null,
    });
    expect(patch).not.toHaveProperty("justified_by");
    expect(patch).not.toHaveProperty("justified_at");
  });

  it("returns no_record when no row exists for the date", async () => {
    h.stubs.getFirstListItem.mockRejectedValueOnce(new Error("not found"));

    const result = await resetAttendance(h.pb as never, "L1", "2026-05-14");

    expect(result.status).toBe("no_record");
    expect(h.stubs.update).not.toHaveBeenCalled();
  });
});

describe("attendance.listAttendance", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("builds a single-day filter when only date is given", async () => {
    h.stubs.getList.mockResolvedValueOnce({ items: [], totalItems: 0, totalPages: 0 });

    const result = await listAttendance(h.pb as never, { date: "2026-05-14" });

    expect(h.stubs.getList).toHaveBeenCalledWith(1, 50, {
      filter: 'date ~ "2026-05-14"',
      expand: "learner",
      sort: "-date,-created",
    });
    expect(result.date).toBe("2026-05-14");
  });

  it("builds an inclusive range filter when dateFrom/dateTo are given", async () => {
    h.stubs.getList.mockResolvedValueOnce({ items: [], totalItems: 0, totalPages: 0 });

    const result = await listAttendance(h.pb as never, {
      dateFrom: "2026-05-01",
      dateTo: "2026-05-14",
    });

    expect(h.stubs.getList).toHaveBeenCalledWith(1, 50, {
      filter: 'date >= "2026-05-01 00:00:00" && date <= "2026-05-14 23:59:59"',
      expand: "learner",
      sort: "-date,-created",
    });
    expect(result.date).toBe("2026-05-01..2026-05-14");
  });

  it("ANDs a learner filter onto the date clause", async () => {
    h.stubs.getList.mockResolvedValueOnce({ items: [], totalItems: 0, totalPages: 0 });

    await listAttendance(h.pb as never, { date: "2026-05-14", learnerId: "L1" });

    expect(h.stubs.getList).toHaveBeenCalledWith(
      1,
      50,
      expect.objectContaining({
        filter: 'date ~ "2026-05-14" && learner = "L1"',
      }),
    );
  });
});

describe("attendance.justifyAttendance", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("records justified_by + justified_at when flipping to justified", async () => {
    h.stubs.getOne.mockResolvedValueOnce({ id: "a1", arrival: "late" });
    h.stubs.update.mockResolvedValueOnce({ id: "a1" });

    await justifyAttendance(h.pb as never, {
      attendanceId: "a1",
      justified: true,
      reason: "Doctor",
      userId: "U1",
    });

    const patch = h.stubs.update.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.justified).toBe(true);
    expect(patch.justified_by).toBe("U1");
    expect(patch.justified_at).toEqual(expect.any(String));
    expect(patch.justification_reason).toBe("Doctor");
    // Late + justified → jLate per deriveStatus
    expect(patch.status).toBe("jLate");
  });

  it("does not stamp justified_by when unjustifying", async () => {
    h.stubs.getOne.mockResolvedValueOnce({ id: "a1", arrival: "late" });
    h.stubs.update.mockResolvedValueOnce({ id: "a1" });

    await justifyAttendance(h.pb as never, {
      attendanceId: "a1",
      justified: false,
      userId: "U1",
    });

    const patch = h.stubs.update.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.justified).toBe(false);
    expect(patch).not.toHaveProperty("justified_by");
    expect(patch).not.toHaveProperty("justified_at");
    // Late + not justified → late
    expect(patch.status).toBe("late");
  });
});

// ── invites ──────────────────────────────────────────────────────────────────
import { invites } from "@learnlife/pb-client";
const { generateInviteCode, createInvite, listInvites, lookupInvite, redeemInvite } = invites;

describe("invites.generateInviteCode", () => {
  it("returns a 6-character code from the unambiguous alphabet", () => {
    const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(allowed);
    }
  });
});

describe("invites.createInvite", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("sets used=false and an expiry roughly 7 days out", async () => {
    h.stubs.create.mockResolvedValueOnce({ id: "i1", code: "ABC123" });
    const before = Date.now();

    await createInvite(h.pb as never, {
      learnerId: "L1",
      email: "a@b.test",
      createdBy: "U1",
    });

    const payload = h.stubs.create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.learner).toBe("L1");
    expect(payload.email).toBe("a@b.test");
    expect(payload.used).toBe(false);
    expect(payload.created_by).toBe("U1");
    expect(typeof payload.code).toBe("string");
    expect((payload.code as string).length).toBe(6);

    const expires = new Date(payload.expires_at as string).getTime();
    const expectedMin = before + 6.9 * 24 * 60 * 60 * 1000;
    const expectedMax = Date.now() + 7.1 * 24 * 60 * 60 * 1000;
    expect(expires).toBeGreaterThan(expectedMin);
    expect(expires).toBeLessThan(expectedMax);
  });
});

describe("invites.listInvites", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("filters out used/expired invites by default", async () => {
    h.stubs.getFullList.mockResolvedValueOnce([]);

    await listInvites(h.pb as never);

    expect(h.stubs.getFullList).toHaveBeenCalledWith({
      filter: "used = false && expires_at > @now",
      sort: "-created",
      expand: "learner",
    });
  });

  it("clears the filter when showUsed is set", async () => {
    h.stubs.getFullList.mockResolvedValueOnce([]);

    await listInvites(h.pb as never, { showUsed: true });

    expect(h.stubs.getFullList).toHaveBeenCalledWith({
      filter: undefined,
      sort: "-created",
      expand: "learner",
    });
  });
});

describe("invites.lookupInvite", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("uppercases the code before querying", async () => {
    h.stubs.getFirstListItem.mockResolvedValueOnce({ id: "i1", code: "ABC123" });

    await lookupInvite(h.pb as never, "abc123");

    expect(h.stubs.getFirstListItem).toHaveBeenCalledWith(
      'code = "ABC123" && used = false && expires_at > @now',
      { expand: "learner" },
    );
  });

  it("returns null when the invite is missing/expired/used", async () => {
    h.stubs.getFirstListItem.mockRejectedValueOnce(new Error("not found"));

    const result = await lookupInvite(h.pb as never, "abc123");

    expect(result).toBeNull();
  });
});

describe("invites.redeemInvite", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("saves the returned token on success", async () => {
    h.send.mockResolvedValueOnce({
      token: "t.t.t",
      record: { id: "u1", email: "a@b.test" },
    });

    const result = await redeemInvite(h.pb as never, { code: "abc123", password: "hunter22" });

    expect(result).toEqual({ success: true });
    expect(h.send).toHaveBeenCalledWith("/api/redeem-invite", expect.any(Object));
    const body = JSON.parse(
      (h.send.mock.calls[0][1] as { body: string }).body,
    );
    expect(body).toEqual({ code: "ABC123", password: "hunter22" });
    expect(h.authStoreSave).toHaveBeenCalledWith("t.t.t", { id: "u1", email: "a@b.test" });
  });

  it("returns the hook's user-safe message on a 400", async () => {
    h.send.mockRejectedValueOnce({
      status: 400,
      data: { message: "Invite code already used." },
    });

    const result = await redeemInvite(h.pb as never, { code: "abc123", password: "x" });

    expect(result).toEqual({ success: false, error: "Invite code already used." });
    expect(h.authStoreSave).not.toHaveBeenCalled();
  });

  it("returns the 'temporarily unavailable' message on a 404 (hook missing)", async () => {
    h.send.mockRejectedValueOnce({ status: 404 });

    const result = await redeemInvite(h.pb as never, { code: "abc123", password: "x" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/temporarily unavailable/i);
    }
  });

  it("returns a generic error on unknown failures", async () => {
    h.send.mockRejectedValueOnce(new Error("boom"));

    const result = await redeemInvite(h.pb as never, { code: "abc123", password: "x" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/couldn['’]t redeem/i);
    }
  });

  it("returns an unexpected-response error when the server replies without a token", async () => {
    h.send.mockResolvedValueOnce({ token: "", record: null });

    const result = await redeemInvite(h.pb as never, { code: "abc123", password: "x" });

    expect(result.success).toBe(false);
    expect(h.authStoreSave).not.toHaveBeenCalled();
  });
});

// ── messages ─────────────────────────────────────────────────────────────────
import { messages } from "@learnlife/pb-client";
const { sendMessage, markMessagesRead, subscribeToMessages } = messages;

describe("messages.sendMessage", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("creates the message, marks the sender as having read it, then updates the conversation", async () => {
    h.stubs.create.mockResolvedValueOnce({
      id: "m1",
      conversation: "c1",
      sender: "U1",
      body: "hi",
      read_by: ["U1"],
      created: "2026-05-14T12:00:00Z",
    });
    h.stubs.update.mockResolvedValueOnce({});

    const result = await sendMessage(h.pb as never, "c1", "U1", "hi");

    expect(result.id).toBe("m1");
    expect(h.stubs.create).toHaveBeenCalledWith({
      conversation: "c1",
      sender: "U1",
      body: "hi",
      read_by: ["U1"],
    });
    expect(h.stubs.update).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        last_message: "hi",
        last_sender: "U1",
      }),
    );
  });
});

describe("messages.markMessagesRead", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("only updates messages that the user hasn't read yet", async () => {
    h.stubs.getList.mockResolvedValueOnce({
      items: [
        { id: "m1", read_by: ["U2"] },
        { id: "m2", read_by: ["U2", "U3"] },
      ],
      totalItems: 2,
      totalPages: 1,
    });
    h.stubs.update.mockResolvedValue({});

    await markMessagesRead(h.pb as never, "c1", "U1");

    expect(h.stubs.getList).toHaveBeenCalledWith(
      1,
      100,
      expect.objectContaining({
        filter: 'conversation = "c1" && read_by !~ "U1"',
      }),
    );
    expect(h.stubs.update).toHaveBeenCalledTimes(2);
    expect(h.stubs.update).toHaveBeenCalledWith("m1", { read_by: ["U2", "U1"] });
    expect(h.stubs.update).toHaveBeenCalledWith("m2", { read_by: ["U2", "U3", "U1"] });
  });

  it("does nothing when there are no unread messages", async () => {
    h.stubs.getList.mockResolvedValueOnce({ items: [], totalItems: 0, totalPages: 0 });

    await markMessagesRead(h.pb as never, "c1", "U1");

    expect(h.stubs.update).not.toHaveBeenCalled();
  });
});

describe("messages.subscribeToMessages", () => {
  let h: PBHandle;
  beforeEach(() => {
    h = makePB();
  });

  it("forwards only events whose record belongs to the target conversation", async () => {
    let captured: ((e: { record: { conversation: string } }) => void) | null = null;
    const unsub = vi.fn();
    h.stubs.subscribe.mockImplementationOnce((_topic: string, cb: typeof captured) => {
      captured = cb;
      return Promise.resolve(unsub);
    });

    const callback = vi.fn();
    const returnedUnsub = await subscribeToMessages(h.pb as never, "c1", callback);

    expect(captured).not.toBeNull();
    captured!({ record: { conversation: "c1", id: "m1" } as never });
    captured!({ record: { conversation: "c2", id: "m2" } as never });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ conversation: "c1", id: "m1" });
    expect(returnedUnsub).toBe(unsub);
  });
});
