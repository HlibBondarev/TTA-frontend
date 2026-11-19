import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { anchorClaimService } from "../../services/anchorClaimService";
import { db, type TimeAnchor } from "../../db/ttaDatabase";

vi.mock("../../db/ttaDatabase", () => ({
  db: {
    transaction: vi.fn((...args: unknown[]) => {
      const work = args[args.length - 1] as () => Promise<unknown>;
      return work();
    }),
    timeanchors: {
      get: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("anchorClaimService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    anchorClaimService.clearAll();
  });

  afterEach(() => {
    anchorClaimService.clearAll();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("in-memory claim, release, isClaimed, subscribe, and clearAll", () => {
    it("claims, checks, and releases normalized anchor IDs while notifying listeners", () => {
      const listener = vi.fn();
      const unsubscribe = anchorClaimService.subscribe(listener);

      expect(anchorClaimService.claim("   ", "sync")).toBe(false);
      expect(anchorClaimService.isClaimed("   ")).toBe(false);
      expect(listener).not.toHaveBeenCalled();

      expect(anchorClaimService.claim("  anchor-1  ", "sync")).toBe(true);
      expect(anchorClaimService.isClaimed("anchor-1")).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);

      // Duplicate claim for an already-claimed anchor fails without notifying
      expect(anchorClaimService.claim("anchor-1", "undo")).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);

      // Release with mismatched owner is a no-op
      anchorClaimService.release("anchor-1", "undo");
      expect(anchorClaimService.isClaimed("anchor-1")).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);

      // Release with blank ID or non-existent ID is a no-op
      anchorClaimService.release("   ");
      anchorClaimService.release("non-existent");
      expect(listener).toHaveBeenCalledTimes(1);

      // Release with matching owner succeeds and notifies
      anchorClaimService.release("  anchor-1 ", "sync");
      expect(anchorClaimService.isClaimed("anchor-1")).toBe(false);
      expect(listener).toHaveBeenCalledTimes(2);

      // Unsubscribed listener is no longer called
      unsubscribe();
      anchorClaimService.claim("anchor-2", "undo");
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("isolates listener errors so subsequent listeners still run", () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const brokenListener = vi.fn(() => {
        throw new Error("Listener failure");
      });
      const healthyListener = vi.fn();

      const unsub1 = anchorClaimService.subscribe(brokenListener);
      const unsub2 = anchorClaimService.subscribe(healthyListener);

      anchorClaimService.claim("anchor-1", "sync");

      expect(brokenListener).toHaveBeenCalledTimes(1);
      expect(healthyListener).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[AnchorClaimService] Listener error:",
        expect.any(Error),
      );

      unsub1();
      unsub2();
      consoleErrorSpy.mockRestore();
    });

    it("clearAll clears both claimed and ambiguous sets and notifies only when non-empty", async () => {
      const listener = vi.fn();
      const unsub = anchorClaimService.subscribe(listener);

      // No-op when already empty
      anchorClaimService.clearAll();
      expect(listener).not.toHaveBeenCalled();

      anchorClaimService.claim("anchor-1", "sync");
      vi.mocked(db.timeanchors.get).mockResolvedValue({
        id: "anchor-2",
        isSynced: 0,
      } as TimeAnchor);
      await anchorClaimService.markAmbiguousAcrossTabs(["anchor-2"]);
      expect(listener).toHaveBeenCalledTimes(2);

      anchorClaimService.clearAll();
      expect(anchorClaimService.isClaimed("anchor-1")).toBe(false);
      expect(anchorClaimService.hasAmbiguousOutcome({ id: "anchor-2" })).toBe(
        false,
      );
      expect(listener).toHaveBeenCalledTimes(3);

      unsub();
    });
  });

  describe("hasActiveClaim and hasAmbiguousOutcome", () => {
    it("evaluates active vs expired claims against provided timestamp", () => {
      expect(anchorClaimService.hasActiveClaim(undefined, 1000)).toBe(false);
      expect(anchorClaimService.hasActiveClaim({}, 1000)).toBe(false);
      expect(
        anchorClaimService.hasActiveClaim(
          { syncClaim: { owner: "sync", token: "t1", expiresAt: 1000 } },
          1000,
        ),
      ).toBe(false);
      expect(
        anchorClaimService.hasActiveClaim(
          { syncClaim: { owner: "sync", token: "t1", expiresAt: 1001 } },
          1000,
        ),
      ).toBe(true);
    });

    it("checks both persisted syncOutcomeAmbiguous flag and in-memory ambiguous set", async () => {
      expect(anchorClaimService.hasAmbiguousOutcome(undefined)).toBe(false);
      expect(anchorClaimService.hasAmbiguousOutcome({ id: "a1" })).toBe(false);
      expect(
        anchorClaimService.hasAmbiguousOutcome({
          id: "a1",
          syncOutcomeAmbiguous: true,
        }),
      ).toBe(true);

      vi.mocked(db.timeanchors.get).mockResolvedValue({
        id: "a2",
        isSynced: 0,
      } as TimeAnchor);
      await anchorClaimService.markAmbiguousAcrossTabs(["a2"]);

      expect(anchorClaimService.hasAmbiguousOutcome({ id: "  a2  " })).toBe(
        true,
      );
    });
  });

  describe("claimAcrossTabs and releaseAcrossTabs", () => {
    it("returns empty success immediately when no valid anchor IDs are provided", async () => {
      const result = await anchorClaimService.claimAcrossTabs(
        ["", "   "],
        "sync",
      );

      expect(result).toEqual({
        claimedIds: [],
        allClaimed: true,
        token: null,
      });
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("rolls back earlier in-memory claims when a subsequent ID is already claimed in memory", async () => {
      anchorClaimService.claim("anchor-2", "undo");

      const result = await anchorClaimService.claimAcrossTabs(
        ["anchor-1", "anchor-2", "anchor-1"],
        "sync",
      );

      expect(result).toEqual({
        claimedIds: [],
        allClaimed: false,
        token: null,
      });
      expect(anchorClaimService.isClaimed("anchor-1")).toBe(false);
      expect(anchorClaimService.isClaimed("anchor-2")).toBe(true);
      expect(db.timeanchors.get).not.toHaveBeenCalled();
    });

    it("persists cross-tab claim records in IndexedDB for unsynced anchors and releases matching token", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-19T19:00:00.000Z"));
      const expectedNow = Date.now();

      const anchorsById = new Map<string, TimeAnchor>([
        [
          "anchor-1",
          {
            id: "anchor-1",
            matchId: "m1",
            periodNumber: 1,
            type: 1,
            timestamp: "2026-11-19T19:00:00.000Z",
            sequenceNumber: 1,
            isSynced: 0,
            // Expired claim should be overwritten
            syncClaim: {
              owner: "undo",
              token: "expired-token",
              expiresAt: expectedNow - 1,
            },
          },
        ],
        [
          "anchor-2",
          {
            id: "anchor-2",
            matchId: "m1",
            periodNumber: 2,
            type: 1,
            timestamp: "2026-11-19T19:10:00.000Z",
            sequenceNumber: 2,
            isSynced: 0,
          },
        ],
      ]);

      vi.mocked(db.timeanchors.get).mockImplementation((async (id: string) =>
        anchorsById.get(id)) as never);
      vi.mocked(db.timeanchors.update).mockImplementation((async (
        id: string,
        changes: Partial<TimeAnchor>,
      ) => {
        const current = anchorsById.get(id);
        if (current) {
          anchorsById.set(id, { ...current, ...changes });
        }
        return 1;
      }) as never);

      const claimRes = await anchorClaimService.claimAcrossTabs(
        ["  anchor-1 ", "anchor-2", "anchor-1"],
        "sync",
      );

      expect(claimRes.allClaimed).toBe(true);
      expect(claimRes.claimedIds).toEqual(["anchor-1", "anchor-2"]);
      expect(claimRes.token).toEqual(expect.any(String));
      expect(anchorClaimService.isClaimed("anchor-1")).toBe(true);
      expect(anchorClaimService.isClaimed("anchor-2")).toBe(true);

      expect(anchorsById.get("anchor-1")?.syncClaim).toEqual({
        owner: "sync",
        token: claimRes.token,
        expiresAt: expectedNow + 60_000,
      });

      // Simulate another tab overwriting anchor-2's claim token before release
      anchorsById.set("anchor-2", {
        ...anchorsById.get("anchor-2")!,
        syncClaim: {
          owner: "undo",
          token: "other-tab-token",
          expiresAt: expectedNow + 90_000,
        },
      });

      await anchorClaimService.releaseAcrossTabs(
        ["anchor-1", "anchor-2"],
        claimRes.token,
        "sync",
      );

      expect(anchorClaimService.isClaimed("anchor-1")).toBe(false);
      expect(anchorClaimService.isClaimed("anchor-2")).toBe(false);
      // Matching token cleared, mismatched token preserved
      expect(anchorsById.get("anchor-1")?.syncClaim).toBeUndefined();
      expect(anchorsById.get("anchor-2")?.syncClaim?.token).toBe(
        "other-tab-token",
      );
    });

    it("rolls back memory claims and returns allClaimed: false when anchor is missing, already synced, or actively claimed in DB", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-19T19:00:00.000Z"));
      const now = Date.now();

      // Case 1: Missing anchor in DB
      vi.mocked(db.timeanchors.get).mockResolvedValueOnce(undefined);
      const missingRes = await anchorClaimService.claimAcrossTabs(
        ["missing-anchor"],
        "undo",
      );
      expect(missingRes).toEqual({
        claimedIds: [],
        allClaimed: false,
        token: null,
      });
      expect(anchorClaimService.isClaimed("missing-anchor")).toBe(false);

      // Case 2: Already synced anchor (isSynced === 1)
      vi.mocked(db.timeanchors.get).mockResolvedValueOnce({
        id: "synced-anchor",
        isSynced: 1,
      } as TimeAnchor);
      const syncedRes = await anchorClaimService.claimAcrossTabs(
        ["synced-anchor"],
        "undo",
      );
      expect(syncedRes).toEqual({
        claimedIds: [],
        allClaimed: false,
        token: null,
      });
      expect(anchorClaimService.isClaimed("synced-anchor")).toBe(false);

      // Case 3: Active non-expired claim held by another tab
      vi.mocked(db.timeanchors.get).mockResolvedValueOnce({
        id: "claimed-anchor",
        isSynced: 0,
        syncClaim: {
          owner: "sync",
          token: "active-token",
          expiresAt: now + 30_000,
        },
      } as TimeAnchor);
      const activeClaimRes = await anchorClaimService.claimAcrossTabs(
        ["claimed-anchor"],
        "undo",
      );
      expect(activeClaimRes).toEqual({
        claimedIds: [],
        allClaimed: false,
        token: null,
      });
      expect(anchorClaimService.isClaimed("claimed-anchor")).toBe(false);
    });

    it("rolls back memory claims and rethrows unexpected DB errors during claimAcrossTabs", async () => {
      vi.mocked(db.timeanchors.get).mockRejectedValueOnce(
        new Error("IndexedDB unavailable"),
      );

      await expect(
        anchorClaimService.claimAcrossTabs(["anchor-err"], "sync"),
      ).rejects.toThrow("IndexedDB unavailable");

      expect(anchorClaimService.isClaimed("anchor-err")).toBe(false);
    });

    it("logs and swallows DB errors during releaseAcrossTabs after releasing in-memory claims", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      anchorClaimService.claim("anchor-1", "sync");
      vi.mocked(db.timeanchors.get).mockRejectedValueOnce(
        new Error("DB release error"),
      );

      await expect(
        anchorClaimService.releaseAcrossTabs(["anchor-1"], "tok-1", "sync"),
      ).resolves.toBeUndefined();

      expect(anchorClaimService.isClaimed("anchor-1")).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[AnchorClaimService] Failed to release DB anchor claim:",
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });

    it("skips DB persistence in releaseAcrossTabs when token is null or anchorIds is empty", async () => {
      anchorClaimService.claim("anchor-1", "sync");
      await anchorClaimService.releaseAcrossTabs(["anchor-1"], null, "sync");
      expect(anchorClaimService.isClaimed("anchor-1")).toBe(false);
      expect(db.timeanchors.get).not.toHaveBeenCalled();

      await anchorClaimService.releaseAcrossTabs([], "tok-1", "sync");
      expect(db.timeanchors.get).not.toHaveBeenCalled();
    });
  });

  describe("markAmbiguousAcrossTabs and clearAmbiguousAcrossTabs", () => {
    it("marks only unsynced anchors as ambiguous in DB and clears them cleanly", async () => {
      const anchorsById = new Map<string, TimeAnchor>([
        [
          "a-unsynced",
          {
            id: "a-unsynced",
            matchId: "m1",
            periodNumber: 1,
            type: 1,
            timestamp: "2026-11-19T19:00:00.000Z",
            sequenceNumber: 1,
            isSynced: 0,
          },
        ],
        [
          "a-synced",
          {
            id: "a-synced",
            matchId: "m1",
            periodNumber: 1,
            type: 1,
            timestamp: "2026-11-19T19:05:00.000Z",
            sequenceNumber: 2,
            isSynced: 1,
          },
        ],
      ]);

      vi.mocked(db.timeanchors.get).mockImplementation((async (id: string) =>
        anchorsById.get(id)) as never);
      vi.mocked(db.timeanchors.update).mockImplementation((async (
        id: string,
        changes: Partial<TimeAnchor>,
      ) => {
        const current = anchorsById.get(id);
        if (current) {
          anchorsById.set(id, { ...current, ...changes });
        }
        return 1;
      }) as never);

      // Blank IDs are ignored
      await anchorClaimService.markAmbiguousAcrossTabs(["", "   "]);
      expect(db.timeanchors.get).not.toHaveBeenCalled();

      await anchorClaimService.markAmbiguousAcrossTabs([
        "a-unsynced",
        "a-synced",
        "a-missing",
      ]);

      expect(anchorsById.get("a-unsynced")?.syncOutcomeAmbiguous).toBe(true);
      expect(anchorsById.get("a-synced")?.syncOutcomeAmbiguous).toBeUndefined();
      expect(anchorClaimService.hasAmbiguousOutcome({ id: "a-unsynced" })).toBe(
        true,
      );

      // Clear ambiguous state
      await anchorClaimService.clearAmbiguousAcrossTabs(["", "   "]);
      await anchorClaimService.clearAmbiguousAcrossTabs([
        "a-unsynced",
        "a-synced",
      ]);

      expect(
        anchorsById.get("a-unsynced")?.syncOutcomeAmbiguous,
      ).toBeUndefined();
      expect(anchorClaimService.hasAmbiguousOutcome({ id: "a-unsynced" })).toBe(
        false,
      );
    });

    it("logs and swallows DB errors in clearAmbiguousAcrossTabs", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(db.timeanchors.get).mockRejectedValueOnce(
        new Error("Clear ambiguous DB error"),
      );

      await expect(
        anchorClaimService.clearAmbiguousAcrossTabs(["a-err"]),
      ).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[AnchorClaimService] Failed to clear ambiguous sync state:",
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe("fallbacks for non-transactional DB, missing timeanchors table, and token generation", () => {
    it("operates in-memory when db.timeanchors methods are unavailable", async () => {
      const originalGet = db.timeanchors.get;
      (db.timeanchors as unknown as { get?: unknown }).get = undefined;

      try {
        const res = await anchorClaimService.claimAcrossTabs(["a1"], "sync");
        expect(res.allClaimed).toBe(true);
        expect(res.claimedIds).toEqual(["a1"]);
        expect(res.token).toEqual(expect.any(String));

        await anchorClaimService.markAmbiguousAcrossTabs(["a1"]);
        expect(anchorClaimService.hasAmbiguousOutcome({ id: "a1" })).toBe(true);

        await anchorClaimService.clearAmbiguousAcrossTabs(["a1"]);
        expect(anchorClaimService.hasAmbiguousOutcome({ id: "a1" })).toBe(
          false,
        );

        await anchorClaimService.releaseAcrossTabs(["a1"], res.token, "sync");
        expect(anchorClaimService.isClaimed("a1")).toBe(false);
      } finally {
        db.timeanchors.get = originalGet;
      }
    });

    it("executes work directly when db.transaction is not a function", async () => {
      const originalTx = db.transaction;
      (db as unknown as { transaction?: unknown }).transaction = undefined;
      vi.mocked(db.timeanchors.get).mockResolvedValue({
        id: "a-notx",
        isSynced: 0,
      } as TimeAnchor);

      try {
        const res = await anchorClaimService.claimAcrossTabs(
          ["a-notx"],
          "undo",
        );
        expect(res.allClaimed).toBe(true);
        expect(db.timeanchors.update).toHaveBeenCalledTimes(1);
      } finally {
        db.transaction = originalTx;
      }
    });

    it("supports crypto.getRandomValues and counter fallbacks when crypto.randomUUID is unavailable", async () => {
      const originalGet = db.timeanchors.get;
      (db.timeanchors as unknown as { get?: unknown }).get = undefined;

      try {
        // 1. crypto.getRandomValues fallback
        vi.stubGlobal("crypto", {
          getRandomValues: (arr: Uint8Array) => {
            arr.fill(0xab);
            return arr;
          },
        });

        const resHex = await anchorClaimService.claimAcrossTabs(
          ["a-hex"],
          "sync",
        );
        expect(resHex.token).toBe(`claim-${"ab".repeat(16)}`);

        // 2. Counter fallback when crypto is undefined
        vi.stubGlobal("crypto", undefined);

        const resCounter1 = await anchorClaimService.claimAcrossTabs(
          ["a-cnt-1"],
          "sync",
        );
        const resCounter2 = await anchorClaimService.claimAcrossTabs(
          ["a-cnt-2"],
          "sync",
        );
        expect(resCounter1.token).toMatch(/^claim-\d+-1$/);
        expect(resCounter2.token).toMatch(/^claim-\d+-2$/);
      } finally {
        db.timeanchors.get = originalGet;
      }
    });
  });
});
