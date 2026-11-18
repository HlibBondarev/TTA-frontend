/**
 * Returns true when an event is a scoring event (score > 0).
 * The event's own score takes precedence over its definition's score.
 */
export const isScoringEvent = (
  event: { score?: number | null },
  definition?: { score?: number | null },
): boolean => (event.score ?? definition?.score ?? 0) > 0;
