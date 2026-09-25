const lockedMatches = new Set<string>();

export const matchLockService = {
  /**
   * Locks the specified matchId to prevent concurrent writes during finalization.
   */
  lockMatchForFinalization(matchId: string): void {
    const normalized = matchId?.trim();
    if (normalized) {
      lockedMatches.add(normalized);
    }
  },

  /**
   * Releases the finalization write lock for the specified matchId.
   */
  unlockMatchForFinalization(matchId: string): void {
    const normalized = matchId?.trim();
    if (normalized) {
      lockedMatches.delete(normalized);
    }
  },

  /**
   * Checks whether the specified matchId is currently locked for finalization.
   */
  isMatchLocked(matchId: string): boolean {
    const normalized = matchId?.trim();
    if (!normalized) return false;
    return lockedMatches.has(normalized);
  },

  /**
   * Clears all active match locks (primarily used for test teardown).
   */
  clearAllMatchLocks(): void {
    lockedMatches.clear();
  },
};
