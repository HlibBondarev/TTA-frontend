import { describe, it, expect, beforeEach } from "vitest";
import { matchLockService } from "../../services/matchLockService";

describe("matchLockService", () => {
  beforeEach(() => {
    matchLockService.clearAllMatchLocks();
  });

  it("should return false for unlocked match", () => {
    expect(matchLockService.isMatchLocked("match-123")).toBe(false);
  });

  it("should correctly lock and identify a locked match", () => {
    matchLockService.lockMatchForFinalization("match-123");
    expect(matchLockService.isMatchLocked("match-123")).toBe(true);
    expect(matchLockService.isMatchLocked("match-456")).toBe(false);
  });

  it("should trim matchId whitespace when locking and checking status", () => {
    matchLockService.lockMatchForFinalization("  match-123  ");
    expect(matchLockService.isMatchLocked("match-123")).toBe(true);
    expect(matchLockService.isMatchLocked(" match-123 ")).toBe(true);
  });

  it("should unlock a locked match", () => {
    matchLockService.lockMatchForFinalization("match-123");
    expect(matchLockService.isMatchLocked("match-123")).toBe(true);

    matchLockService.unlockMatchForFinalization("match-123");
    expect(matchLockService.isMatchLocked("match-123")).toBe(false);
  });

  it("should safely handle empty or invalid matchId values", () => {
    matchLockService.lockMatchForFinalization("");
    expect(matchLockService.isMatchLocked("")).toBe(false);

    matchLockService.unlockMatchForFinalization("   ");
    expect(matchLockService.isMatchLocked("   ")).toBe(false);
  });

  it("should clear all locks when clearAllMatchLocks is called", () => {
    matchLockService.lockMatchForFinalization("match-1");
    matchLockService.lockMatchForFinalization("match-2");

    expect(matchLockService.isMatchLocked("match-1")).toBe(true);
    expect(matchLockService.isMatchLocked("match-2")).toBe(true);

    matchLockService.clearAllMatchLocks();

    expect(matchLockService.isMatchLocked("match-1")).toBe(false);
    expect(matchLockService.isMatchLocked("match-2")).toBe(false);
  });
});
