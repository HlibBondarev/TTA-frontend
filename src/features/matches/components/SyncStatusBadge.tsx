import React, { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "../../../db/ttaDatabase";

export const SyncStatusBadge: React.FC = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState<number>(0);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const subscription = liveQuery(async () => {
      if (!db?.syncQueue) return 0;
      return await db.syncQueue.count();
    }).subscribe({
      next: (count) => setPendingCount(count || 0),
      error: (err) => console.error("Failed to query syncQueue count:", err),
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold select-none">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          isOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
        }`}
      />
      <span className={isOnline ? "text-emerald-400" : "text-rose-400"}>
        {isOnline ? "Online" : "Offline"}
      </span>
      {pendingCount > 0 && (
        <span className="ml-1 px-1.5 py-0.2 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full">
          {pendingCount} pending
        </span>
      )}
    </div>
  );
};
