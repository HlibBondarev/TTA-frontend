import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  deleteMatchLocally,
  clearAllLocalMatchData,
} from "../../services/matchCleanupService";
import { db } from "../../db/ttaDatabase";

vi.mock("../../db/ttaDatabase", () => ({
  db: {
    transaction: vi.fn((...args: unknown[]) => {
      const cb = args[args.length - 1] as () => Promise<unknown>;
      return cb() as unknown as ReturnType<typeof db.transaction>;
    }),
    matches: {
      delete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    matchlineups: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
      bulkDelete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    gameevents: {
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      bulkDelete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    timeanchors: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
      bulkDelete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    playerpresences: {
      filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      bulkDelete: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    syncQueue: {
      toArray: vi.fn().mockResolvedValue([]),
      bulkDelete: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe("Match Cleanup Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("deleteMatchLocally", () => {
    it("throws an error if matchId is empty or whitespace", async () => {
      await expect(deleteMatchLocally("")).rejects.toThrow(
        "Match ID is required for local cleanup.",
      );
      await expect(deleteMatchLocally("   ")).rejects.toThrow(
        "Match ID is required for local cleanup.",
      );
    });

    it("deletes all associated entities for a given match ID", async () => {
      const mockLineups = [
        { id: "lineup-1", matchId: "match-123" },
        { id: "lineup-2", matchId: "match-123" },
      ];
      const mockEvents = [
        { id: "event-1", matchLineupId: "lineup-1" },
        { id: "event-2", matchLineupId: "lineup-2" },
      ];
      const mockPresences = [{ id: "presence-1", matchLineupId: "lineup-1" }];
      const mockAnchors = [{ id: "anchor-1", matchId: "match-123" }];
      const mockSyncItems = [
        { id: 1, endpoint: "/Matches/match-123/events" },
        { id: 2, endpoint: "/Matches/other-match/events" },
      ];

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockLineups),
        }),
      } as unknown as ReturnType<typeof db.matchlineups.where>);

      vi.mocked(db.gameevents.filter).mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockEvents),
      } as unknown as ReturnType<typeof db.gameevents.filter>);

      vi.mocked(db.playerpresences.filter).mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockPresences),
      } as unknown as ReturnType<typeof db.playerpresences.filter>);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockAnchors),
        }),
      } as unknown as ReturnType<typeof db.timeanchors.where>);

      vi.mocked(db.syncQueue.toArray).mockResolvedValue(mockSyncItems as never);

      await deleteMatchLocally("match-123");

      expect(db.gameevents.bulkDelete).toHaveBeenCalledWith([
        "event-1",
        "event-2",
      ]);
      expect(db.playerpresences.bulkDelete).toHaveBeenCalledWith([
        "presence-1",
      ]);
      expect(db.timeanchors.bulkDelete).toHaveBeenCalledWith(["anchor-1"]);
      expect(db.matchlineups.bulkDelete).toHaveBeenCalledWith([
        "lineup-1",
        "lineup-2",
      ]);
      expect(db.matches.delete).toHaveBeenCalledWith("match-123");
      expect(db.syncQueue.bulkDelete).toHaveBeenCalledWith([1]);
    });

    it("preserves DELETE queue items when preserveDeleteQueueItems option is true", async () => {
      const mockSyncItems = [
        {
          id: 1,
          endpoint: "/Matches/match-123/teams/team-1/catch",
          actionType: "DELETE",
        },
        { id: 2, endpoint: "/Matches/match-123/events", actionType: "POST" },
      ];

      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.matchlineups.where>);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.timeanchors.where>);

      vi.mocked(db.syncQueue.toArray).mockResolvedValue(mockSyncItems as never);

      await deleteMatchLocally("match-123", { preserveDeleteQueueItems: true });

      expect(db.syncQueue.bulkDelete).toHaveBeenCalledWith([2]);
    });

    it("handles deletion gracefully when no entities exist for the match ID", async () => {
      vi.mocked(db.matchlineups.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.matchlineups.where>);

      vi.mocked(db.timeanchors.where).mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.timeanchors.where>);

      vi.mocked(db.syncQueue.toArray).mockResolvedValue([] as never);

      await deleteMatchLocally("empty-match");

      expect(db.matches.delete).toHaveBeenCalledWith("empty-match");
      expect(db.gameevents.bulkDelete).not.toHaveBeenCalled();
      expect(db.playerpresences.bulkDelete).not.toHaveBeenCalled();
      expect(db.timeanchors.bulkDelete).not.toHaveBeenCalled();
      expect(db.matchlineups.bulkDelete).not.toHaveBeenCalled();
      expect(db.syncQueue.bulkDelete).not.toHaveBeenCalled();
    });
  });

  describe("clearAllLocalMatchData", () => {
    it("clears all match tables and removes match items from syncQueue", async () => {
      const mockSyncItems = [
        { id: 10, endpoint: "/Matches/m1/events" },
        { id: 20, endpoint: "/Users/me/profile" },
      ];

      vi.mocked(db.syncQueue.toArray).mockResolvedValue(mockSyncItems as never);

      await clearAllLocalMatchData();

      expect(db.gameevents.clear).toHaveBeenCalled();
      expect(db.playerpresences.clear).toHaveBeenCalled();
      expect(db.timeanchors.clear).toHaveBeenCalled();
      expect(db.matchlineups.clear).toHaveBeenCalled();
      expect(db.matches.clear).toHaveBeenCalled();
      expect(db.syncQueue.bulkDelete).toHaveBeenCalledWith([10]);
    });
  });
});
