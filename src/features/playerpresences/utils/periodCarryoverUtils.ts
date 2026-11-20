import type {
  EventDefinitionLookup,
  GameEvent,
  PlayerPresence,
} from "../../../db/ttaDatabase";
import {
  calculateDisciplinaryState,
  type ActiveTimedPenalty,
  type PlayerDisciplinaryStatus,
} from "./disciplinaryUtils";

export interface CalculatePeriodCarryoverInput {
  targetPeriodNumber: number;
  activePlayersLimit: number;
  maxPersonalFouls: number | null | undefined;
  lineupIds: string[];
  events: GameEvent[];
  presences: PlayerPresence[];
  definitionsById?: ReadonlyMap<string, EventDefinitionLookup>;
  clearedPenaltyEventIds?: readonly string[];
}

export interface PeriodCarryoverState {
  targetPeriodNumber: number;
  activePlayersLimit: number;
  maxPersonalFouls: number | null | undefined;
  isMaxPersonalFoulsKnown: boolean;
  permanentNoSubCount: number;
  maxAllowedActive: number;
  eligibleLineupIds: string[];
  disqualifiedLineupIds: string[];
  eligibleLineupCount: number;
  carriedOverPenalties: ActiveTimedPenalty[];
  clearedPenaltyEventIds: string[];
  effectiveCarriedOverPenalties: ActiveTimedPenalty[];
  effectiveUnservedTimedPenalties: number;
  highlightedLineupIds: string[];
  requiredStartingPlayers: number;
  canResetClearedPenalties: boolean;
  playersById: Record<string, PlayerDisciplinaryStatus>;
}

export interface PrePeriodBenchTapInput {
  lineupId: string;
  selectedStartingIds: readonly string[];
  clearedPenaltyEventIds: readonly string[];
  carryoverState: PeriodCarryoverState;
}

export interface PrePeriodBenchTapResult {
  selectedStartingIds: string[];
  clearedPenaltyEventIds: string[];
  wasPenaltyCleared: boolean;
  wasSelectionToggled: boolean;
}

/**
 * Pure derivation of period-start carried-over timed penalties, eligible
 * roster size, highlighted bench players, and required starting lineup size
 * for period P.
 */
export const calculatePeriodCarryoverState = (
  input: CalculatePeriodCarryoverInput,
): PeriodCarryoverState => {
  const targetPeriod = Math.max(1, Math.floor(input.targetPeriodNumber));
  const previousPeriodCap = targetPeriod > 1 ? targetPeriod - 1 : 0;

  const disciplinaryBeforePeriod = calculateDisciplinaryState({
    activePlayersLimit: input.activePlayersLimit,
    maxPersonalFouls: input.maxPersonalFouls,
    lineupIds: input.lineupIds,
    events: input.events,
    presences: input.presences,
    definitionsById: input.definitionsById,
    upToPeriodNumber: previousPeriodCap,
  });

  const uniqueLineupIds = Array.from(new Set(input.lineupIds));
  const eligibleLineupIds: string[] = [];
  const disqualifiedLineupIds: string[] = [];

  for (const id of uniqueLineupIds) {
    const status = disciplinaryBeforePeriod.playersById[id];
    if (status?.isDisqualified) {
      disqualifiedLineupIds.push(id);
    } else {
      eligibleLineupIds.push(id);
    }
  }

  const carriedOverPenalties =
    targetPeriod === 1 ? [] : disciplinaryBeforePeriod.activeTimedPenalties;

  const carriedIdsSet = new Set(carriedOverPenalties.map((p) => p.eventId));
  const clearedPenaltyEventIds = Array.from(
    new Set(
      (input.clearedPenaltyEventIds ?? []).filter((id) =>
        carriedIdsSet.has(id),
      ),
    ),
  );
  const clearedSet = new Set(clearedPenaltyEventIds);

  const effectiveCarriedOverPenalties = carriedOverPenalties.filter(
    (p) => !clearedSet.has(p.eventId),
  );
  const effectiveUnservedTimedPenalties = effectiveCarriedOverPenalties.length;

  const highlightedLineupIds = Array.from(
    new Set(effectiveCarriedOverPenalties.map((p) => p.matchLineupId)),
  );

  const maxAllowedActive =
    targetPeriod === 1
      ? disciplinaryBeforePeriod.activePlayersLimit
      : disciplinaryBeforePeriod.maxAllowedActive;

  const eligibleLineupCount = eligibleLineupIds.length;
  const requiredStartingPlayers = Math.min(
    eligibleLineupCount,
    Math.max(0, maxAllowedActive - effectiveUnservedTimedPenalties),
  );

  return {
    targetPeriodNumber: targetPeriod,
    activePlayersLimit: disciplinaryBeforePeriod.activePlayersLimit,
    maxPersonalFouls: disciplinaryBeforePeriod.maxPersonalFouls,
    isMaxPersonalFoulsKnown: disciplinaryBeforePeriod.isMaxPersonalFoulsKnown,
    permanentNoSubCount:
      targetPeriod === 1 ? 0 : disciplinaryBeforePeriod.permanentNoSubCount,
    maxAllowedActive,
    eligibleLineupIds,
    disqualifiedLineupIds,
    eligibleLineupCount,
    carriedOverPenalties,
    clearedPenaltyEventIds,
    effectiveCarriedOverPenalties,
    effectiveUnservedTimedPenalties,
    highlightedLineupIds,
    requiredStartingPlayers,
    canResetClearedPenalties: clearedPenaltyEventIds.length > 0,
    playersById: disciplinaryBeforePeriod.playersById,
  };
};

/**
 * Handles tapping a bench player before starting a period:
 * - Tapping a highlighted eligible player clears 1 carried-over penalty AND
 *   selects that player for the starting lineup (subsequent taps toggle
 *   selection while keeping the penalty cleared).
 * - Tapping a highlighted disqualified player carrying a timed team penalty
 *   clears 1 carried-over penalty WITHOUT adding them to the starting lineup.
 * - Tapping a non-highlighted disqualified player is a no-op.
 * - Tapping a non-highlighted eligible player toggles starting lineup
 *   selection up to requiredStartingPlayers.
 */
export const applyPrePeriodBenchTap = (
  input: PrePeriodBenchTapInput,
): PrePeriodBenchTapResult => {
  const { lineupId, carryoverState } = input;
  const currentSelected = Array.from(new Set(input.selectedStartingIds));
  const currentCleared = Array.from(new Set(input.clearedPenaltyEventIds));

  const isDisqualified = carryoverState.disqualifiedLineupIds.includes(lineupId);
  const isEligible = carryoverState.eligibleLineupIds.includes(lineupId);
  const matchingActivePenalty =
    carryoverState.effectiveCarriedOverPenalties.find(
      (p) => p.matchLineupId === lineupId,
    );

  if (matchingActivePenalty) {
    const nextCleared = [...currentCleared, matchingActivePenalty.eventId];
    if (isDisqualified || !isEligible) {
      return {
        selectedStartingIds: currentSelected,
        clearedPenaltyEventIds: nextCleared,
        wasPenaltyCleared: true,
        wasSelectionToggled: false,
      };
    }

    const updatedRequired = Math.min(
      carryoverState.eligibleLineupCount,
      Math.max(
        0,
        carryoverState.maxAllowedActive -
          (carryoverState.effectiveUnservedTimedPenalties - 1),
      ),
    );
    const alreadySelected = currentSelected.includes(lineupId);
    const canSelect =
      isEligible && !alreadySelected && currentSelected.length < updatedRequired;

    return {
      selectedStartingIds: canSelect
        ? [...currentSelected, lineupId]
        : currentSelected,
      clearedPenaltyEventIds: nextCleared,
      wasPenaltyCleared: true,
      wasSelectionToggled: canSelect,
    };
  }

  if (isDisqualified) {
    return {
      selectedStartingIds: currentSelected,
      clearedPenaltyEventIds: currentCleared,
      wasPenaltyCleared: false,
      wasSelectionToggled: false,
    };
  }

  if (currentSelected.includes(lineupId)) {
    return {
      selectedStartingIds: currentSelected.filter((id) => id !== lineupId),
      clearedPenaltyEventIds: currentCleared,
      wasPenaltyCleared: false,
      wasSelectionToggled: true,
    };
  }

  if (
    !isEligible ||
    currentSelected.length >= carryoverState.requiredStartingPlayers
  ) {
    return {
      selectedStartingIds: currentSelected,
      clearedPenaltyEventIds: currentCleared,
      wasPenaltyCleared: false,
      wasSelectionToggled: false,
    };
  }

  return {
    selectedStartingIds: [...currentSelected, lineupId],
    clearedPenaltyEventIds: currentCleared,
    wasPenaltyCleared: false,
    wasSelectionToggled: true,
  };
};

/**
 * Restores all manually cleared carried-over penalties before period start and
 * trims the selected starting lineup to the restored requiredStartingPlayers
 * count while removing any players who are now highlighted as excluded.
 */
export const resetClearedPeriodPenalties = (
  selectedStartingIds: readonly string[],
  restoredCarryoverState: PeriodCarryoverState,
): {
  selectedStartingIds: string[];
  clearedPenaltyEventIds: string[];
} => {
  const highlightedSet = new Set(restoredCarryoverState.highlightedLineupIds);
  const eligibleSet = new Set(restoredCarryoverState.eligibleLineupIds);

  const validSelected = Array.from(new Set(selectedStartingIds)).filter(
    (id) => eligibleSet.has(id) && !highlightedSet.has(id),
  );

  return {
    selectedStartingIds: validSelected.slice(
      0,
      restoredCarryoverState.requiredStartingPlayers,
    ),
    clearedPenaltyEventIds: [],
  };
};
