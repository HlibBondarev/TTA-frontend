import type {
  EventDefinitionLookup,
  FoulImpact,
  GameEvent,
  PlayerPresence,
} from "../db/ttaDatabase";

export const DEFAULT_FOUL_IMPACT: FoulImpact = "None";

export type DisqualificationReason =
  | "PersonalFoulLimit"
  | "DisqualificationWithSub"
  | "DisqualificationNoSub"
  | null;

export type DirectDisqualificationReason =
  | "DisqualificationWithSub"
  | "DisqualificationNoSub"
  | null;

export interface PlayerDisciplinaryStatus {
  personalFouls: number;
  isWarning: boolean;
  isDisqualified: boolean;
  disqualificationReason: DisqualificationReason;
  isServingTimedExclusion: boolean;
}

export const EMPTY_DISCIPLINARY_STATUS: PlayerDisciplinaryStatus = {
  personalFouls: 0,
  isWarning: false,
  isDisqualified: false,
  disqualificationReason: null,
  isServingTimedExclusion: false,
};

export const resolveEventFoulImpact = (
  event: Pick<GameEvent, "foulImpact">,
  definition?: Pick<EventDefinitionLookup, "foulImpact"> | null,
): FoulImpact => event.foulImpact ?? definition?.foulImpact ?? DEFAULT_FOUL_IMPACT;

export const resolveEventPenaltyDuration = (
  event: Pick<GameEvent, "penaltyDurationSeconds">,
  definition?: Pick<EventDefinitionLookup, "penaltyDurationSeconds"> | null,
): number | null => {
  if (event.penaltyDurationSeconds !== undefined) {
    return event.penaltyDurationSeconds;
  }
  return definition?.penaltyDurationSeconds ?? null;
};

export const isDisqualifyingFoulImpact = (foulImpact: FoulImpact): boolean =>
  foulImpact === "DisqualificationWithSub" ||
  foulImpact === "DisqualificationNoSub";

export const hasTimedPenalty = (
  penaltyDurationSeconds: number | null | undefined,
): boolean =>
  typeof penaltyDurationSeconds === "number" && penaltyDurationSeconds > 0;

const compareEventsDesc = (a: GameEvent, b: GameEvent): number => {
  if (a.sequenceNumber !== b.sequenceNumber) {
    return b.sequenceNumber - a.sequenceNumber;
  }
  return (b.eventTimestamp || "").localeCompare(a.eventTimestamp || "");
};

const hasPlayerReEnteredAfterEvent = (
  presences: PlayerPresence[],
  penaltyEvent: GameEvent,
): boolean =>
  presences.some(
    (presence) =>
      presence.matchLineupId === penaltyEvent.matchLineupId &&
      presence.periodNumber === penaltyEvent.periodNumber &&
      (presence.sequenceNumber > penaltyEvent.sequenceNumber ||
        presence.timeIn > penaltyEvent.eventTimestamp),
  );

const findLatestUnservedTimedPenalty = (
  lineupId: string,
  events: GameEvent[],
  definitionsById: ReadonlyMap<string, EventDefinitionLookup>,
  periodPresences: PlayerPresence[],
  currentPeriod: number,
): GameEvent | null => {
  const timedPenalties = events
    .filter((event) => {
      if (event.matchLineupId !== lineupId || event.periodNumber !== currentPeriod) {
        return false;
      }
      const def = definitionsById.get(event.eventDefinitionId);
      return hasTimedPenalty(resolveEventPenaltyDuration(event, def));
    })
    .sort(compareEventsDesc);

  const latestPenalty = timedPenalties[0];
  if (!latestPenalty) {
    return null;
  }

  if (hasPlayerReEnteredAfterEvent(periodPresences, latestPenalty)) {
    return null;
  }

  return latestPenalty;
};

const aggregatePlayerFouls = (
  lineupId: string,
  events: GameEvent[],
  definitionsById: ReadonlyMap<string, EventDefinitionLookup>,
): {
  personalFouls: number;
  directDisqualification: DirectDisqualificationReason;
} => {
  let personalFouls = 0;
  let directDisqualification: DirectDisqualificationReason = null;

  for (const event of events) {
    if (event.matchLineupId !== lineupId) continue;

    const def = definitionsById.get(event.eventDefinitionId);
    const impact = resolveEventFoulImpact(event, def);

    if (impact === "PersonalFoul") {
      personalFouls += 1;
    } else if (impact === "DisqualificationNoSub") {
      directDisqualification = "DisqualificationNoSub";
    } else if (
      impact === "DisqualificationWithSub" &&
      directDisqualification !== "DisqualificationNoSub"
    ) {
      directDisqualification = "DisqualificationWithSub";
    }
  }

  return { personalFouls, directDisqualification };
};

const resolveDisqualificationReason = (
  personalFouls: number,
  maxPersonalFouls: number | null,
  directDisqualification: DirectDisqualificationReason,
): DisqualificationReason => {
  if (directDisqualification) {
    return directDisqualification;
  }
  if (
    maxPersonalFouls !== null &&
    maxPersonalFouls > 0 &&
    personalFouls >= maxPersonalFouls
  ) {
    return "PersonalFoulLimit";
  }
  return null;
};

export interface ComputeDisciplinaryMapParams {
  lineupIds: string[];
  gameEvents: GameEvent[];
  eventDefinitionsById: ReadonlyMap<string, EventDefinitionLookup>;
  periodPresences: PlayerPresence[];
  currentPeriod: number;
  isPeriodActive: boolean;
  activeLineupIds: string[];
  activePlayersLimit: number;
  maxPersonalFouls: number | null;
}

/**
 * Reactively derives each player's personal foul count, warning state, DQ lock state,
 * and active timed-exclusion highlight from the match's game events and current-period presences.
 */
export const computePlayerDisciplinaryMap = (
  params: ComputeDisciplinaryMapParams,
): Record<string, PlayerDisciplinaryStatus> => {
  const {
    lineupIds,
    gameEvents,
    eventDefinitionsById,
    periodPresences,
    currentPeriod,
    isPeriodActive,
    activeLineupIds,
    activePlayersLimit,
    maxPersonalFouls,
  } = params;

  const activeSet = new Set(activeLineupIds);
  const result: Record<string, PlayerDisciplinaryStatus> = {};
  const exclusionCandidates: Array<{ lineupId: string; event: GameEvent }> = [];

  for (const lineupId of lineupIds) {
    const { personalFouls, directDisqualification } = aggregatePlayerFouls(
      lineupId,
      gameEvents,
      eventDefinitionsById,
    );
    const disqualificationReason = resolveDisqualificationReason(
      personalFouls,
      maxPersonalFouls,
      directDisqualification,
    );
    const isDisqualified = disqualificationReason !== null;
    const isWarning =
      maxPersonalFouls !== null &&
      !isDisqualified &&
      personalFouls > 0 &&
      personalFouls === maxPersonalFouls - 1;

    result[lineupId] = {
      personalFouls,
      isWarning,
      isDisqualified,
      disqualificationReason,
      isServingTimedExclusion: false,
    };

    if (isPeriodActive && !isDisqualified && !activeSet.has(lineupId)) {
      const latestPenalty = findLatestUnservedTimedPenalty(
        lineupId,
        gameEvents,
        eventDefinitionsById,
        periodPresences,
        currentPeriod,
      );
      if (latestPenalty) {
        exclusionCandidates.push({ lineupId, event: latestPenalty });
      }
    }
  }

  const shorthandedSlots =
    isPeriodActive && activePlayersLimit > 0
      ? Math.max(0, activePlayersLimit - activeLineupIds.length)
      : 0;

  if (shorthandedSlots > 0 && exclusionCandidates.length > 0) {
    exclusionCandidates.sort((a, b) => compareEventsDesc(a.event, b.event));
    const highlighted = exclusionCandidates.slice(0, shorthandedSlots);
    for (const candidate of highlighted) {
      result[candidate.lineupId].isServingTimedExclusion = true;
    }
  }

  return result;
};

export interface ShouldAutoRemoveActivePlayerParams {
  event: GameEvent;
  eventDefinition?: EventDefinitionLookup | null;
  playerGameEvents: GameEvent[];
  eventDefinitionsById: ReadonlyMap<string, EventDefinitionLookup>;
  periodPresences?: PlayerPresence[];
  maxPersonalFouls: number | null;
  currentPeriod: number;
  isPeriodActive: boolean;
}

/**
 * Determines whether recording or updating a game event requires automatically removing
 * the target player from ACTIVE PLAYERS (closing their open presence session).
 */
export const shouldAutoRemoveActivePlayer = (
  params: ShouldAutoRemoveActivePlayerParams,
): boolean => {
  const {
    event,
    eventDefinition,
    playerGameEvents,
    eventDefinitionsById,
    periodPresences = [],
    maxPersonalFouls,
    currentPeriod,
    isPeriodActive,
  } = params;

  if (!isPeriodActive) {
    return false;
  }

  const { personalFouls, directDisqualification } = aggregatePlayerFouls(
    event.matchLineupId,
    playerGameEvents,
    eventDefinitionsById,
  );
  const disqualificationReason = resolveDisqualificationReason(
    personalFouls,
    maxPersonalFouls,
    directDisqualification,
  );

  if (disqualificationReason !== null) {
    return true;
  }

  if (event.periodNumber !== currentPeriod) {
    return false;
  }

  const penaltyDuration = resolveEventPenaltyDuration(event, eventDefinition);
  if (!hasTimedPenalty(penaltyDuration)) {
    return false;
  }

  return !hasPlayerReEnteredAfterEvent(periodPresences, event);
};
