import { describe, it, expect } from "vitest";
import type {
  EventDefinitionLookup,
  GameEvent,
  PlayerPresence,
} from "../../../db/ttaDatabase";
import {
  calculateDisciplinaryState,
  resolveEffectiveDisciplinaryRule,
  sortEventsChronologically,
} from "../utils/disciplinaryUtils";

const makeEvent = (overrides: Partial<GameEvent> & { id: string }): GameEvent => ({
  id: overrides.id,
  matchLineupId: overrides.matchLineupId ?? "p1",
  eventDefinitionId: overrides.eventDefinitionId ?? "def-1",
  periodNumber: overrides.periodNumber ?? 1,
  eventTimestamp: overrides.eventTimestamp ?? "2026-11-20T10:01:00.000Z",
  isLeadToGoal: overrides.isLeadToGoal ?? false,
  locationX: overrides.locationX ?? null,
  locationY: overrides.locationY ?? null,
  shotLocationX: overrides.shotLocationX ?? null,
  shotLocationY: overrides.shotLocationY ?? null,
  score: overrides.score,
  foulImpact: overrides.foulImpact,
  penaltyDurationSeconds: overrides.penaltyDurationSeconds,
  createdAt: overrides.createdAt ?? "2026-11-20T10:01:00.000Z",
  sequenceNumber: overrides.sequenceNumber ?? 1,
  isSynced: overrides.isSynced ?? 0,
});

const makePresence = (
  overrides: Partial<PlayerPresence> & { id: string; matchLineupId: string },
): PlayerPresence => ({
  id: overrides.id,
  matchLineupId: overrides.matchLineupId,
  periodNumber: overrides.periodNumber ?? 1,
  timeIn: overrides.timeIn ?? "2026-11-20T10:00:00.000Z",
  timeOut: overrides.timeOut ?? null,
  sequenceNumber: overrides.sequenceNumber ?? 1,
  isSynced: overrides.isSynced ?? 0,
});

describe("disciplinaryUtils", () => {
  describe("resolveEffectiveDisciplinaryRule", () => {
    it("should prefer immutable event snapshots over mutated definition values", () => {
      const definitions = new Map<string, EventDefinitionLookup>([
        [
          "def-foul",
          {
            id: "def-foul",
            sportId: "s-1",
            name: "Foul",
            shortName: "FL",
            isPositive: false,
            isShot: false,
            foulImpact: "DisqualificationNoSub",
            penaltyDurationSeconds: 240,
          },
        ],
      ]);

      const event = makeEvent({
        id: "ev-1",
        eventDefinitionId: "def-foul",
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
      });

      const resolved = resolveEffectiveDisciplinaryRule(event, definitions);
      expect(resolved).toEqual({
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
      });

      const explicitNonFoulSnapshot = makeEvent({
        id: "ev-2",
        eventDefinitionId: "def-foul",
        foulImpact: "None",
        penaltyDurationSeconds: null,
      });

      expect(
        resolveEffectiveDisciplinaryRule(explicitNonFoulSnapshot, definitions),
      ).toEqual({
        foulImpact: "None",
        penaltyDurationSeconds: null,
      });
    });

    it("should fall back to definition lookup when legacy event lacks snapshot fields", () => {
      const definitions = new Map<string, EventDefinitionLookup>([
        [
          "def-ex",
          {
            id: "def-ex",
            sportId: "s-1",
            name: "Exclusion",
            shortName: "EX",
            isPositive: false,
            isShot: false,
            foulImpact: "PersonalFoul",
            penaltyDurationSeconds: 20,
          },
        ],
      ]);

      const legacyEvent = makeEvent({
        id: "ev-legacy",
        eventDefinitionId: "def-ex",
      });

      expect(resolveEffectiveDisciplinaryRule(legacyEvent, definitions)).toEqual({
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
      });
    });

    it("should default to None and null penaltyDurationSeconds when neither snapshot nor definition has disciplinary fields", () => {
      const plainEvent = makeEvent({
        id: "ev-plain",
        penaltyDurationSeconds: 0,
      });
      expect(resolveEffectiveDisciplinaryRule(plainEvent)).toEqual({
        foulImpact: "None",
        penaltyDurationSeconds: null,
      });
    });
  });

  describe("sortEventsChronologically", () => {
    it("should sort by periodNumber, eventTimestamp, sequenceNumber, and id", () => {
      const events = [
        makeEvent({
          id: "e-b",
          periodNumber: 1,
          eventTimestamp: "2026-11-20T10:02:00.000Z",
          sequenceNumber: 2,
        }),
        makeEvent({
          id: "e-a",
          periodNumber: 1,
          eventTimestamp: "2026-11-20T10:02:00.000Z",
          sequenceNumber: 2,
        }),
        makeEvent({
          id: "e-early-seq",
          periodNumber: 1,
          eventTimestamp: "2026-11-20T10:02:00.000Z",
          sequenceNumber: 1,
        }),
        makeEvent({
          id: "e-p2",
          periodNumber: 2,
          eventTimestamp: "2026-11-20T10:00:00.000Z",
          sequenceNumber: 1,
        }),
      ];

      const sorted = sortEventsChronologically(events);
      expect(sorted.map((e) => e.id)).toEqual([
        "e-early-seq",
        "e-a",
        "e-b",
        "e-p2",
      ]);
    });

    it("should sort and match timestamps across equivalent ISO and timezone offset formats by parsed epoch milliseconds", () => {
      // 10:01:00.000Z === 12:01:00.000+02:00 (epoch 1795168860000)
      // 10:01:30.000Z === 12:01:30.000+02:00 (epoch 1795168890000)
      const events = [
        makeEvent({
          id: "e-later-utc",
          periodNumber: 1,
          matchLineupId: "p2",
          eventTimestamp: "2026-11-20T10:02:00.000Z",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: null,
          sequenceNumber: 3,
        }),
        makeEvent({
          id: "e-second-timed-utc",
          periodNumber: 1,
          matchLineupId: "p5",
          eventTimestamp: "2026-11-20T10:01:10.000Z",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          sequenceNumber: 2,
        }),
        makeEvent({
          id: "e-earlier-offset",
          periodNumber: 1,
          matchLineupId: "p1",
          eventTimestamp: "2026-11-20T12:01:00.000+02:00",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          sequenceNumber: 1,
        }),
      ];

      const sorted = sortEventsChronologically(events);
      expect(sorted.map((e) => e.id)).toEqual([
        "e-earlier-offset",
        "e-second-timed-utc",
        "e-later-utc",
      ]);

      // Presence exit and 1-for-1 entry encoded in differing ISO/offset formats at the exact same instant
      const presences = [
        makePresence({
          id: "pr-1",
          matchLineupId: "p1",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 1,
        }),
        makePresence({
          id: "pr-5",
          matchLineupId: "p5",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:10.000Z",
          sequenceNumber: 2,
        }),
        makePresence({
          id: "pr-2",
          matchLineupId: "p2",
          timeIn: "2026-11-20T12:00:00.000+02:00",
          timeOut: "2026-11-20T10:01:30.000Z",
          sequenceNumber: 3,
        }),
        makePresence({
          id: "pr-3",
          matchLineupId: "p3",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: null,
          sequenceNumber: 4,
        }),
        makePresence({
          id: "pr-4-sub-offset",
          matchLineupId: "p4",
          timeIn: "2026-11-20T12:01:30.000+02:00",
          timeOut: null,
          sequenceNumber: 5,
        }),
      ];

      const state = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds: ["p1", "p2", "p3", "p4", "p5"],
        events,
        presences,
      });

      // Because pr-4-sub-offset (12:01:30+02:00) matches pr-2's exit (10:01:30Z) as a 1-for-1 substitution,
      // both p1's and p5's timed penalties remain unserved (unservedTimedPenaltyCount === 2).
      expect(state.unservedTimedPenaltyCount).toBe(2);
      expect(state.playersById["p1"].hasActiveTimedExclusion).toBe(true);
      expect(state.playersById["p5"].hasActiveTimedExclusion).toBe(true);

      // Conversely, when pr-4 enters at a non-matching timestamp (unmatched bench entry),
      // active after entry is 2 (p3 + p4) so the queue trims from 2 down to 1.
      const stateWithUnmatchedBenchEntry = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds: ["p1", "p2", "p3", "p4", "p5"],
        events,
        presences: [
          ...presences.slice(0, 4),
          makePresence({
            id: "pr-4-unmatched-offset",
            matchLineupId: "p4",
            timeIn: "2026-11-20T12:01:31.000+02:00",
            timeOut: null,
            sequenceNumber: 5,
          }),
        ],
      });

      expect(stateWithUnmatchedBenchEntry.unservedTimedPenaltyCount).toBe(1);
    });

    it("should normalize and match .NET System.Text.Json 7-digit fractional tick timestamps against 3-digit ISO timestamps", () => {
      // .NET DateTime / DateTimeOffset serialization emits up to 7 fractional digits (100ns ticks)
      const events = [
        makeEvent({
          id: "e-dotnet-ticks-1",
          periodNumber: 1,
          matchLineupId: "p1",
          eventTimestamp: "2026-11-20T10:01:00.1234567Z",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          sequenceNumber: 1,
        }),
        makeEvent({
          id: "e-dotnet-ticks-2",
          periodNumber: 1,
          matchLineupId: "p5",
          eventTimestamp: "2026-11-20T10:01:10.7654321Z",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          sequenceNumber: 2,
        }),
      ];

      const presences = [
        makePresence({
          id: "pr-1",
          matchLineupId: "p1",
          timeIn: "2026-11-20T10:00:00Z",
          timeOut: "2026-11-20T10:01:00.1234567Z",
          sequenceNumber: 1,
        }),
        makePresence({
          id: "pr-5",
          matchLineupId: "p5",
          timeIn: "2026-11-20T10:00:00Z",
          timeOut: "2026-11-20T10:01:10.7654321Z",
          sequenceNumber: 2,
        }),
        makePresence({
          id: "pr-2",
          matchLineupId: "p2",
          timeIn: "2026-11-20T10:00:00.0000000+00:00",
          timeOut: "2026-11-20T10:01:30.5000000Z",
          sequenceNumber: 3,
        }),
        makePresence({
          id: "pr-3",
          matchLineupId: "p3",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: null,
          sequenceNumber: 4,
        }),
        // Client-recorded 3-digit millisecond timestamp matching server 7-digit tick exit
        makePresence({
          id: "pr-4-sub",
          matchLineupId: "p4",
          timeIn: "2026-11-20T12:01:30.500+02:00",
          timeOut: null,
          sequenceNumber: 5,
        }),
      ];

      const state = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds: ["p1", "p2", "p3", "p4", "p5"],
        events,
        presences,
      });

      expect(state.unservedTimedPenaltyCount).toBe(2);
      expect(state.playersById["p1"].hasActiveTimedExclusion).toBe(true);
      expect(state.playersById["p5"].hasActiveTimedExclusion).toBe(true);

      // Unmatched bench entry reduces the 2-penalty queue to 1
      const stateWithUnmatchedBenchEntry = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds: ["p1", "p2", "p3", "p4", "p5"],
        events,
        presences: [
          ...presences.slice(0, 4),
          makePresence({
            id: "pr-4-unmatched",
            matchLineupId: "p4",
            timeIn: "2026-11-20T12:01:31.500+02:00",
            timeOut: null,
            sequenceNumber: 5,
          }),
        ],
      });

      expect(stateWithUnmatchedBenchEntry.unservedTimedPenaltyCount).toBe(1);
    });
  });

  describe("personal fouls, warnings, and foul-out DQ", () => {
    const lineupIds = ["p1", "p2", "p3"];

    it("should track personal fouls, emit warning at maxPersonalFouls - 1, and DQ at maxPersonalFouls", () => {
      const events = [
        makeEvent({
          id: "e1",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: null,
          sequenceNumber: 1,
        }),
        makeEvent({
          id: "e2",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: null,
          sequenceNumber: 2,
        }),
        makeEvent({
          id: "e3",
          matchLineupId: "p2",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: null,
          sequenceNumber: 3,
        }),
        makeEvent({
          id: "e4",
          matchLineupId: "p2",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: null,
          sequenceNumber: 4,
        }),
        makeEvent({
          id: "e5",
          matchLineupId: "p2",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: null,
          sequenceNumber: 5,
        }),
      ];

      const state = calculateDisciplinaryState({
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
        lineupIds,
        events,
        presences: [],
      });

      expect(state.playersById["p1"]).toMatchObject({
        personalFoulCount: 2,
        hasFoulWarning: true,
        isDisqualified: false,
        disqualificationReason: null,
      });
      expect(state.playersById["p2"]).toMatchObject({
        personalFoulCount: 3,
        hasFoulWarning: false,
        isDisqualified: true,
        disqualificationReason: "PersonalFoulLimit",
      });
      expect(state.unservedTimedPenaltyCount).toBe(0);
      expect(state.maxAllowedActive).toBe(7);
    });

    it("should apply timed team penalty AND DQ player when foul-out triggering event has penaltyDurationSeconds > 0", () => {
      const events = [
        makeEvent({
          id: "e1",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          eventTimestamp: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 1,
        }),
        makeEvent({
          id: "e2",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: null,
          eventTimestamp: "2026-11-20T10:02:00.000Z",
          sequenceNumber: 2,
        }),
        makeEvent({
          id: "e3",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          eventTimestamp: "2026-11-20T10:03:00.000Z",
          sequenceNumber: 3,
        }),
      ];

      const presences = [
        makePresence({
          id: "pr-p1-1",
          matchLineupId: "p1",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 1,
        }),
        makePresence({
          id: "pr-p2-1",
          matchLineupId: "p2",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: null,
          sequenceNumber: 2,
        }),
        makePresence({
          id: "pr-p1-reenter",
          matchLineupId: "p1",
          timeIn: "2026-11-20T10:01:25.000Z",
          timeOut: "2026-11-20T10:03:00.000Z",
          sequenceNumber: 3,
        }),
      ];

      const state = calculateDisciplinaryState({
        activePlayersLimit: 2,
        maxPersonalFouls: 3,
        lineupIds,
        events,
        presences,
      });

      expect(state.playersById["p1"]).toMatchObject({
        personalFoulCount: 3,
        isDisqualified: true,
        disqualificationReason: "PersonalFoulLimit",
        hasActiveTimedExclusion: true,
        activeTimedExclusionCount: 1,
      });
      expect(state.activeTimedPenalties).toHaveLength(1);
      expect(state.activeTimedPenalties[0].eventId).toBe("e3");
    });

    it("should allow unlimited personal fouls with no counters, warnings, or foul-out DQ when maxPersonalFouls is null", () => {
      const events = Array.from({ length: 6 }, (_, idx) =>
        makeEvent({
          id: `foul-${idx}`,
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: null,
          sequenceNumber: idx + 1,
        }),
      );

      const state = calculateDisciplinaryState({
        activePlayersLimit: 11,
        maxPersonalFouls: null,
        lineupIds: ["p1"],
        events,
        presences: [],
      });

      expect(state.maxPersonalFouls).toBeNull();
      expect(state.isMaxPersonalFoulsKnown).toBe(true);
      expect(state.playersById["p1"]).toMatchObject({
        personalFoulCount: 0,
        hasFoulWarning: false,
        isDisqualified: false,
        disqualificationReason: null,
      });
    });

    it("should distinguish unknown maxPersonalFouls (undefined) from explicit unlimited (null) by tracking personalFoulCount while reporting isMaxPersonalFoulsKnown: false", () => {
      const events = Array.from({ length: 4 }, (_, idx) =>
        makeEvent({
          id: `foul-unknown-${idx}`,
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: null,
          sequenceNumber: idx + 1,
        }),
      );

      const unknownLimitState = calculateDisciplinaryState({
        activePlayersLimit: 7,
        maxPersonalFouls: undefined,
        lineupIds: ["p1"],
        events,
        presences: [],
      });

      expect(unknownLimitState.maxPersonalFouls).toBeUndefined();
      expect(unknownLimitState.isMaxPersonalFoulsKnown).toBe(false);
      expect(unknownLimitState.playersById["p1"]).toMatchObject({
        personalFoulCount: 4,
        hasFoulWarning: false,
        isDisqualified: false,
        disqualificationReason: null,
      });
    });

    it("should not display warning when maxPersonalFouls is 1 (immediate foul-out on first foul)", () => {
      const stateBefore = calculateDisciplinaryState({
        activePlayersLimit: 5,
        maxPersonalFouls: 1,
        lineupIds: ["p1"],
        events: [],
        presences: [],
      });
      expect(stateBefore.playersById["p1"].hasFoulWarning).toBe(false);

      const stateAfter = calculateDisciplinaryState({
        activePlayersLimit: 5,
        maxPersonalFouls: 1,
        lineupIds: ["p1"],
        events: [
          makeEvent({
            id: "e1",
            matchLineupId: "p1",
            foulImpact: "PersonalFoul",
          }),
        ],
        presences: [],
      });
      expect(stateAfter.playersById["p1"].isDisqualified).toBe(true);
      expect(stateAfter.playersById["p1"].hasFoulWarning).toBe(false);
    });
  });

  describe("DisqualificationWithSub and DisqualificationNoSub", () => {
    it("should handle DisqualificationWithSub with null duration (immediate sub allowed) and with > 0 duration (timed shorthanded)", () => {
      const events = [
        makeEvent({
          id: "dq-sub-immediate",
          matchLineupId: "p1",
          foulImpact: "DisqualificationWithSub",
          penaltyDurationSeconds: null,
          sequenceNumber: 1,
        }),
        makeEvent({
          id: "dq-sub-timed",
          matchLineupId: "p2",
          foulImpact: "DisqualificationWithSub",
          penaltyDurationSeconds: 240,
          sequenceNumber: 2,
        }),
      ];

      const state = calculateDisciplinaryState({
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
        lineupIds: ["p1", "p2", "p3"],
        events,
        presences: [],
      });

      expect(state.playersById["p1"]).toMatchObject({
        isDisqualified: true,
        disqualificationReason: "DisqualificationWithSub",
        hasActiveTimedExclusion: false,
      });
      expect(state.playersById["p2"]).toMatchObject({
        isDisqualified: true,
        disqualificationReason: "DisqualificationWithSub",
        hasActiveTimedExclusion: true,
        activeTimedExclusionCount: 1,
      });
      expect(state.maxAllowedActive).toBe(7);
      expect(state.unservedTimedPenaltyCount).toBe(1);
    });

    it("should handle DisqualificationNoSub with null duration (permanent maxAllowedActive reduction) and > 0 duration (timed penalty)", () => {
      const events = [
        makeEvent({
          id: "red-card-permanent",
          matchLineupId: "p1",
          foulImpact: "DisqualificationNoSub",
          penaltyDurationSeconds: null,
          sequenceNumber: 1,
        }),
        makeEvent({
          id: "brutality-timed",
          matchLineupId: "p2",
          foulImpact: "DisqualificationNoSub",
          penaltyDurationSeconds: 240,
          sequenceNumber: 2,
        }),
      ];

      const state = calculateDisciplinaryState({
        activePlayersLimit: 11,
        maxPersonalFouls: null,
        lineupIds: ["p1", "p2", "p3"],
        events,
        presences: [],
        activeLineupIds: Array.from({ length: 9 }, (_, i) => `a-${i}`),
      });

      expect(state.permanentNoSubCount).toBe(1);
      expect(state.maxAllowedActive).toBe(10);
      expect(state.unservedTimedPenaltyCount).toBe(1);
      expect(state.isShorthanded).toBe(true);
      expect(state.shorthandedSlotsAvailable).toBe(1);
      expect(state.playersById["p1"].isDisqualified).toBe(true);
      expect(state.playersById["p2"].isDisqualified).toBe(true);
      expect(state.playersById["p2"].hasActiveTimedExclusion).toBe(true);
    });

    it("should deduplicate repeated null-duration DisqualificationNoSub events for the same player so maxAllowedActive is reduced at most once per player", () => {
      const events = [
        makeEvent({
          id: "red-card-p1-first",
          matchLineupId: "p1",
          foulImpact: "DisqualificationNoSub",
          penaltyDurationSeconds: null,
          sequenceNumber: 1,
        }),
        makeEvent({
          id: "red-card-p1-duplicate",
          matchLineupId: "p1",
          foulImpact: "DisqualificationNoSub",
          penaltyDurationSeconds: null,
          sequenceNumber: 2,
        }),
      ];

      const state = calculateDisciplinaryState({
        activePlayersLimit: 11,
        maxPersonalFouls: null,
        lineupIds: ["p1", "p2", "p3"],
        events,
        presences: [],
        activeLineupIds: Array.from({ length: 9 }, (_, i) => `a-${i}`),
      });

      expect(state.permanentNoSubCount).toBe(1);
      expect(state.maxAllowedActive).toBe(10);
      expect(state.isShorthanded).toBe(true);
      expect(state.shorthandedSlotsAvailable).toBe(1);
      expect(state.playersById["p1"].isDisqualified).toBe(true);
    });
  });

  describe("FIFO penalty serving, capacity invariant, and opponent goals", () => {
    const lineupIds = ["p1", "p2", "p3", "p4", "p5"];

    it("should never auto-clear timed penalties when an opponent scores (isPositive === false && score > 0)", () => {
      const events = [
        makeEvent({
          id: "ex-1",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          eventTimestamp: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 1,
        }),
        makeEvent({
          id: "opp-goal",
          matchLineupId: "p2",
          foulImpact: "None",
          penaltyDurationSeconds: null,
          score: 1,
          eventTimestamp: "2026-11-20T10:01:10.000Z",
          sequenceNumber: 2,
        }),
      ];

      const definitions = new Map<string, EventDefinitionLookup>([
        [
          "def-opp-goal",
          {
            id: "def-opp-goal",
            sportId: "s-1",
            name: "Goal Conceded",
            shortName: "GC",
            isPositive: false,
            isShot: false,
            score: 1,
          },
        ],
      ]);
      events[1].eventDefinitionId = "def-opp-goal";

      const state = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds,
        events,
        presences: [],
        definitionsById: definitions,
      });

      expect(state.unservedTimedPenaltyCount).toBe(1);
      expect(state.playersById["p1"].hasActiveTimedExclusion).toBe(true);
    });

    it("should not consume unserved timed penalties during normal 1-for-1 substitutions", () => {
      const presences = [
        makePresence({
          id: "pr-1",
          matchLineupId: "p1",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 1,
        }),
        makePresence({
          id: "pr-2",
          matchLineupId: "p2",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:30.000Z",
          sequenceNumber: 2,
        }),
        makePresence({
          id: "pr-3",
          matchLineupId: "p3",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: null,
          sequenceNumber: 3,
        }),
        // 1-for-1 sub: p2 out at 10:01:30, p4 in at 10:01:30
        makePresence({
          id: "pr-4",
          matchLineupId: "p4",
          timeIn: "2026-11-20T10:01:30.000Z",
          timeOut: null,
          sequenceNumber: 5,
        }),
      ];

      const events = [
        makeEvent({
          id: "ex-p1",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          eventTimestamp: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 4,
        }),
      ];

      const state = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds,
        events,
        presences,
      });

      expect(state.unservedTimedPenaltyCount).toBe(1);
      expect(state.playersById["p1"].hasActiveTimedExclusion).toBe(true);
    });

    it("should clear the specific excluded player's penalty if they re-enter, or oldest FIFO when another player enters", () => {
      const presences = [
        makePresence({
          id: "pr-1",
          matchLineupId: "p1",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 1,
        }),
        makePresence({
          id: "pr-2",
          matchLineupId: "p2",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:10.000Z",
          sequenceNumber: 2,
        }),
        makePresence({
          id: "pr-3",
          matchLineupId: "p3",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: null,
          sequenceNumber: 3,
        }),
        // p4 enters at 10:01:25 (serves oldest FIFO penalty -> p1's exclusion)
        makePresence({
          id: "pr-4",
          matchLineupId: "p4",
          timeIn: "2026-11-20T10:01:25.000Z",
          timeOut: null,
          sequenceNumber: 6,
        }),
      ];

      const events = [
        makeEvent({
          id: "ex-p1",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          eventTimestamp: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 4,
        }),
        makeEvent({
          id: "ex-p2",
          matchLineupId: "p2",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          eventTimestamp: "2026-11-20T10:01:10.000Z",
          sequenceNumber: 5,
        }),
      ];

      const stateAfterSubstituteEntry = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds,
        events,
        presences,
      });

      expect(stateAfterSubstituteEntry.unservedTimedPenaltyCount).toBe(1);
      expect(
        stateAfterSubstituteEntry.playersById["p1"].hasActiveTimedExclusion,
      ).toBe(false);
      expect(
        stateAfterSubstituteEntry.playersById["p2"].hasActiveTimedExclusion,
      ).toBe(true);

      // When p2 themselves re-enters instead of p4, p2's penalty is served specifically while p1's penalty remains active
      const presencesWithP2ReEntry = [
        presences[0],
        presences[1],
        presences[2],
        makePresence({
          id: "pr-p2-reenter",
          matchLineupId: "p2",
          timeIn: "2026-11-20T10:01:25.000Z",
          timeOut: null,
          sequenceNumber: 6,
        }),
      ];

      const stateAfterSpecificPlayerReEntry = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds,
        events,
        presences: presencesWithP2ReEntry,
      });

      expect(stateAfterSpecificPlayerReEntry.unservedTimedPenaltyCount).toBe(1);
      expect(
        stateAfterSpecificPlayerReEntry.playersById["p1"]
          .hasActiveTimedExclusion,
      ).toBe(true);
      expect(
        stateAfterSpecificPlayerReEntry.playersById["p2"]
          .hasActiveTimedExclusion,
      ).toBe(false);
    });

    it("should evaluate same-timestamp mid-period entries sequentially by chronological sequence position", () => {
      // Limit = 3. p1, p2, p3 start.
      // 10:01:00 -> p1 gets timed exclusion (20s) and exits.
      // 10:01:05 -> p2 gets non-timed DQ with sub and exits (active = 1, unserved = 1).
      // 10:01:25 -> BOTH p4 (replacing DQ'd p2, seq 6) and p1 (returning from exclusion, seq 7) enter at the exact same timestamp!
      // At p4's entry (index before p1's entry), active count is 2 (p3 + p4) -> capacity max(0, 3 - 2) = 1 -> p1's penalty is not yet cleared.
      // At p1's entry (seq 7), active count reaches 3 (p3 + p4 + p1) -> capacity max(0, 3 - 3) = 0 -> p1's penalty is served!
      // Also test if only p4 enters at 10:01:25 (seq 6) and p5 enters at 10:01:25 (seq 7) when 2 timed penalties [p1, p2] are active:
      // 1st entry (seq 6) sees activeCount = 2 -> serves 1st penalty (p1); 2nd entry (seq 7) sees activeCount = 3 -> serves 2nd penalty (p2).
      const events = [
        makeEvent({
          id: "ex-p1",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          eventTimestamp: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 4,
        }),
        makeEvent({
          id: "ex-p2",
          matchLineupId: "p2",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          eventTimestamp: "2026-11-20T10:01:05.000Z",
          sequenceNumber: 5,
        }),
      ];

      // Suppose p1 and p2 both exited, leaving only p3 active.
      // At 10:01:25, p2 re-enters first (seq 6), and if we only had p2 re-entering at 10:01:25 while another future entry at the same timestamp existed:
      // Wait: if p2 re-enters at 10:01:25 (seq 6) and p4 enters at 10:01:25 (seq 7):
      // At seq 6 (p2), active count is 2 (p3 + p2) -> capacity max(0, 3 - 2) = 1 -> serves p2's penalty specifically (leaving [p1]).
      // If activeCountAtTimestamp had counted future entries at the same timestamp (seeing 3 active at seq 6), seq 6 would have trimmed queue to 0 immediately!
      // To observe the exact difference at seq 6: suppose p4 exits right after or we inspect a case where p2 (seq 6) enters at 10:01:25 and p1 (seq 7) enters at 10:01:25.
      // Even better: suppose 2 penalties [p1, p2] are in queue, limit = 3. p1 and p2 exited at 10:01:00 and 10:01:05.
      // At 10:01:10, p3 also exits temporarily (e.g. injury/bench, timeOut = 10:01:20) so at 10:01:25 nobody is active except whoever enters.
      // At 10:01:25, p2 enters (seq 6) and p3 enters (seq 7).
      // Total active after both entries at 10:01:25 is 2 (p2 and p3).
      // Because limit = 3 and active = 2, maxUnservedByCapacity = 3 - 2 = 1. Only ONE penalty may be served!
      // At seq 6 (p2's entry), sequential counting sees active = 1 (p2) -> maxUnserved = 3 - 1 = 2 (no trim yet, queue still has 2).
      // At seq 7 (p3's entry), sequential counting sees active = 2 (p2, p3) -> maxUnserved = 3 - 2 = 1 -> trims 1 penalty!
      // Now compare: what if at 10:01:25 p3 enters first (seq 6) and p2 enters second (seq 7)?
      // With sequential counting:
      // - At seq 6 (p3 enters): active = 1 (p3) -> maxUnserved = 3 - 1 = 2 -> queue [p1, p2] is NOT trimmed yet!
      // - At seq 7 (p2 enters): active = 2 (p3, p2) -> maxUnserved = 3 - 2 = 1 -> p2 is the entrant that brings active to 2, so p2's penalty is served, leaving [p1]!
      // Without sequential counting (if seq 6 counted all entries at 10:01:25):
      // - At seq 6 (p3 enters), active would have been counted as 2 immediately, so p3's entry would have trimmed the queue using FIFO (serving p1 instead of p2)!
      const presences = [
        makePresence({
          id: "pr-1",
          matchLineupId: "p1",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 1,
        }),
        makePresence({
          id: "pr-2",
          matchLineupId: "p2",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:05.000Z",
          sequenceNumber: 2,
        }),
        makePresence({
          id: "pr-3",
          matchLineupId: "p3",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:10.000Z",
          sequenceNumber: 3,
        }),
        makePresence({
          id: "pr-3-return",
          matchLineupId: "p3",
          timeIn: "2026-11-20T10:01:25.000Z",
          timeOut: null,
          sequenceNumber: 6,
        }),
        makePresence({
          id: "pr-2-return",
          matchLineupId: "p2",
          timeIn: "2026-11-20T10:01:25.000Z",
          timeOut: null,
          sequenceNumber: 7,
        }),
      ];

      const state = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds,
        events,
        presences,
      });

      expect(state.unservedTimedPenaltyCount).toBe(1);
      expect(state.playersById["p1"].hasActiveTimedExclusion).toBe(true);
      expect(state.playersById["p2"].hasActiveTimedExclusion).toBe(false);
    });

    it("should enforce capacity invariant so immediate replacement for a non-timed DQ while another timed penalty is active does NOT clear the timed penalty", () => {
      // Limit = 3. p1, p2, p3 start.
      // 10:01:00 -> p1 gets timed exclusion (20s) and exits (active = 2, unserved = 1).
      // 10:01:05 -> p2 gets non-timed foul-out / DisqualificationWithSub (null duration) and exits (active = 1, unserved = 1).
      // 10:01:10 -> p4 enters from bench to replace p2 (activeCountAfterEntry = 2).
      // Capacity invariant: min(1, max(0, 3 - 2)) = min(1, 1) = 1 -> p1's timed penalty remains unserved!
      const presences = [
        makePresence({
          id: "pr-1",
          matchLineupId: "p1",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 1,
        }),
        makePresence({
          id: "pr-2",
          matchLineupId: "p2",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: "2026-11-20T10:01:05.000Z",
          sequenceNumber: 2,
        }),
        makePresence({
          id: "pr-3",
          matchLineupId: "p3",
          timeIn: "2026-11-20T10:00:00.000Z",
          timeOut: null,
          sequenceNumber: 3,
        }),
        makePresence({
          id: "pr-4",
          matchLineupId: "p4",
          timeIn: "2026-11-20T10:01:10.000Z",
          timeOut: null,
          sequenceNumber: 6,
        }),
      ];

      const events = [
        makeEvent({
          id: "ex-p1",
          matchLineupId: "p1",
          foulImpact: "PersonalFoul",
          penaltyDurationSeconds: 20,
          eventTimestamp: "2026-11-20T10:01:00.000Z",
          sequenceNumber: 4,
        }),
        makeEvent({
          id: "dq-p2",
          matchLineupId: "p2",
          foulImpact: "DisqualificationWithSub",
          penaltyDurationSeconds: null,
          eventTimestamp: "2026-11-20T10:01:05.000Z",
          sequenceNumber: 5,
        }),
      ];

      const stateAfterReplacement = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds,
        events,
        presences,
      });

      expect(stateAfterReplacement.unservedTimedPenaltyCount).toBe(1);
      expect(
        stateAfterReplacement.playersById["p1"].hasActiveTimedExclusion,
      ).toBe(true);

      // Now p1 re-enters at 10:01:25 bringing active count to 3 -> capacity max(0, 3 - 3) = 0 -> penalty is served!
      const stateAfterPenaltyServed = calculateDisciplinaryState({
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
        lineupIds,
        events,
        presences: [
          ...presences,
          makePresence({
            id: "pr-5",
            matchLineupId: "p1",
            timeIn: "2026-11-20T10:01:25.000Z",
            timeOut: null,
            sequenceNumber: 7,
          }),
        ],
      });

      expect(stateAfterPenaltyServed.unservedTimedPenaltyCount).toBe(0);
      expect(
        stateAfterPenaltyServed.playersById["p1"].hasActiveTimedExclusion,
      ).toBe(false);
    });
  });
});
