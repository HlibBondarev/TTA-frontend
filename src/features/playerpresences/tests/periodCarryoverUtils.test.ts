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

  it("should prioritize serving the carried-over penalty of a player who starts the new period over an earlier FIFO penalty of a player remaining on the bench", () => {
    const events = [
      makeEvent({
        id: "ex-p1-older",
        matchLineupId: "p1",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:10.000Z",
        sequenceNumber: 1,
      }),
      makeEvent({
        id: "ex-p2-newer",
        matchLineupId: "p2",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:40.000Z",
        sequenceNumber: 2,
      }),
    ];

    // Limit = 3. 2 penalties carried over ([p1, p2]).
    // User taps p2 before Period 2 starts, clearing p2's penalty and selecting [p2, p3] (2 starting players, 1 unserved penalty remains).
    const presences = [
      makePresence({
        id: "p2-start-1",
        matchLineupId: "p2",
        periodNumber: 2,
        timeIn: "2026-11-20T10:10:00.000Z",
        timeOut: null,
        sequenceNumber: 3,
      }),
      makePresence({
        id: "p2-start-2",
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

    expect(activeStateInPeriod2.unservedTimedPenaltyCount).toBe(1);
    expect(
      activeStateInPeriod2.playersById["p2"].hasActiveTimedExclusion,
    ).toBe(false);
    expect(
      activeStateInPeriod2.playersById["p1"].hasActiveTimedExclusion,
    ).toBe(true);
  });

  it("should clear a starting player's carried-over penalty at period start even when the squad has fewer eligible players than activePlayersLimit", () => {
    // Limit = 3, only 2 eligible players in squad (p1, p2), and 1 carried-over penalty for p1.
    // User clears p1's penalty before Period 2 and starts both p1 and p2 (startCount = 2).
    // Even though maxCarryoverAllowed = 3 - 2 = 1, p1 is in the Period 2 starting lineup, so p1's penalty must be served!
    const events = [
      makeEvent({
        id: "ex-p1-short-squad",
        matchLineupId: "p1",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:30.000Z",
        sequenceNumber: 1,
      }),
    ];

    const presences = [
      makePresence({
        id: "p2-start-p1",
        matchLineupId: "p1",
        periodNumber: 2,
        timeIn: "2026-11-20T10:10:00.000Z",
        timeOut: null,
        sequenceNumber: 2,
      }),
      makePresence({
        id: "p2-start-p2",
        matchLineupId: "p2",
        periodNumber: 2,
        timeIn: "2026-11-20T10:10:00.000Z",
        timeOut: null,
        sequenceNumber: 3,
      }),
    ];

    const activeStateInPeriod2 = calculateDisciplinaryState({
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2"],
      events,
      presences,
    });

    expect(activeStateInPeriod2.unservedTimedPenaltyCount).toBe(0);
    expect(
      activeStateInPeriod2.playersById["p1"].hasActiveTimedExclusion,
    ).toBe(false);
  });

  it("should prevent non-eligible / unknown lineupIds from occupying starting lineup slots in applyPrePeriodBenchTap", () => {
    const carryover = calculatePeriodCarryoverState({
      targetPeriodNumber: 1,
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3"],
      events: [],
      presences: [],
    });

    const tapUnknown = applyPrePeriodBenchTap({
      lineupId: "unknown-player",
      selectedStartingIds: ["p1"],
      clearedPenaltyEventIds: [],
      carryoverState: carryover,
    });

    expect(tapUnknown.wasPenaltyCleared).toBe(false);
    expect(tapUnknown.wasSelectionToggled).toBe(false);
    expect(tapUnknown.selectedStartingIds).toEqual(["p1"]);
  });

  it("should not highlight or clear a disqualified player's carried-over penalty in a short-squad scenario where all eligible players can already start", () => {
    // Limit = 3, squad has 3 players (p1, p2, p3).
    // In Period 1, p3 gets DisqualificationWithSub + 240s timed penalty.
    // Remaining eligible players = 2 (p1, p2).
    // Before Period 2: requiredStartingPlayers = min(2, 3 - 1) = 2.
    // Clearing p3's penalty would yield min(2, 3 - 0) = 2 (no additional eligible player can enter to serve the team penalty).
    // Under the zero-schema-change invariant, p3 is not highlighted for pre-period penalty clearing, and tapping p3 is a no-op,
    // staying consistent with post-start replay where starting [p1, p2] leaves p3's timed team penalty active until a 3rd player enters.
    const events = [
      makeEvent({
        id: "brutality-p3",
        matchLineupId: "p3",
        periodNumber: 1,
        foulImpact: "DisqualificationWithSub",
        penaltyDurationSeconds: 240,
        sequenceNumber: 1,
      }),
    ];

    const carryover = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3"],
      events,
      presences: [],
    });

    expect(carryover.eligibleLineupCount).toBe(2);
    expect(carryover.requiredStartingPlayers).toBe(2);
    expect(carryover.highlightedLineupIds).toEqual([]);

    const tapDqShortSquad = applyPrePeriodBenchTap({
      lineupId: "p3",
      selectedStartingIds: ["p1", "p2"],
      clearedPenaltyEventIds: [],
      carryoverState: carryover,
    });

    expect(tapDqShortSquad.wasPenaltyCleared).toBe(false);
    expect(tapDqShortSquad.wasSelectionToggled).toBe(false);
    expect(tapDqShortSquad.clearedPenaltyEventIds).toEqual([]);
    expect(tapDqShortSquad.selectedStartingIds).toEqual(["p1", "p2"]);
  });

  it("should enforce FIFO clearing order for disqualified players' carried-over penalties so pre-period clearing matches post-start FIFO replay", () => {
    // Limit = 3. Disqualified players p1 and p2 have carried penalties in FIFO order [p1, p2].
    // Eligible players: p3, p4, p5.
    // Before clearing: requiredStartingPlayers = 1, only the oldest FIFO penalty (p1) among non-starters is highlighted/clearable.
    // Tapping p2 (newer DQ penalty) first is rejected so the user cannot create a pre-period state that contradicts post-start FIFO replay.
    // Tapping p1 clears p1's penalty (requiredStartingPlayers becomes 2, and p2 now becomes the head of the queue and highlighted).
    // When Period 2 starts with [p3, p4], replay trims the queue by FIFO (serving p1 and retaining p2), matching pre-period state!
    const events = [
      makeEvent({
        id: "brutality-p1-older",
        matchLineupId: "p1",
        periodNumber: 1,
        foulImpact: "DisqualificationWithSub",
        penaltyDurationSeconds: 240,
        eventTimestamp: "2026-11-20T10:07:10.000Z",
        sequenceNumber: 1,
      }),
      makeEvent({
        id: "brutality-p2-newer",
        matchLineupId: "p2",
        periodNumber: 1,
        foulImpact: "DisqualificationWithSub",
        penaltyDurationSeconds: 240,
        eventTimestamp: "2026-11-20T10:07:40.000Z",
        sequenceNumber: 2,
      }),
    ];

    const initialCarryover = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4", "p5"],
      events,
      presences: [],
    });

    expect(initialCarryover.requiredStartingPlayers).toBe(1);
    expect(initialCarryover.highlightedLineupIds).toEqual(["p1"]);

    // Attempting to clear the newer DQ penalty (p2) out of FIFO order is a no-op
    const tapNewerDq = applyPrePeriodBenchTap({
      lineupId: "p2",
      selectedStartingIds: ["p3"],
      clearedPenaltyEventIds: [],
      carryoverState: initialCarryover,
    });

    expect(tapNewerDq.wasPenaltyCleared).toBe(false);
    expect(tapNewerDq.clearedPenaltyEventIds).toEqual([]);

    // Tapping the oldest FIFO DQ penalty (p1) succeeds
    const tapOlderDq = applyPrePeriodBenchTap({
      lineupId: "p1",
      selectedStartingIds: ["p3"],
      clearedPenaltyEventIds: [],
      carryoverState: initialCarryover,
    });

    expect(tapOlderDq.wasPenaltyCleared).toBe(true);
    expect(tapOlderDq.clearedPenaltyEventIds).toEqual(["brutality-p1-older"]);

    const carryoverAfterFirstClear = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4", "p5"],
      events,
      presences: [],
      clearedPenaltyEventIds: tapOlderDq.clearedPenaltyEventIds,
    });

    expect(carryoverAfterFirstClear.requiredStartingPlayers).toBe(2);
    expect(carryoverAfterFirstClear.highlightedLineupIds).toEqual(["p2"]);
    expect(
      carryoverAfterFirstClear.effectiveCarriedOverPenalties.map(
        (p) => p.matchLineupId,
      ),
    ).toEqual(["p2"]);

    // Starting Period 2 with [p3, p4] reproduces the exact same state during replay (p1 served, p2 retained)
    const activeStateInPeriod2 = calculateDisciplinaryState({
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4", "p5"],
      events,
      presences: [
        makePresence({
          id: "p2-start-p3",
          matchLineupId: "p3",
          periodNumber: 2,
          timeIn: "2026-11-20T10:10:00.000Z",
          timeOut: null,
          sequenceNumber: 3,
        }),
        makePresence({
          id: "p2-start-p4",
          matchLineupId: "p4",
          periodNumber: 2,
          timeIn: "2026-11-20T10:10:00.000Z",
          timeOut: null,
          sequenceNumber: 4,
        }),
      ],
    });

    expect(activeStateInPeriod2.unservedTimedPenaltyCount).toBe(1);
    expect(
      activeStateInPeriod2.playersById["p1"].hasActiveTimedExclusion,
    ).toBe(false);
    expect(
      activeStateInPeriod2.playersById["p2"].hasActiveTimedExclusion,
    ).toBe(true);
  });

  it("should transfer non-starter cleared penalty slot to the oldest FIFO penalty when an eligible player whose non-head penalty was cleared is subsequently deselected", () => {
    // Limit = 3, carried-over penalties in FIFO order [p1, p2], eligible players [p1, p2, p3, p4].
    // 1. User taps p2 -> clears p2's penalty AND selects p2 (since p2 is starting, p2's specific penalty is served, leaving p1's penalty active).
    // 2. User taps p2 again -> deselects p2 while keeping the cleared penalty slot open (requiredStartingPlayers remains 2).
    //    Because p2 is no longer starting, an unnamed substitute (e.g. p3, p4) will fill that slot, which serves the oldest FIFO penalty (p1) and retains p2!
    const events = [
      makeEvent({
        id: "ex-p1-older",
        matchLineupId: "p1",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:10.000Z",
        sequenceNumber: 1,
      }),
      makeEvent({
        id: "ex-p2-newer",
        matchLineupId: "p2",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:40.000Z",
        sequenceNumber: 2,
      }),
    ];

    const initialCarryover = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4"],
      events,
      presences: [],
    });

    expect(initialCarryover.requiredStartingPlayers).toBe(1);

    // Step 1: Tap p2 -> clears p2's penalty and selects p2
    const firstTapP2 = applyPrePeriodBenchTap({
      lineupId: "p2",
      selectedStartingIds: ["p3"],
      clearedPenaltyEventIds: [],
      carryoverState: initialCarryover,
    });

    expect(firstTapP2.wasPenaltyCleared).toBe(true);
    expect(firstTapP2.wasSelectionToggled).toBe(true);
    expect(firstTapP2.selectedStartingIds).toEqual(["p3", "p2"]);
    expect(firstTapP2.clearedPenaltyEventIds).toEqual(["ex-p2-newer"]);

    const carryoverWhileP2Selected = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4"],
      events,
      presences: [],
      clearedPenaltyEventIds: firstTapP2.clearedPenaltyEventIds,
    });

    expect(carryoverWhileP2Selected.requiredStartingPlayers).toBe(2);
    expect(carryoverWhileP2Selected.highlightedLineupIds).toEqual(["p1"]);

    // Step 2: Tap p2 again to deselect p2 -> keeps 1 penalty cleared (requiredStartingPlayers = 2),
    // but normalizes the non-starter cleared penalty to the oldest FIFO penalty (ex-p1-older)
    // so starting [p3, p4] matches post-start FIFO replay!
    const secondTapP2 = applyPrePeriodBenchTap({
      lineupId: "p2",
      selectedStartingIds: firstTapP2.selectedStartingIds,
      clearedPenaltyEventIds: firstTapP2.clearedPenaltyEventIds,
      carryoverState: carryoverWhileP2Selected,
    });

    expect(secondTapP2.wasPenaltyCleared).toBe(false);
    expect(secondTapP2.wasSelectionToggled).toBe(true);
    expect(secondTapP2.selectedStartingIds).toEqual(["p3"]);
    expect(secondTapP2.clearedPenaltyEventIds).toEqual(["ex-p1-older"]);

    const carryoverAfterP2Deselected = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4"],
      events,
      presences: [],
      clearedPenaltyEventIds: secondTapP2.clearedPenaltyEventIds,
    });

    expect(carryoverAfterP2Deselected.requiredStartingPlayers).toBe(2);
    expect(carryoverAfterP2Deselected.highlightedLineupIds).toEqual(["p2"]);

    // Step 3: Select p4 and start Period 2 with [p3, p4] -> replay matches carryoverAfterP2Deselected (p1 served, p2 retained)
    const activeStateInPeriod2 = calculateDisciplinaryState({
      activePlayersLimit: 3,
      maxPersonalFouls: 3,
      lineupIds: ["p1", "p2", "p3", "p4"],
      events,
      presences: [
        makePresence({
          id: "p2-start-p3",
          matchLineupId: "p3",
          periodNumber: 2,
          timeIn: "2026-11-20T10:10:00.000Z",
          timeOut: null,
          sequenceNumber: 3,
        }),
        makePresence({
          id: "p2-start-p4",
          matchLineupId: "p4",
          periodNumber: 2,
          timeIn: "2026-11-20T10:10:00.000Z",
          timeOut: null,
          sequenceNumber: 4,
        }),
      ],
    });

    expect(activeStateInPeriod2.unservedTimedPenaltyCount).toBe(1);
    expect(
      activeStateInPeriod2.playersById["p1"].hasActiveTimedExclusion,
    ).toBe(false);
    expect(
      activeStateInPeriod2.playersById["p2"].hasActiveTimedExclusion,
    ).toBe(true);
  });

  it("should align pre-period normalization and post-start FIFO replay when a starter carries multiple timed penalties", () => {
    // Limit = 5. Carried-over penalty queue in FIFO order: [A1, B, A2, C], where A1 and A2 both belong to player p1 ("A").
    // Eligible players: p1 ("A"), p2 ("B"), p3 ("C"), p4 ("D"), p5 ("E").
    // 1. Tap p1 ("A") -> clears A1 and selects p1.
    // 2. Tap p3 ("C") -> clears C and selects p3.
    // 3. Tap p3 ("C") again to deselect p3 -> normalization clears [A1, B] and leaves [A2, C] active (requiredStartingPlayers = 3).
    // 4. Start Period 2 with [p1, p4, p5] ("A", "D", "E") -> replay serves A1 for starter p1, then trims 1 excess penalty by pure FIFO (serving B),
    //    retaining [A2, C] so replay matches the pre-period normalized state!
    const events = [
      makeEvent({
        id: "ex-a1",
        matchLineupId: "p1",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:10.000Z",
        sequenceNumber: 1,
      }),
      makeEvent({
        id: "ex-b",
        matchLineupId: "p2",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:20.000Z",
        sequenceNumber: 2,
      }),
      makeEvent({
        id: "ex-a2",
        matchLineupId: "p1",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:30.000Z",
        sequenceNumber: 3,
      }),
      makeEvent({
        id: "ex-c",
        matchLineupId: "p3",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:40.000Z",
        sequenceNumber: 4,
      }),
    ];

    const lineupIds = ["p1", "p2", "p3", "p4", "p5"];

    const state0 = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 5,
      maxPersonalFouls: 5,
      lineupIds,
      events,
      presences: [],
    });

    expect(state0.requiredStartingPlayers).toBe(1);

    // 1. Tap p1 -> clears ex-a1 and selects p1
    const tapA = applyPrePeriodBenchTap({
      lineupId: "p1",
      selectedStartingIds: [],
      clearedPenaltyEventIds: [],
      carryoverState: state0,
    });
    expect(tapA.selectedStartingIds).toEqual(["p1"]);
    expect(tapA.clearedPenaltyEventIds).toEqual(["ex-a1"]);

    const state1 = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 5,
      maxPersonalFouls: 5,
      lineupIds,
      events,
      presences: [],
      clearedPenaltyEventIds: tapA.clearedPenaltyEventIds,
    });

    // 2. Tap p3 -> clears ex-c and selects p3
    const tapC = applyPrePeriodBenchTap({
      lineupId: "p3",
      selectedStartingIds: tapA.selectedStartingIds,
      clearedPenaltyEventIds: tapA.clearedPenaltyEventIds,
      carryoverState: state1,
    });
    expect(tapC.selectedStartingIds).toEqual(["p1", "p3"]);
    expect(tapC.clearedPenaltyEventIds).toEqual(["ex-a1", "ex-c"]);

    const state2 = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 5,
      maxPersonalFouls: 5,
      lineupIds,
      events,
      presences: [],
      clearedPenaltyEventIds: tapC.clearedPenaltyEventIds,
    });

    // 3. Tap p3 again to deselect p3 -> normalizes cleared penalties to [ex-a1, ex-b], leaving [ex-a2, ex-c] active
    const deselectC = applyPrePeriodBenchTap({
      lineupId: "p3",
      selectedStartingIds: tapC.selectedStartingIds,
      clearedPenaltyEventIds: tapC.clearedPenaltyEventIds,
      carryoverState: state2,
    });
    expect(deselectC.selectedStartingIds).toEqual(["p1"]);
    expect(deselectC.clearedPenaltyEventIds).toEqual(["ex-a1", "ex-b"]);

    const stateAfterDeselectC = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 5,
      maxPersonalFouls: 5,
      lineupIds,
      events,
      presences: [],
      clearedPenaltyEventIds: deselectC.clearedPenaltyEventIds,
    });

    expect(stateAfterDeselectC.requiredStartingPlayers).toBe(3);
    expect(
      stateAfterDeselectC.effectiveCarriedOverPenalties.map((p) => p.eventId),
    ).toEqual(["ex-a2", "ex-c"]);

    // 4. Start Period 2 with [p1, p4, p5] -> post-start replay retains [ex-a2, ex-c], matching pre-period state!
    const activeStateInPeriod2 = calculateDisciplinaryState({
      activePlayersLimit: 5,
      maxPersonalFouls: 5,
      lineupIds,
      events,
      presences: [
        makePresence({
          id: "p2-start-p1",
          matchLineupId: "p1",
          periodNumber: 2,
          timeIn: "2026-11-20T10:10:00.000Z",
          timeOut: null,
          sequenceNumber: 5,
        }),
        makePresence({
          id: "p2-start-p4",
          matchLineupId: "p4",
          periodNumber: 2,
          timeIn: "2026-11-20T10:10:00.000Z",
          timeOut: null,
          sequenceNumber: 6,
        }),
        makePresence({
          id: "p2-start-p5",
          matchLineupId: "p5",
          periodNumber: 2,
          timeIn: "2026-11-20T10:10:00.000Z",
          timeOut: null,
          sequenceNumber: 7,
        }),
      ],
    });

    expect(
      activeStateInPeriod2.activeTimedPenalties.map((p) => p.eventId),
    ).toEqual(["ex-a2", "ex-c"]);
    expect(
      activeStateInPeriod2.playersById["p1"].hasActiveTimedExclusion,
    ).toBe(true);
    expect(
      activeStateInPeriod2.playersById["p2"].hasActiveTimedExclusion,
    ).toBe(false);
    expect(
      activeStateInPeriod2.playersById["p3"].hasActiveTimedExclusion,
    ).toBe(true);
  });

  it("should deselect an already-selected player who still has a second active carried-over penalty instead of clearing their second penalty", () => {
    const events = [
      makeEvent({
        id: "ex-p1-first",
        matchLineupId: "p1",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:10.000Z",
        sequenceNumber: 1,
      }),
      makeEvent({
        id: "ex-p1-second",
        matchLineupId: "p1",
        periodNumber: 1,
        eventTimestamp: "2026-11-20T10:07:30.000Z",
        sequenceNumber: 2,
      }),
    ];

    const lineupIds = ["p1", "p2", "p3", "p4", "p5"];

    const initialCarryover = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 5,
      maxPersonalFouls: 5,
      lineupIds,
      events,
      presences: [],
    });

    // 1st tap on p1 clears ex-p1-first and selects p1
    const firstTap = applyPrePeriodBenchTap({
      lineupId: "p1",
      selectedStartingIds: ["p2", "p3"],
      clearedPenaltyEventIds: [],
      carryoverState: initialCarryover,
    });

    expect(firstTap.wasPenaltyCleared).toBe(true);
    expect(firstTap.wasSelectionToggled).toBe(true);
    expect(firstTap.selectedStartingIds).toEqual(["p2", "p3", "p1"]);
    expect(firstTap.clearedPenaltyEventIds).toEqual(["ex-p1-first"]);

    const carryoverAfterFirstTap = calculatePeriodCarryoverState({
      targetPeriodNumber: 2,
      activePlayersLimit: 5,
      maxPersonalFouls: 5,
      lineupIds,
      events,
      presences: [],
      clearedPenaltyEventIds: firstTap.clearedPenaltyEventIds,
    });

    // p1 still has ex-p1-second in effectiveCarriedOverPenalties
    expect(
      carryoverAfterFirstTap.effectiveCarriedOverPenalties.map(
        (p) => p.eventId,
      ),
    ).toEqual(["ex-p1-second"]);

    // 2nd tap on already-selected p1 must deselect p1 (NOT clear ex-p1-second)
    const secondTap = applyPrePeriodBenchTap({
      lineupId: "p1",
      selectedStartingIds: firstTap.selectedStartingIds,
      clearedPenaltyEventIds: firstTap.clearedPenaltyEventIds,
      carryoverState: carryoverAfterFirstTap,
    });

    expect(secondTap.wasPenaltyCleared).toBe(false);
    expect(secondTap.wasSelectionToggled).toBe(true);
    expect(secondTap.selectedStartingIds).toEqual(["p2", "p3"]);
    expect(secondTap.clearedPenaltyEventIds).toEqual(["ex-p1-first"]);
  });
});
