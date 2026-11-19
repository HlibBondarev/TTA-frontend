type AnchorClaimOwner = "sync" | "undo";
type ClaimListener = () => void;

/**
 * Coordinates in-memory claims on TimeAnchor IDs so manual/batch sync and
 * Undo End Period cannot concurrently operate on the same PeriodEnd anchor.
 */
class AnchorClaimService {
  private readonly claimedAnchors = new Map<string, AnchorClaimOwner>();
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

  clearAll(): void {
    if (this.claimedAnchors.size === 0) return;
    this.claimedAnchors.clear();
    this.notify();
  }
}

export const anchorClaimService = new AnchorClaimService();
