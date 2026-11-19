import {
  db,
  type TimeAnchor,
  type TimeAnchorSyncClaim,
} from "../db/ttaDatabase";

export type AnchorClaimOwner = "sync" | "undo";
type ClaimListener = () => void;

const CLAIM_TTL_MS = 60_000;

class AnchorClaimConflictError extends Error {
  constructor() {
    super("Anchor claim conflict");
  }
}

export interface CrossTabClaimResult {
  claimedIds: string[];
  allClaimed: boolean;
  token: string | null;
}

const canPersistClaimsInDb = (): boolean =>
  typeof db?.timeanchors?.get === "function" &&
  typeof db?.timeanchors?.update === "function";

const runAnchorWriteTx = async <T>(work: () => Promise<T>): Promise<T> => {
  if (typeof db?.transaction === "function") {
    return db.transaction("rw", [db.timeanchors], work);
  }
  return work();
};

const createClaimToken = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `claim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

/**
 * Coordinates same-tab and cross-tab claims on TimeAnchor IDs so manual/batch sync
 * and Undo End Period cannot concurrently operate on the same PeriodEnd anchor.
 * Cross-tab atomicity is enforced via IndexedDB rw transactions on db.timeanchors.
 */
class AnchorClaimService {
  private readonly claimedAnchors = new Map<string, AnchorClaimOwner>();
  private readonly ambiguousAnchors = new Set<string>();
  private readonly listeners = new Set<ClaimListener>();

  subscribe(listener: ClaimListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("[AnchorClaimService] Listener error:", err);
      }
    }
  }

  claim(anchorId: string, owner: AnchorClaimOwner): boolean {
    const normalized = anchorId?.trim();
    if (!normalized) return false;
    if (this.claimedAnchors.has(normalized)) {
      return false;
    }
    this.claimedAnchors.set(normalized, owner);
    this.notify();
    return true;
  }

  release(anchorId: string, owner?: AnchorClaimOwner): void {
    const normalized = anchorId?.trim();
    if (!normalized) return;
    if (owner && this.claimedAnchors.get(normalized) !== owner) {
      return;
    }
    if (this.claimedAnchors.delete(normalized)) {
      this.notify();
    }
  }

  isClaimed(anchorId: string): boolean {
    const normalized = anchorId?.trim();
    if (!normalized) return false;
    return this.claimedAnchors.has(normalized);
  }

  hasActiveClaim(
    anchor: Pick<TimeAnchor, "syncClaim"> | undefined,
    now: number = Date.now(),
  ): boolean {
    const claim = anchor?.syncClaim;
    return Boolean(claim && claim.expiresAt > now);
  }

  hasAmbiguousOutcome(
    anchor: Pick<TimeAnchor, "id" | "syncOutcomeAmbiguous"> | undefined,
  ): boolean {
    if (!anchor) return false;
    if (anchor.syncOutcomeAmbiguous) return true;
    const normalized = anchor.id?.trim();
    return Boolean(normalized && this.ambiguousAnchors.has(normalized));
  }

  async markAmbiguousAcrossTabs(anchorIds: string[]): Promise<void> {
    const uniqueIds = Array.from(
      new Set(anchorIds.map((id) => id?.trim()).filter(Boolean)),
    );
    if (uniqueIds.length === 0) return;

    for (const id of uniqueIds) {
      this.ambiguousAnchors.add(id);
    }
    this.notify();

    if (!canPersistClaimsInDb()) return;

    try {
      await runAnchorWriteTx(async () => {
        for (const id of uniqueIds) {
          const existing = await db.timeanchors.get(id);
          if (existing && existing.isSynced === 0) {
            await db.timeanchors.update(id, { syncOutcomeAmbiguous: true });
          }
        }
      });
    } catch (err) {
      console.error(
        "[AnchorClaimService] Failed to persist ambiguous sync state:",
        err,
      );
    }
  }

  async clearAmbiguousAcrossTabs(anchorIds: string[]): Promise<void> {
    const uniqueIds = Array.from(
      new Set(anchorIds.map((id) => id?.trim()).filter(Boolean)),
    );
    if (uniqueIds.length === 0) return;

    let changed = false;
    for (const id of uniqueIds) {
      if (this.ambiguousAnchors.delete(id)) {
        changed = true;
      }
    }
    if (changed) {
      this.notify();
    }

    if (!canPersistClaimsInDb()) return;

    try {
      await runAnchorWriteTx(async () => {
        for (const id of uniqueIds) {
          const existing = await db.timeanchors.get(id);
          if (existing?.syncOutcomeAmbiguous) {
            await db.timeanchors.update(id, {
              syncOutcomeAmbiguous: undefined,
            });
          }
        }
      });
    } catch (err) {
      console.error(
        "[AnchorClaimService] Failed to clear ambiguous sync state:",
        err,
      );
    }
  }

  async claimAcrossTabs(
    anchorIds: string[],
    owner: AnchorClaimOwner,
  ): Promise<CrossTabClaimResult> {
    const uniqueIds = Array.from(
      new Set(anchorIds.map((id) => id?.trim()).filter(Boolean)),
    );
    if (uniqueIds.length === 0) {
      return { claimedIds: [], allClaimed: true, token: null };
    }

    const memoryClaimed: string[] = [];
    for (const id of uniqueIds) {
      if (!this.claim(id, owner)) {
        for (const claimedId of memoryClaimed) {
          this.release(claimedId, owner);
        }
        return { claimedIds: [], allClaimed: false, token: null };
      }
      memoryClaimed.push(id);
    }

    const token = createClaimToken();
    if (!canPersistClaimsInDb()) {
      return { claimedIds: memoryClaimed, allClaimed: true, token };
    }

    const now = Date.now();
    const claimRecord: TimeAnchorSyncClaim = {
      owner,
      token,
      expiresAt: now + CLAIM_TTL_MS,
    };

    try {
      await runAnchorWriteTx(async () => {
        for (const id of memoryClaimed) {
          const existing = await db.timeanchors.get(id);
          if (
            !existing ||
            existing.isSynced !== 0 ||
            this.hasActiveClaim(existing, now)
          ) {
            throw new AnchorClaimConflictError();
          }
          await db.timeanchors.update(id, { syncClaim: claimRecord });
        }
      });
      return { claimedIds: memoryClaimed, allClaimed: true, token };
    } catch (err) {
      for (const claimedId of memoryClaimed) {
        this.release(claimedId, owner);
      }
      if (err instanceof AnchorClaimConflictError) {
        return { claimedIds: [], allClaimed: false, token: null };
      }
      throw err;
    }
  }

  async releaseAcrossTabs(
    anchorIds: string[],
    token: string | null,
    owner: AnchorClaimOwner,
  ): Promise<void> {
    for (const id of anchorIds) {
      this.release(id, owner);
    }

    if (!token || anchorIds.length === 0 || !canPersistClaimsInDb()) {
      return;
    }

    try {
      await runAnchorWriteTx(async () => {
        for (const id of anchorIds) {
          const existing = await db.timeanchors.get(id);
          if (existing?.syncClaim?.token === token) {
            await db.timeanchors.update(id, { syncClaim: undefined });
          }
        }
      });
    } catch (err) {
      console.error("[AnchorClaimService] Failed to release DB anchor claim:", err);
    }
  }

  clearAll(): void {
    if (this.claimedAnchors.size === 0 && this.ambiguousAnchors.size === 0) {
      return;
    }
    this.claimedAnchors.clear();
    this.ambiguousAnchors.clear();
    this.notify();
  }
}

export const anchorClaimService = new AnchorClaimService();
