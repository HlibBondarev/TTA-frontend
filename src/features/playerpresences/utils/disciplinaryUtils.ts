import type {
  EventDefinitionLookup,
  FoulImpact,
  GameEvent,
  PlayerPresence,
} from "../../../db/ttaDatabase";

export type DisqualificationReason =
  | "PersonalFoulLimit"
  | "DisqualificationWithSub"
  | "DisqualificationNoSub";

export interface EffectiveDisciplinaryRule {
  foulImpact: FoulImpact;
  penaltyDurationSeconds: number | null;
}

export interface PlayerDisciplinaryStatus {
  matchLineupId: string;
  personalFoulCount: number;
  hasFoulWarning: boolean;
  isDisqualified: boolean;
  disqualificationReason: DisqualificationReason | null;
  hasActiveTimedExclusion: boolean;
  activeTimedExclusionCount: number;
}

export interface ActiveTimedPenalty {
  eventId: string;
  matchLineupId: string;
  periodNumber: number;
  eventTimestamp: string;
  sequenceNumber: number;
  foulImpact: FoulImpact;
  penaltyDurationSeconds: number;
}

export interface CalculateDisciplinaryStateInput {
  activePlayersLimit: number;
  maxPersonalFouls: number | null | undefined;
  lineupIds: string[];
  events: GameEvent[];
  presences: PlayerPresence[];
  definitionsById?: ReadonlyMap<string, EventDefinitionLookup>;
  upToPeriodNumber?: number;
  activeLineupIds?: string[];
}

export interface MatchDisciplinaryState {
  activePlayersLimit: number;
  maxPersonalFouls: number | null;
  permanentNoSubCount: number;
  maxAllowedActive: number;
  activeTimedPenalties: ActiveTimedPenalty[];
  unservedTimedPenaltyCount: number;
  isShorthanded: boolean;
  shorthandedSlotsAvailable: number;
  playersById: Record<string, PlayerDisciplinaryStatus>;
}

const VALID_FOUL_IMPACTS = new Set<FoulImpact>([
  "None",
  "PersonalFoul",
  "DisqualificationWithSub",
  "DisqualificationNoSub",
]);

const normalizeFoulImpact = (value: unknown): FoulImpact | undefined => {
  if (typeof value === "string" && VALID_FOUL_IMPACTS.has(value as FoulImpact)) {
    return value as FoulImpact;
  }
  return undefined;
};

const normalizePenaltyDuration = (
  value: unknown,
): number | null | undefined => {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? value : null;
  }
  return undefined;
};

/**
 * Resolves the effective disciplinary rule for a GameEvent, preferring the
 * immutable snapshot recorded on the event and falling back to the cached
 * EventDefinitionLookup when legacy events omit snapshot fields.
 */
export const resolveEffectiveDisciplinaryRule = (
  event: GameEvent,
  definitionsById?: ReadonlyMap<string, EventDefinitionLookup>,
): EffectiveDisciplinaryRule => {
  const def = definitionsById?.get(event.eventDefinitionId);
  const snapshotImpact = normalizeFoulImpact(event.foulImpact);
  const defImpact = normalizeFoulImpact(def?.foulImpact);
  const foulImpact: FoulImpact = snapshotImpact ?? defImpact ?? "None";

  const snapshotDuration = normalizePenaltyDuration(
    event.penaltyDurationSeconds,
  );
  if (snapshotDuration !== undefined) {
    return { foulImpact, penaltyDurationSeconds: snapshotDuration };
  }

  const defDuration = normalizePenaltyDuration(def?.penaltyDurationSeconds);
  return {
    foulImpact,
    penaltyDurationSeconds: defDuration ?? null,
  };
};

const parseTimestampKey = (timestamp?: string | null): number | string => {
  if (!timestamp) return "";
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? timestamp : parsed;
};

const compareTimestamps = (
  a?: string | null,
  b?: string | null,
): number => {
  const safeA = a || "";
  const safeB = b || "";
  const timeA = Date.parse(safeA);
  const timeB = Date.parse(safeB);
  if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
    return timeA - timeB;
  }
  return safeA.localeCompare(safeB);
};

export const sortEventsChronologically = (events: GameEvent[]): GameEvent[] => {
  return [...events].sort((a, b) => {
    if (a.periodNumber !== b.periodNumber) {
      return a.periodNumber - b.periodNumber;
    }
    const timeCmp = compareTimestamps(a.eventTimestamp, b.eventTimestamp);
    if (timeCmp !== 0) return timeCmp;
    if (a.sequenceNumber !== b.sequenceNumber) {
      return a.sequenceNumber - b.sequenceNumber;
    }
    return a.id.localeCompare(b.id);
  });
};

const normalizeMaxPersonalFouls = (
  maxPersonalFouls: number | null | undefined,
): number | null => {
  if (
    typeof maxPersonalFouls === "number" &&
    Number.isFinite(maxPersonalFouls) &&
    maxPersonalFouls > 0
  ) {
    return Math.floor(maxPersonalFouls);
  }
  return null;
};

const createInitialPlayerStatus = (
  matchLineupId: string,
): PlayerDisciplinaryStatus => ({
  matchLineupId,
  personalFoulCount: 0,
  hasFoulWarning: false,
  isDisqualified: false,
  disqualificationReason: null,
  hasActiveTimedExclusion: false,
  activeTimedExclusionCount: 0,
});

const applyEventToPlayerStatus = (
  status: PlayerDisciplinaryStatus,
  rule: EffectiveDisciplinaryRule,
  maxPersonalFouls: number | null,
): { isPermanentNoSub: boolean } => {
  let isPermanentNoSub = false;

  if (rule.foulImpact === "PersonalFoul") {
    if (maxPersonalFouls !== null) {
      status.personalFoulCount += 1;
      if (
        !status.isDisqualified &&
        status.personalFoulCount >= maxPersonalFouls
      ) {
        status.isDisqualified = true;
        status.disqualificationReason = "PersonalFoulLimit";
      }
    }
  } else if (rule.foulImpact === "DisqualificationWithSub") {
    status.isDisqualified = true;
    status.disqualificationReason = "DisqualificationWithSub";
  } else if (rule.foulImpact === "DisqualificationNoSub") {
    status.isDisqualified = true;
    status.disqualificationReason = "DisqualificationNoSub";
    if (rule.penaltyDurationSeconds === null) {
      isPermanentNoSub = true;
    }
  }

  if (maxPersonalFouls !== null && maxPersonalFouls > 1) {
    status.hasFoulWarning =
      !status.isDisqualified &&
      status.personalFoulCount === maxPersonalFouls - 1;
  } else {
    status.hasFoulWarning = false;
  }

  return { isPermanentNoSub };
};

interface TimelineItem {
  kind: "EVENT" | "MID_PERIOD_ENTRY" | "PERIOD_START_BATCH";
  periodNumber: number;
  timestamp: string;
  sequenceNumber: number;
  event?: GameEvent;
  rule?: EffectiveDisciplinaryRule;
  entryLineupId?: string;
  activeCountAtTimestamp?: number;
  periodStartCount?: number;
}

const findEarliestTimeInByPeriod = (
  presences: PlayerPresence[],
): Map<number, string> => {
  const earliestByPeriod = new Map<number, string>();
  for (const p of presences) {
    const existing = earliestByPeriod.get(p.periodNumber);
    if (existing === undefined || compareTimestamps(p.timeIn, existing) < 0) {
      earliestByPeriod.set(p.periodNumber, p.timeIn);
    }
  }
  return earliestByPeriod;
};

const countActivePresencesAtEntry = (
  presences: PlayerPresence[],
  periodNumber: number,
  entryTimeIn: string,
): number => {
  const activeIds = new Set<string>();
  for (const p of presences) {
    if (p.periodNumber !== periodNumber) continue;
    const startedOnOrBefore = compareTimestamps(p.timeIn, entryTimeIn) <= 0;
    const stillOpenAfterEntry =
      p.timeOut === null || compareTimestamps(p.timeOut, entryTimeIn) > 0;
    if (startedOnOrBefore && stillOpenAfterEntry) {
      activeIds.add(p.matchLineupId);
    }
  }
  return activeIds.size;
};

const buildPresenceTimelineItems = (
  presences: PlayerPresence[],
): TimelineItem[] => {
  const earliestByPeriod = findEarliestTimeInByPeriod(presences);
  const exitCountsByPeriodAndTimestamp = new Map<string, number>();

  for (const p of presences) {
    if (p.timeOut !== null) {
      const key = `${p.periodNumber}|${parseTimestampKey(p.timeOut)}`;
      exitCountsByPeriodAndTimestamp.set(
        key,
        (exitCountsByPeriodAndTimestamp.get(key) ?? 0) + 1,
      );
    }
  }

  const periodStartPresences = new Map<
    number,
    { timestamp: string; sequenceNumber: number; lineupIds: Set<string> }
  >();
  const items: TimelineItem[] = [];

  const sortedPresences = [...presences].sort((a, b) => {
    if (a.periodNumber !== b.periodNumber) {
      return a.periodNumber - b.periodNumber;
    }
    const timeCmp = compareTimestamps(a.timeIn, b.timeIn);
    if (timeCmp !== 0) return timeCmp;
    return a.sequenceNumber - b.sequenceNumber;
  });

  for (const p of sortedPresences) {
    const earliestTimeIn = earliestByPeriod.get(p.periodNumber);
    if (
      earliestTimeIn !== undefined &&
      compareTimestamps(p.timeIn, earliestTimeIn) === 0
    ) {
      const batch = periodStartPresences.get(p.periodNumber);
      if (batch) {
        batch.lineupIds.add(p.matchLineupId);
        batch.sequenceNumber = Math.min(batch.sequenceNumber, p.sequenceNumber);
      } else {
        periodStartPresences.set(p.periodNumber, {
          timestamp: p.timeIn,
          sequenceNumber: p.sequenceNumber,
          lineupIds: new Set([p.matchLineupId]),
        });
      }
      continue;
    }

    const exitKey = `${p.periodNumber}|${parseTimestampKey(p.timeIn)}`;
    const matchingExits = exitCountsByPeriodAndTimestamp.get(exitKey) ?? 0;
    if (matchingExits > 0) {
      exitCountsByPeriodAndTimestamp.set(exitKey, matchingExits - 1);
      continue;
    }

    items.push({
      kind: "MID_PERIOD_ENTRY",
      periodNumber: p.periodNumber,
      timestamp: p.timeIn,
      sequenceNumber: p.sequenceNumber,
      entryLineupId: p.matchLineupId,
      activeCountAtTimestamp: countActivePresencesAtEntry(
        presences,
        p.periodNumber,
        p.timeIn,
      ),
    });
  }

  for (const [periodNumber, batch] of periodStartPresences.entries()) {
    if (periodNumber > 1) {
      items.push({
        kind: "PERIOD_START_BATCH",
        periodNumber,
        timestamp: batch.timestamp,
        sequenceNumber: batch.sequenceNumber,
        periodStartCount: batch.lineupIds.size,
      });
    }
  }

  return items;
};

const KIND_PRIORITY: Record<TimelineItem["kind"], number> = {
  PERIOD_START_BATCH: 0,
  EVENT: 1,
  MID_PERIOD_ENTRY: 2,
};

const sortTimelineItems = (items: TimelineItem[]): TimelineItem[] => {
  return [...items].sort((a, b) => {
    if (a.periodNumber !== b.periodNumber) {
      return a.periodNumber - b.periodNumber;
    }
    const timeCmp = compareTimestamps(a.timestamp, b.timestamp);
    if (timeCmp !== 0) return timeCmp;
    if (a.kind !== b.kind) {
      return KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    }
    return a.sequenceNumber - b.sequenceNumber;
  });
};

const serveOneTimedPenalty = (
  queue: ActiveTimedPenalty[],
  preferredLineupId?: string,
): void => {
  if (queue.length === 0) return;
  if (preferredLineupId) {
    const playerIdx = queue.findIndex(
      (item) => item.matchLineupId === preferredLineupId,
    );
    if (playerIdx !== -1) {
      queue.splice(playerIdx, 1);
      return;
    }
  }
  queue.shift();
};

const trimQueueToCapacity = (
  queue: ActiveTimedPenalty[],
  maxUnservedAllowed: number,
  preferredLineupId?: string,
): void => {
  const targetLength = Math.max(0, maxUnservedAllowed);
  while (queue.length > targetLength) {
    serveOneTimedPenalty(queue, preferredLineupId);
  }
};

/**
 * Pure, deterministic derivation of match disciplinary state (personal fouls,
 * warnings, disqualifications, permanent no-sub reductions, and active FIFO
 * timed penalties) from persisted GameEvents and PlayerPresences.
 */
export const calculateDisciplinaryState = (
  input: CalculateDisciplinaryStateInput,
): MatchDisciplinaryState => {
  const safeLimit =
    typeof input.activePlayersLimit === "number" &&
    Number.isFinite(input.activePlayersLimit) &&
    input.activePlayersLimit > 0
      ? Math.floor(input.activePlayersLimit)
      : 0;
  const maxPersonalFouls = normalizeMaxPersonalFouls(input.maxPersonalFouls);

  const lineupSet = new Set(input.lineupIds);
  const playersById: Record<string, PlayerDisciplinaryStatus> = {};
  for (const id of lineupSet) {
    playersById[id] = createInitialPlayerStatus(id);
  }

  const relevantEvents = sortEventsChronologically(
    input.events.filter(
      (e) =>
        (lineupSet.size === 0 || lineupSet.has(e.matchLineupId)) &&
        (input.upToPeriodNumber === undefined ||
          e.periodNumber <= input.upToPeriodNumber),
    ),
  );

  const relevantPresences = input.presences.filter(
    (p) =>
      (lineupSet.size === 0 || lineupSet.has(p.matchLineupId)) &&
      (input.upToPeriodNumber === undefined ||
        p.periodNumber <= input.upToPeriodNumber),
  );

  const timelineItems: TimelineItem[] = [
    ...relevantEvents.map((event) => ({
      kind: "EVENT" as const,
      periodNumber: event.periodNumber,
      timestamp: event.eventTimestamp || event.createdAt,
      sequenceNumber: event.sequenceNumber,
      event,
      rule: resolveEffectiveDisciplinaryRule(event, input.definitionsById),
    })),
    ...buildPresenceTimelineItems(relevantPresences),
  ];

  const sortedTimeline = sortTimelineItems(timelineItems);
  const activeTimedPenalties: ActiveTimedPenalty[] = [];
  let permanentNoSubCount = 0;

  for (const item of sortedTimeline) {
    if (item.kind === "EVENT" && item.event && item.rule) {
      const playerId = item.event.matchLineupId;
      if (!playersById[playerId]) {
        playersById[playerId] = createInitialPlayerStatus(playerId);
      }

      const { isPermanentNoSub } = applyEventToPlayerStatus(
        playersById[playerId],
        item.rule,
        maxPersonalFouls,
      );
      if (isPermanentNoSub) {
        permanentNoSubCount += 1;
      }

      if (
        item.rule.penaltyDurationSeconds !== null &&
        item.rule.penaltyDurationSeconds > 0
      ) {
        activeTimedPenalties.push({
          eventId: item.event.id,
          matchLineupId: playerId,
          periodNumber: item.event.periodNumber,
          eventTimestamp: item.event.eventTimestamp,
          sequenceNumber: item.event.sequenceNumber,
          foulImpact: item.rule.foulImpact,
          penaltyDurationSeconds: item.rule.penaltyDurationSeconds,
        });
      }
      continue;
    }

    const currentMaxAllowed = Math.max(0, safeLimit - permanentNoSubCount);

    if (item.kind === "PERIOD_START_BATCH") {
      const startCount = item.periodStartCount ?? 0;
      const maxCarryoverAllowed = Math.max(0, currentMaxAllowed - startCount);
      trimQueueToCapacity(activeTimedPenalties, maxCarryoverAllowed);
      continue;
    }

    if (item.kind === "MID_PERIOD_ENTRY") {
      const activeAfterEntry = item.activeCountAtTimestamp ?? 0;
      const maxUnservedByCapacity = Math.max(
        0,
        currentMaxAllowed - activeAfterEntry,
      );
      const targetUnservedCount = Math.min(
        activeTimedPenalties.length,
        maxUnservedByCapacity,
      );
      trimQueueToCapacity(
        activeTimedPenalties,
        targetUnservedCount,
        item.entryLineupId,
      );
    }
  }

  for (const penalty of activeTimedPenalties) {
    const status = playersById[penalty.matchLineupId];
    if (status) {
      status.hasActiveTimedExclusion = true;
      status.activeTimedExclusionCount += 1;
    }
  }

  const maxAllowedActive = Math.max(0, safeLimit - permanentNoSubCount);
  const unservedTimedPenaltyCount = activeTimedPenalties.length;
  const currentActiveCount = input.activeLineupIds?.length ?? 0;
  const isShorthanded = currentActiveCount < maxAllowedActive;
  const shorthandedSlotsAvailable = Math.max(
    0,
    maxAllowedActive - currentActiveCount,
  );

  return {
    activePlayersLimit: safeLimit,
    maxPersonalFouls,
    permanentNoSubCount,
    maxAllowedActive,
    activeTimedPenalties,
    unservedTimedPenaltyCount,
    isShorthanded,
    shorthandedSlotsAvailable,
    playersById,
  };
};
