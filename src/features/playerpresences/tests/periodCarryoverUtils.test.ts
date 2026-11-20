import { describe, it, expect } from "vitest";
import type { GameEvent, PlayerPresence } from "../../../db/ttaDatabase";
import {
  applyPrePeriodBenchTap,
  calculatePeriodCarryoverState,
  resetClearedPeriodPenalties,
} from "../utils/periodCarryoverUtils";
import { calculateDisciplinaryState } from "../utils/disciplinaryUtils";

const makeEvent = (overrides: Partial<GameEvent> & { id: string }): GameEvent => ({
  id: overrides.id,
  matchLineupId: overrides.matchLineupId ?? "p1",
  eventDefinitionId: overrides.eventDefinitionId ?? "def-1",
  periodNumber: overrides.periodNumber ?? 1,
  eventTimestamp: overrides.eventTimestamp ?? "2026-11-20T10:07:00.000Z",
  isLeadToGoal: overrides.isLeadToGoal ?? false,
  locationX: overrides.locationX ?? null,
  locationY: overrides.locationY ?? null,
  shotLocationX: overrides.shotLocationX ?? null,
  shotLocationY: overrides.shotLocationY ?? null,
  foulImpact: overrides.foulImpact ?? "PersonalFoul",
  penaltyDurationSeconds:
    overrides.penaltyDurationSeconds !== undefined
      ? overrides.penaltyDurationSeconds
      : 20,
  createdAt: overrides.createdAt ?? "2026-11-20T10:07:00.000Z",
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
  timeOut:
    overrides.timeOut !== undefined
      ? overrides.timeOut
      : "2026-11-20T10:08:00.000Z",
  sequenceNumber: overrides.sequenceNumber ?? 1,
  isSynced: overrides.isSynced ?? 0,
});

describe("periodCarryoverUtils", () => {
  const lineupIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"];

  it("should always start Period 1 with 0 carried-over penalties and min(eligibleLineupCount, activePlayersLimit)", () => {
    const state = calculatePeriodCarryoverState({
      targetPeriodNumber: 1,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      lineupIds,
      events: [
        makeEvent({
          id: "future-ev",
          periodNumber: 1,
          matchLineupId: "p1",
          penaltyDurationSeconds: 20,
        }),
      ],
      presences: [],
    });

    expect(state.carriedOverPenalties).toEqual([]);
    expect(state.effectiveUnservedTimedPenalties).toBe(0);
    expect(state.requiredStartingPlayers).toBe(7);
  });

  it("should clamp requiredStartingPlayers to eligibleLineupCount when squad has fewer players than activePlayersLimit", () => {
    const state = calculatePeriodCarryoverState({
      targetPeriodNumber: 1,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4", "p5"],
      events: [],
      presences: [],
    });

    expect(state.requiredStartingPlayers).toBe(5);
  });

  it("should carry over 1, 2, or 3+ simultaneous unserved timed penalties into Period 2 and reduce requiredStartingPlayers accordingly", () => {
    const events = [
      makeEvent({
        id: "ex-1",
        matchLineupId: "p1",
        periodNumber: 1,
        sequenceNumber: 1,
      }),
      makeEvent({
        id: "ex-2",
        matchLineupId: "p2",
        periodNumber: 1,
        sequenceNumber: 2,
      }),
      makeEvent({
        id: "ex-3",
        matchLineupId: "p3",
        periodNumber: 1,
        sequenceNumber: 3,
      }),
    ];

    const state = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      lineupIds,
      events,
      presences: [],
    });

    expect(state.carriedOverPenalties).toHaveLength(3);
    expect(state.effectiveUnservedTimedPenalties).toBe(3);
    expect(state.highlightedLineupIds).toEqual(["p1", "p2", "p3"]);
    expect(state.requiredStartingPlayers).toBe(4);
  });

  it("should combine permanent DisqualificationNoSub reductions with carried-over timed penalties", () => {
    const events = [
      makeEvent({
        id: "no-sub-1",
        matchLineupId: "p1",
        periodNumber: 1,
        foulImpact: "DisqualificationNoSub",
        penaltyDurationSeconds: null,
        sequenceNumber: 1,
      }),
      makeEvent({
        id: "timed-ex-2",
        matchLineupId: "p2",
        periodNumber: 1,
        foulImpact: "PersonalFoul",
        penaltyDurationSeconds: 20,
        sequenceNumber: 2,
      }),
    ];

    const state = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      lineupIds,
      events,
      presences: [],
    });

    expect(state.permanentNoSubCount).toBe(1);
    expect(state.maxAllowedActive).toBe(6);
    expect(state.effectiveUnservedTimedPenalties).toBe(1);
    expect(state.requiredStartingPlayers).toBe(5);
    expect(state.disqualifiedLineupIds).toEqual(["p1"]);
    expect(state.highlightedLineupIds).toEqual(["p2"]);
  });

  it("should clear 1 carried-over penalty AND select an eligible highlighted player on first tap, and only toggle selection on subsequent taps", () => {
    const events = [
      makeEvent({
        id: "ex-p1",
        matchLineupId: "p1",
        periodNumber: 1,
        sequenceNumber: 1,
      }),
    ];

    const initialCarryover = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      lineupIds,
      events,
      presences: [],
    });

    expect(initialCarryover.requiredStartingPlayers).toBe(6);
    expect(initialCarryover.highlightedLineupIds).toEqual(["p1"]);

    // 1st tap on highlighted eligible p1 -> clears penalty AND selects p1
    const firstTap = applyPrePeriodBenchTap({
      lineupId: "p1",
      selectedStartingIds: ["p2", "p3"],
      clearedPenaltyEventIds: [],
      carryoverState: initialCarryover,
    });

    expect(firstTap.wasPenaltyCleared).toBe(true);
    expect(firstTap.wasSelectionToggled).toBe(true);
    expect(firstTap.clearedPenaltyEventIds).toEqual(["ex-p1"]);
    expect(firstTap.selectedStartingIds).toEqual(["p2", "p3", "p1"]);

    const carryoverAfterClear = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      lineupIds,
      events,
      presences: [],
      clearedPenaltyEventIds: firstTap.clearedPenaltyEventIds,
    });

    expect(carryoverAfterClear.requiredStartingPlayers).toBe(7);
    expect(carryoverAfterClear.highlightedLineupIds).toEqual([]);
    expect(carryoverAfterClear.canResetClearedPenalties).toBe(true);

    // 2nd tap on p1 -> only deselects p1 from starting lineup while keeping penalty cleared
    const secondTap = applyPrePeriodBenchTap({
      lineupId: "p1",
      selectedStartingIds: firstTap.selectedStartingIds,
      clearedPenaltyEventIds: firstTap.clearedPenaltyEventIds,
      carryoverState: carryoverAfterClear,
    });

    expect(secondTap.wasPenaltyCleared).toBe(false);
    expect(secondTap.wasSelectionToggled).toBe(true);
    expect(secondTap.clearedPenaltyEventIds).toEqual(["ex-p1"]);
    expect(secondTap.selectedStartingIds).toEqual(["p2", "p3"]);
  });

  it("should clear 1 carried-over team penalty WITHOUT selecting the player when tapping a highlighted DQ player", () => {
    const events = [
      makeEvent({
        id: "brutality-p1",
        matchLineupId: "p1",
        periodNumber: 1,
        foulImpact: "DisqualificationWithSub",
        penaltyDurationSeconds: 240,
        sequenceNumber: 1,
      }),
    ];

    const initialCarryover = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      lineupIds,
      events,
      presences: [],
    });

    expect(initialCarryover.requiredStartingPlayers).toBe(6);
    expect(initialCarryover.disqualifiedLineupIds).toContain("p1");
    expect(initialCarryover.highlightedLineupIds).toContain("p1");

    const tapDq = applyPrePeriodBenchTap({
      lineupId: "p1",
      selectedStartingIds: ["p2", "p3"],
      clearedPenaltyEventIds: [],
      carryoverState: initialCarryover,
    });

    expect(tapDq.wasPenaltyCleared).toBe(true);
    expect(tapDq.wasSelectionToggled).toBe(false);
    expect(tapDq.selectedStartingIds).toEqual(["p2", "p3"]);
    expect(tapDq.clearedPenaltyEventIds).toEqual(["brutality-p1"]);

    const carryoverAfterClear = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 7,
      maxPersonalFouls: 3,
      lineupIds,
      events,
      presences: [],
      clearedPenaltyEventIds: tapDq.clearedPenaltyEventIds,
    });

    expect(carryoverAfterClear.requiredStartingPlayers).toBe(7);
    expect(carryoverAfterClear.highlightedLineupIds).toEqual([]);
  });

  it("should restore carried-over penalty state and trim selected starting lineup on Reset", () => {
    const events = [
      makeEvent({
        id: "ex-p1",
        matchLineupId: "p1",
        periodNumber: 1,
      }),
    ];

    const restoredState = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4"],
      events,
      presences: [],
      clearedPenaltyEventIds: [],
    });

    expect(restoredState.requiredStartingPlayers).toBe(2);

    const resetResult = resetClearedPeriodPenalties(
      ["p1", "p2", "p3"],
      restoredState,
    );

    expect(resetResult.clearedPenaltyEventIds).toEqual([]);
    expect(resetResult.selectedStartingIds).toEqual(["p2", "p3"]);
  });

  it("should deterministically reflect pre-period cleared penalties after period start from persisted starting presences", () => {
    const events = [
      makeEvent({
        id: "ex-p1",
        matchLineupId: "p1",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:30.000Z",
        sequenceNumber: 1,
      }),
    ];

    // Period 2 starts with all 3 players (meaning the 1 carried-over penalty was cleared before Period 2 started)
    const presences = [
      makePresence({
        id: "p2-start-1",
        matchLineupId: "p1",
        periodNumber: 2,
        timeIn: "2026-11-20T10:10:00.000Z",
        timeOut: null,
        sequenceNumber: 2,
      }),
      makePresence({
        id: "p2-start-2",
        matchLineupId: "p2",
        periodNumber: 2,
        timeIn: "2026-11-20T10:10:00.000Z",
        timeOut: null,
        sequenceNumber: 3,
      }),
      makePresence({
        id: "p2-start-3",
        matchLineupId: "p3",
        periodNumber: 2,
        timeIn: "2026-11-20T10:10:00.000Z",
        timeOut: null,
        sequenceNumber: 4,
      }),
    ];

    const activeStateInPeriod2 = calculateDisciplinaryState({
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4"],
      events,
      presences,
    });

    expect(activeStateInPeriod2.unservedTimedPenaltyCount).toBe(0);
    expect(
      activeStateInPeriod2.playersById["p1"].hasActiveTimedExclusion,
    ).toBe(false);
  });
});
