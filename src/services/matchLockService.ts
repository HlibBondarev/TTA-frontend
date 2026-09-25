type LockListener = () => void;

class MatchLockService {
  private readonly lockedMatches: Set<string> = new Set<string>();
  private readonly listeners: Set<LockListener> = new Set<LockListener>();

  /**
   * Subscribes a listener to match lock state changes.
   */
  subscribe(listener: LockListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener: LockListener) => {
      try {
        listener();
      } catch (err) {
        console.error("[MatchLockService] Listener error:", err);
      }
    });
  }

  lockMatchForFinalization(matchId: string): void {
    if (!matchId?.trim()) return;
    this.lockedMatches.add(matchId.trim());
    this.notify();
  }

  unlockMatchForFinalization(matchId: string): void {
    if (!matchId?.trim()) return;
    this.lockedMatches.delete(matchId.trim());
    this.notify();
  }

  unlockMatch(matchId: string): void {
    this.unlockMatchForFinalization(matchId);
  }

  isMatchLocked(matchId: string): boolean {
    if (!matchId?.trim()) return false;
    return this.lockedMatches.has(matchId.trim());
  }

  clearAllMatchLocks(): void {
    this.lockedMatches.clear();
    this.notify();
  }
}

export const matchLockService = new MatchLockService();
