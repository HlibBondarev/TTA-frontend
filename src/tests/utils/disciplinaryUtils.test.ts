import { describe, it, expect } from "vitest";
import {
  DEFAULT_FOUL_IMPACT,
  resolveEventFoulImpact,
  resolveEventPenaltyDuration,
  isDisqualifyingFoulImpact,
  hasTimedPenalty,
  computePlayerDisciplinaryMap,
  shouldAutoRemoveActivePlayer,
} from "../../utils/disciplinaryUtils";
import type {
  EventDefinitionLookup,
  GameEvent,
  PlayerPresence,
} from "../../db/ttaDatabase";

const makeEvent = (overrides: Partial<GameEvent> = {}): GameEvent => ({
  id: "evt-1",
  matchLineupId: "lineup-1",
  eventDefinitionId: "def-1",
  periodNumber: 1,
  eventTimestamp: "2026-11-18T10:01:00.000Z",
  isLeadToGoal: false,
  createdAt: "2026-11-18T10:01:00.000Z",
  sequenceNumber: 2,
  isSynced: 0,
  ...overrides,
});

const makeDef = (
  overrides: Partial<EventDefinitionLookup> = {},
): EventDefinitionLookup => ({
  id: "def-1",
  sportId: "sport-1",
  name: "Exclusion Foul",
  shortName: "EX",
  isPositive: false,
  isShot: false,
  foulImpact: "PersonalFoul",
  penaltyDurationSeconds: 20,
  ...overrides,
});

const makePresence = (
  overrides: Partial<PlayerPresence> = {},
): PlayerPresence => ({
  id: "pres-1",
  matchLineupId: "lineup-1",
  periodNumber: 1,
  timeIn: "2026-11-18T10:00:00.000Z",
  timeOut: null,
  sequenceNumber: 1,
  isSynced: 0,
  ...overrides,
});

describe("disciplinaryUtils", () => {
  describe("resolveEventFoulImpact & resolveEventPenaltyDuration", () => {
    it("prefers event-level fields and falls back to definition then defaults", () => {
      const def = makeDef({
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
      });

      expect(
        resolveEventFoulImpact(
          { foulImpact: "DisqualificationNoSub" },
          def,
        ),
      ).toBe("DisqualificationNoSub");
      expect(resolveEventFoulImpact({}, def)).toBe("PersonalFoul");
      expect(resolveEventFoulImpact({}, undefined)).toBe(DEFAULT_FOUL_IMPACT);

      expect(
        resolveEventPenaltyDuration({ penaltyDurationSeconds: 240 }, def),
      ).toBe(240);
      expect(
        resolveEventPenaltyDuration({ penaltyDurationSeconds: null }, def),
      ).toBeNull();
      expect(resolveEventPenaltyDuration({}, def)).toBe(20);
      expect(resolveEventPenaltyDuration({}, undefined)).toBeNull();
    });

    it("identifies disqualifying impacts and positive penalty durations", () => {
      expect(isDisqualifyingFoulImpact("None")).toBe(false);
      expect(isDisqualifyingFoulImpact("PersonalFoul")).toBe(false);
      expect(isDisqualifyingFoulImpact("DisqualificationWithSub")).toBe(true);
      expect(isDisqualifyingFoulImpact("DisqualificationNoSub")).toBe(true);

      expect(hasTimedPenalty(null)).toBe(false);
      expect(hasTimedPenalty(undefined)).toBe(false);
      expect(hasTimedPenalty(0)).toBe(false);
      expect(hasTimedPenalty(-5)).toBe(false);
      expect(hasTimedPenalty(20)).toBe(true);
    });
  });

  describe("computePlayerDisciplinaryMap", () => {
    it("counts PersonalFoul events across all periods and triggers warning at maxPersonalFouls - 1 and DQ at maxPersonalFouls", () => {
      const defFoul = makeDef({
        id: "def-foul",
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: null,
      });
      const defNone = makeDef({
        id: "def-none",
        foulImpact: "None",
        penaltyDurationSeconds: null,
      });
      const defs = new Map([
        [defFoul.id, defFoul],
        [defNone.id, defNone],
      ]);

      const events: GameEvent[] = [
        makeEvent({
          id: "e1",
          matchLineupId: "p1",
          eventDefinitionId: "def-foul",
          periodNumber: 1,
          sequenceNumber: 2,
        }),
        makeEvent({
          id: "e2",
          matchLineupId: "p1",
          eventDefinitionId: "def-foul",
          periodNumber: 2,
          sequenceNumber: 5,
        }),
        makeEvent({
          id: "e3",
          matchLineupId: "p1",
          eventDefinitionId: "def-none",
          periodNumber: 2,
          sequenceNumber: 6,
        }),
        makeEvent({
          id: "e4",
          matchLineupId: "p2",
          eventDefinitionId: "def-foul",
          periodNumber: 1,
          sequenceNumber: 3,
        }),
        makeEvent({
          id: "e5",
          matchLineupId: "p2",
          eventDefinitionId: "def-foul",
          periodNumber: 1,
          sequenceNumber: 4,
        }),
        makeEvent({
          id: "e6",
          matchLineupId: "p2",
          eventDefinitionId: "def-foul",
          periodNumber: 2,
          sequenceNumber: 7,
        }),
      ];

      const map = computePlayerDisciplinaryMap({
        lineupIds: ["p1", "p2", "p3"],
        gameEvents: events,
        eventDefinitionsById: defs,
        periodPresences: [],
        currentPeriod: 2,
        isPeriodActive: true,
        activeLineupIds: ["p1", "p3"],
        activePlayersLimit: 7,
        maxPersonalFouls: 3,
      });

      expect(map.p1).toEqual({
        personalFouls: 2,
        isWarning: true,
        isDisqualified: false,
        disqualificationReason: null,
        isServingTimedExclusion: false,
      });
      expect(map.p2).toEqual({
        personalFouls: 3,
        isWarning: false,
        isDisqualified: true,
        disqualificationReason: "PersonalFoulLimit",
        isServingTimedExclusion: false,
      });
      expect(map.p3).toEqual({
        personalFouls: 0,
        isWarning: false,
        isDisqualified: false,
        disqualificationReason: null,
        isServingTimedExclusion: false,
      });
    });

    it("does not trigger warning when maxPersonalFouls is null or when personalFouls is 0 with maxPersonalFouls === 1", () => {
      const mapNull = computePlayerDisciplinaryMap({
        lineupIds: ["p1"],
        gameEvents: [
          makeEvent({
            matchLineupId: "p1",
            foulImpact: "PersonalFoul",
            penaltyDurationSeconds: null,
          }),
        ],
        eventDefinitionsById: new Map(),
        periodPresences: [],
        currentPeriod: 1,
        isPeriodActive: true,
        activeLineupIds: ["p1"],
        activePlayersLimit: 7,
        maxPersonalFouls: null,
      });

      expect(mapNull.p1.personalFouls).toBe(1);
      expect(mapNull.p1.isWarning).toBe(false);
      expect(mapNull.p1.isDisqualified).toBe(false);

      const mapOne = computePlayerDisciplinaryMap({
        lineupIds: ["p1"],
        gameEvents: [],
        eventDefinitionsById: new Map(),
        periodPresences: [],
        currentPeriod: 1,
        isPeriodActive: true,
        activeLineupIds: ["p1"],
        activePlayersLimit: 7,
        maxPersonalFouls: 1,
      });

      expect(mapOne.p1.isWarning).toBe(false);
      expect(mapOne.p1.isDisqualified).toBe(false);
    });

    it("marks player disqualified for direct DisqualificationWithSub and DisqualificationNoSub even when maxPersonalFouls is null", () => {
      const map = computePlayerDisciplinaryMap({
        lineupIds: ["p1", "p2"],
        gameEvents: [
          makeEvent({
            id: "e1",
            matchLineupId: "p1",
            foulImpact: "DisqualificationWithSub",
            penaltyDurationSeconds: 20,
          }),
          makeEvent({
            id: "e2",
            matchLineupId: "p2",
            foulImpact: "DisqualificationNoSub",
            penaltyDurationSeconds: 240,
          }),
        ],
        eventDefinitionsById: new Map(),
        periodPresences: [],
        currentPeriod: 1,
        isPeriodActive: true,
        activeLineupIds: [],
        activePlayersLimit: 7,
        maxPersonalFouls: null,
      });

      expect(map.p1.isDisqualified).toBe(true);
      expect(map.p1.disqualificationReason).toBe("DisqualificationWithSub");
      expect(map.p1.isServingTimedExclusion).toBe(false);

      expect(map.p2.isDisqualified).toBe(true);
      expect(map.p2.disqualificationReason).toBe("DisqualificationNoSub");
      expect(map.p2.isServingTimedExclusion).toBe(false);
    });

    it("highlights non-DQ excluded player on BENCH while shorthanded and clears highlight when full strength or re-entered", () => {
      const penaltyEvent = makeEvent({
        id: "excl-1",
        matchLineupId: "p1",
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
        periodNumber: 1,
        eventTimestamp: "2026-11-18T10:02:00.000Z",
        sequenceNumber: 10,
      });

      const closedPresence = makePresence({
        id: "pres-p1",
        matchLineupId: "p1",
        periodNumber: 1,
        timeIn: "2026-11-18T10:00:00.000Z",
        timeOut: "2026-11-18T10:02:00.000Z",
        sequenceNumber: 1,
      });

      // Shorthanded (2 of 3 active): p1 is on bench -> highlighted
      const shorthandedMap = computePlayerDisciplinaryMap({
        lineupIds: ["p1", "p2", "p3", "p4"],
        gameEvents: [penaltyEvent],
        eventDefinitionsById: new Map(),
        periodPresences: [closedPresence],
        currentPeriod: 1,
        isPeriodActive: true,
        activeLineupIds: ["p2", "p3"],
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
      });
      expect(shorthandedMap.p1.isServingTimedExclusion).toBe(true);

      // 1-for-1 sub while shorthanded (p2 out, p4 in -> still 2 of 3 active): p1 highlight preserved
      const subWhileShorthandedMap = computePlayerDisciplinaryMap({
        lineupIds: ["p1", "p2", "p3", "p4"],
        gameEvents: [penaltyEvent],
        eventDefinitionsById: new Map(),
        periodPresences: [closedPresence],
        currentPeriod: 1,
        isPeriodActive: true,
        activeLineupIds: ["p3", "p4"],
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
      });
      expect(subWhileShorthandedMap.p1.isServingTimedExclusion).toBe(true);

      // Another bench player p4 enters -> full strength (3 of 3 active) -> p1 highlight cleared
      const fullStrengthMap = computePlayerDisciplinaryMap({
        lineupIds: ["p1", "p2", "p3", "p4"],
        gameEvents: [penaltyEvent],
        eventDefinitionsById: new Map(),
        periodPresences: [closedPresence],
        currentPeriod: 1,
        isPeriodActive: true,
        activeLineupIds: ["p2", "p3", "p4"],
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
      });
      expect(fullStrengthMap.p1.isServingTimedExclusion).toBe(false);

      // p1 re-entered later and then subbed out again -> presence after penalty clears highlight
      const reEnteredThenSubbedOutMap = computePlayerDisciplinaryMap({
        lineupIds: ["p1", "p2", "p3", "p4"],
        gameEvents: [penaltyEvent],
        eventDefinitionsById: new Map(),
        periodPresences: [
          closedPresence,
          makePresence({
            id: "pres-p1-reenter",
            matchLineupId: "p1",
            periodNumber: 1,
            timeIn: "2026-11-18T10:02:25.000Z",
            timeOut: "2026-11-18T10:03:00.000Z",
            sequenceNumber: 12,
          }),
        ],
        currentPeriod: 1,
        isPeriodActive: true,
        activeLineupIds: ["p2", "p3"],
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
      });
      expect(reEnteredThenSubbedOutMap.p1.isServingTimedExclusion).toBe(false);
    });

    it("caps simultaneous exclusion highlights to shorthandedSlots, clearing earliest exclusion first", () => {
      const excl1 = makeEvent({
        id: "excl-1",
        matchLineupId: "p1",
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
        sequenceNumber: 10,
      });
      const excl2 = makeEvent({
        id: "excl-2",
        matchLineupId: "p2",
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
        sequenceNumber: 15,
      });

      // Down by 1 slot (2 of 3 active) with 2 bench players having un-reentered exclusions
      const map = computePlayerDisciplinaryMap({
        lineupIds: ["p1", "p2", "p3", "p4"],
        gameEvents: [excl1, excl2],
        eventDefinitionsById: new Map(),
        periodPresences: [],
        currentPeriod: 1,
        isPeriodActive: true,
        activeLineupIds: ["p3", "p4"],
        activePlayersLimit: 3,
        maxPersonalFouls: 3,
      });

      expect(map.p1.isServingTimedExclusion).toBe(false);
      expect(map.p2.isServingTimedExclusion).toBe(true);
    });
  });

  describe("shouldAutoRemoveActivePlayer", () => {
    it("returns false when period is inactive", () => {
      const event = makeEvent({
        foulImpact: "DisqualificationNoSub",
        penaltyDurationSeconds: 240,
      });
      expect(
        shouldAutoRemoveActivePlayer({
          event,
          playerGameEvents: [event],
          eventDefinitionsById: new Map(),
          maxPersonalFouls: 3,
          currentPeriod: 1,
          isPeriodActive: false,
        }),
      ).toBe(false);
    });

    it("returns true for timed penalty in current period, false for timed penalty in previous period (non-DQ)", () => {
      const event = makeEvent({
        periodNumber: 1,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
      });

      expect(
        shouldAutoRemoveActivePlayer({
          event,
          playerGameEvents: [event],
          eventDefinitionsById: new Map(),
          maxPersonalFouls: 3,
          currentPeriod: 1,
          isPeriodActive: true,
        }),
      ).toBe(true);

      expect(
        shouldAutoRemoveActivePlayer({
          event,
          playerGameEvents: [event],
          eventDefinitionsById: new Map(),
          maxPersonalFouls: 3,
          currentPeriod: 2,
          isPeriodActive: true,
        }),
      ).toBe(false);
    });

    it("returns true for DQ even if the edited event was in a previous period", () => {
      const prevPeriodDqEvent = makeEvent({
        periodNumber: 1,
        foulImpact: "DisqualificationWithSub",
        penaltyDurationSeconds: null,
      });

      expect(
        shouldAutoRemoveActivePlayer({
          event: prevPeriodDqEvent,
          playerGameEvents: [prevPeriodDqEvent],
          eventDefinitionsById: new Map(),
          maxPersonalFouls: 3,
          currentPeriod: 2,
          isPeriodActive: true,
        }),
      ).toBe(true);
    });
  });
});
