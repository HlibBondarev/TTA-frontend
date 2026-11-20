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
  maxPersonalFouls: number | null | undefined;
  isMaxPersonalFoulsKnown: boolean;
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
  if (
    typeof value === "string" &&
    VALID_FOUL_IMPACTS.has(value as FoulImpact)
  ) {
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

/**
 * Normalizes backend/client ISO 8601 date-time strings for Date.parse().
 * .NET System.Text.Json serializes DateTime / DateTimeOffset with up to 7
 * fractional second digits (100ns ticks, e.g. "2026-11-20T10:01:00.1234567Z"
 * or "2026-11-20T12:01:00.1234567+02:00"), while ECMA-262 only guarantees
 * parsing 3 millisecond digits. Truncating sub-millisecond digits (>3) to 3
 * ensures deterministic Date.parse() results across all JS engines.
 */
const normalizeIsoTimestampForParse = (raw: string): string =>
  raw.replace(/(\.\d{3})\d+(?=[Z+-]|$)/i, "$1");

const parseTimestampMs = (timestamp?: string | null): number => {
  if (!timestamp) return Number.NaN;
  const trimmed = timestamp.trim();
  if (!trimmed) return Number.NaN;
  return Date.parse(normalizeIsoTimestampForParse(trimmed));
};

const parseTimestampKey = (timestamp?: string | null): number | string => {
  if (!timestamp) return "";
  const parsed = parseTimestampMs(timestamp);
  return Number.isNaN(parsed) ? timestamp : parsed;
};

const compareTimestamps = (a = "", b = ""): number => {
  const timeA = parseTimestampMs(a);
  const timeB = parseTimestampMs(b);
  if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
    return timeA - timeB;
  }
  return a.localeCompare(b);
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

const normalizeActivePlayersLimit = (limit: number): number => {
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return Math.floor(limit);
  }
  return 0;
};

const normalizeMaxPersonalFouls = (
  maxPersonalFouls: number | null | undefined,
): number | null | undefined => {
  if (maxPersonalFouls === undefined) {
    return undefined;
  }
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
  maxPersonalFouls: number | null | undefined,
): { isPermanentNoSub: boolean } => {
  let isPermanentNoSub = false;

  if (rule.foulImpact === "PersonalFoul") {
    if (maxPersonalFouls !== null) {
      status.personalFoulCount += 1;
      if (
        maxPersonalFouls !== undefined &&
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

  if (typeof maxPersonalFouls === "number" && maxPersonalFouls > 1) {
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
  periodStartLineupIds?: ReadonlySet<string>;
}

interface PeriodStartBatch {
  timestamp: string;
  sequenceNumber: number;
  lineupIds: Set<string>;
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
  sortedPresences: readonly PlayerPresence[],
  entryIndex: number,
  periodNumber: number,
  entryTimeIn: string,
): number => {
  const activeIds = new Set<string>();
  for (let idx = 0; idx <= entryIndex; idx += 1) {
    const p = sortedPresences[idx];
    if (p.periodNumber !== periodNumber) continue;
    const stillOpenAfterEntry =
      p.timeOut === null || compareTimestamps(p.timeOut, entryTimeIn) > 0;
    if (stillOpenAfterEntry) {
      activeIds.add(p.matchLineupId);
    }
  }
  return activeIds.size;
};

const countExitsByPeriodAndTimestamp = (
  presences: PlayerPresence[],
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const p of presences) {
    if (p.timeOut !== null) {
      const key = `${p.periodNumber}|${parseTimestampKey(p.timeOut)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
};

const sortPresencesChronologically = (
  presences: PlayerPresence[],
): PlayerPresence[] =>
  [...presences].sort((a, b) => {
    if (a.periodNumber !== b.periodNumber) {
      return a.periodNumber - b.periodNumber;
    }
    const timeCmp = compareTimestamps(a.timeIn, b.timeIn);
    if (timeCmp !== 0) return timeCmp;
    return a.sequenceNumber - b.sequenceNumber;
  });

const isPeriodStartPresence = (
  presence: PlayerPresence,
  earliestByPeriod: ReadonlyMap<number, string>,
): boolean => {
  const earliestTimeIn = earliestByPeriod.get(presence.periodNumber);
  return (
    earliestTimeIn !== undefined &&
    compareTimestamps(presence.timeIn, earliestTimeIn) === 0
  );
};

const recordPeriodStartPresence = (
  batches: Map<number, PeriodStartBatch>,
  presence: PlayerPresence,
): void => {
  const existing = batches.get(presence.periodNumber);
  if (existing) {
    existing.lineupIds.add(presence.matchLineupId);
    existing.sequenceNumber = Math.min(
      existing.sequenceNumber,
      presence.sequenceNumber,
    );
    return;
  }
  batches.set(presence.periodNumber, {
    timestamp: presence.timeIn,
    sequenceNumber: presence.sequenceNumber,
    lineupIds: new Set([presence.matchLineupId]),
  });
};

const consumeMatchingExit = (
  exitCounts: Map<string, number>,
  presence: PlayerPresence,
): boolean => {
  const exitKey = `${presence.periodNumber}|${parseTimestampKey(presence.timeIn)}`;
  const matchingExits = exitCounts.get(exitKey) ?? 0;
  if (matchingExits <= 0) return false;
  exitCounts.set(exitKey, matchingExits - 1);
  return true;
};

const buildPeriodStartBatchItems = (
  batches: ReadonlyMap<number, PeriodStartBatch>,
): TimelineItem[] => {
  const items: TimelineItem[] = [];
  for (const [periodNumber, batch] of batches.entries()) {
    if (periodNumber > 1) {
      items.push({
        kind: "PERIOD_START_BATCH",
        periodNumber,
        timestamp: batch.timestamp,
        sequenceNumber: batch.sequenceNumber,
        periodStartCount: batch.lineupIds.size,
        periodStartLineupIds: batch.lineupIds,
      });
    }
  }
  return items;
};

const buildPresenceTimelineItems = (
  presences: PlayerPresence[],
): TimelineItem[] => {
  const earliestByPeriod = findEarliestTimeInByPeriod(presences);
  const exitCountsByPeriodAndTimestamp =
    countExitsByPeriodAndTimestamp(presences);
  const periodStartPresences = new Map<number, PeriodStartBatch>();
  const items: TimelineItem[] = [];
  const sortedPresences = sortPresencesChronologically(presences);

  for (let idx = 0; idx < sortedPresences.length; idx += 1) {
    const p = sortedPresences[idx];
    if (isPeriodStartPresence(p, earliestByPeriod)) {
      recordPeriodStartPresence(periodStartPresences, p);
      continue;
    }

    if (consumeMatchingExit(exitCountsByPeriodAndTimestamp, p)) {
      continue;
    }

    items.push({
      kind: "MID_PERIOD_ENTRY",
      periodNumber: p.periodNumber,
      timestamp: p.timeIn,
      sequenceNumber: p.sequenceNumber,
      entryLineupId: p.matchLineupId,
      activeCountAtTimestamp: countActivePresencesAtEntry(
        sortedPresences,
        idx,
        p.periodNumber,
        p.timeIn,
      ),
    });
  }

  return [...items, ...buildPeriodStartBatchItems(periodStartPresences)];
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
  preferredLineupIds?: ReadonlySet<string>,
): void => {
  if (queue.length === 0) return;
  if (preferredLineupIds && preferredLineupIds.size > 0) {
    const playerIdx = queue.findIndex((item) =>
      preferredLineupIds.has(item.matchLineupId),
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
  preferredLineupIds?: ReadonlySet<string>,
): void => {
  const targetLength = Math.max(0, maxUnservedAllowed);
  while (queue.length > targetLength) {
    serveOneTimedPenalty(queue, preferredLineupIds);
  }
};

const isRecordInScope = (
  lineupId: string,
  periodNumber: number,
  lineupSet: ReadonlySet<string>,
  upToPeriodNumber?: number,
): boolean => {
  const matchesLineup = lineupSet.size === 0 || lineupSet.has(lineupId);
  const matchesPeriod =
    upToPeriodNumber === undefined || periodNumber <= upToPeriodNumber;
  return matchesLineup && matchesPeriod;
};

const initializePlayersById = (
  lineupSet: ReadonlySet<string>,
): Record<string, PlayerDisciplinaryStatus> => {
  const playersById: Record<string, PlayerDisciplinaryStatus> = {};
  for (const id of lineupSet) {
    playersById[id] = createInitialPlayerStatus(id);
  }
  return playersById;
};

const applyTimelineEvent = (
  event: GameEvent,
  rule: EffectiveDisciplinaryRule,
  playersById: Record<string, PlayerDisciplinaryStatus>,
  maxPersonalFouls: number | null | undefined,
  activeTimedPenalties: ActiveTimedPenalty[],
): number => {
  const playerId = event.matchLineupId;
  if (!playersById[playerId]) {
    playersById[playerId] = createInitialPlayerStatus(playerId);
  }

  const { isPermanentNoSub } = applyEventToPlayerStatus(
    playersById[playerId],
    rule,
    maxPersonalFouls,
  );

  if (rule.penaltyDurationSeconds !== null && rule.penaltyDurationSeconds > 0) {
    activeTimedPenalties.push({
      eventId: event.id,
      matchLineupId: playerId,
      periodNumber: event.periodNumber,
      eventTimestamp: event.eventTimestamp,
      sequenceNumber: event.sequenceNumber,
      foulImpact: rule.foulImpact,
      penaltyDurationSeconds: rule.penaltyDurationSeconds,
    });
  }

  return isPermanentNoSub ? 1 : 0;
};

const servePenaltiesForStartingLineup = (
  queue: ActiveTimedPenalty[],
  startingLineupIds?: ReadonlySet<string>,
): void => {
  if (!startingLineupIds || startingLineupIds.size === 0 || queue.length === 0) {
    return;
  }
  for (const lineupId of startingLineupIds) {
    const playerIdx = queue.findIndex(
      (item) => item.matchLineupId === lineupId,
    );
    if (playerIdx !== -1) {
      queue.splice(playerIdx, 1);
    }
  }
};

const applyTimelinePresenceAdjustment = (
  item: TimelineItem,
  activeTimedPenalties: ActiveTimedPenalty[],
  currentMaxAllowed: number,
): void => {
  if (item.kind === "PERIOD_START_BATCH") {
    servePenaltiesForStartingLineup(
      activeTimedPenalties,
      item.periodStartLineupIds,
    );
    const startCount = item.periodStartCount ?? 0;
    const maxCarryoverAllowed = Math.max(0, currentMaxAllowed - startCount);
    trimQueueToCapacity(activeTimedPenalties, maxCarryoverAllowed);
    return;
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
      item.entryLineupId ? new Set([item.entryLineupId]) : undefined,
    );
  }
};

const replayTimelineItems = (
  sortedTimeline: TimelineItem[],
  playersById: Record<string, PlayerDisciplinaryStatus>,
  safeLimit: number,
  maxPersonalFouls: number | null | undefined,
): {
  activeTimedPenalties: ActiveTimedPenalty[];
  permanentNoSubCount: number;
} => {
  const activeTimedPenalties: ActiveTimedPenalty[] = [];
  let permanentNoSubCount = 0;

  for (const item of sortedTimeline) {
    if (item.kind === "EVENT" && item.event && item.rule) {
      permanentNoSubCount += applyTimelineEvent(
        item.event,
        item.rule,
        playersById,
        maxPersonalFouls,
        activeTimedPenalties,
      );
      continue;
    }

    const currentMaxAllowed = Math.max(0, safeLimit - permanentNoSubCount);
    applyTimelinePresenceAdjustment(
      item,
      activeTimedPenalties,
      currentMaxAllowed,
    );
  }

  return { activeTimedPenalties, permanentNoSubCount };
};

const applyActiveTimedPenaltiesToPlayers = (
  playersById: Record<string, PlayerDisciplinaryStatus>,
  activeTimedPenalties: readonly ActiveTimedPenalty[],
): void => {
  for (const penalty of activeTimedPenalties) {
    const status = playersById[penalty.matchLineupId];
    if (status) {
      status.hasActiveTimedExclusion = true;
      status.activeTimedExclusionCount += 1;
    }
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
  const safeLimit = normalizeActivePlayersLimit(input.activePlayersLimit);
  const maxPersonalFouls = normalizeMaxPersonalFouls(input.maxPersonalFouls);
  const lineupSet = new Set(input.lineupIds);
  const playersById = initializePlayersById(lineupSet);

  const relevantEvents = sortEventsChronologically(
    input.events.filter((e) =>
      isRecordInScope(
        e.matchLineupId,
        e.periodNumber,
        lineupSet,
        input.upToPeriodNumber,
      ),
    ),
  );

  const relevantPresences = input.presences.filter((p) =>
    isRecordInScope(
      p.matchLineupId,
      p.periodNumber,
      lineupSet,
      input.upToPeriodNumber,
    ),
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

  const { activeTimedPenalties, permanentNoSubCount } = replayTimelineItems(
    sortTimelineItems(timelineItems),
    playersById,
    safeLimit,
    maxPersonalFouls,
  );

  applyActiveTimedPenaltiesToPlayers(playersById, activeTimedPenalties);

  const maxAllowedActive = Math.max(0, safeLimit - permanentNoSubCount);
  const currentActiveCount = input.activeLineupIds?.length ?? 0;

  return {
    activePlayersLimit: safeLimit,
    maxPersonalFouls,
    isMaxPersonalFoulsKnown: maxPersonalFouls !== undefined,
    permanentNoSubCount,
    maxAllowedActive,
    activeTimedPenalties,
    unservedTimedPenaltyCount: activeTimedPenalties.length,
    isShorthanded: currentActiveCount < maxAllowedActive,
    shorthandedSlotsAvailable: Math.max(
      0,
      maxAllowedActive - currentActiveCount,
    ),
    playersById,
  };
};
