import { useState, useEffect, useMemo, useCallback } from "react";
import {
  reportService,
  type GameEventResponse,
  type MatchLineupResponse,
} from "../../../services/reportService";
import {
  db,
  type MatchLineupLookup,
  type EventDefinitionLookup,
} from "../../../db/ttaDatabase";

export interface SpatialReportFilters {
  periodNumber: number | null; // null = All
  selectedLineupIds: string[];
  selectedPositiveDefIds: string[];
  selectedNegativeDefIds: string[];
  activeTab: "all" | "positive" | "negative";
  displayMode: "scatter" | "heatmap";
  showGoalLeadVectors: boolean;
}

export interface UseSpatialReportProps {
  matchId: string;
  teamId?: string;
}

export function useSpatialReport({ matchId, teamId }: UseSpatialReportProps) {
  const [events, setEvents] = useState<GameEventResponse[]>([]);
  const [teamLineups, setTeamLineups] = useState<MatchLineupLookup[]>([]);
  const [eventDefinitionsMap, setEventDefinitionsMap] = useState<
    Map<string, EventDefinitionLookup>
  >(new Map());

  const [filters, setFilters] = useState<SpatialReportFilters>({
    periodNumber: null,
    selectedLineupIds: [],
    selectedPositiveDefIds: [],
    selectedNegativeDefIds: [],
    activeTab: "all",
    displayMode: "scatter",
    showGoalLeadVectors: true,
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;

    let isMounted = true;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // 1. Fetch match events from server API
        const fetchedEvents = await reportService.getMatchEvents(matchId);

        if (!isMounted) return;

        // 2. Filter events for active team (if teamId is provided)
        const teamEvents = teamId
          ? fetchedEvents.filter((ev) => ev.teamId === teamId)
          : fetchedEvents;

        // 3. Load team lineups: try server API when teamId is present, with IndexedDB and events fallbacks
        let lineups: MatchLineupLookup[] = [];

        if (teamId) {
          try {
            const response = await reportService.getTeamLineup(matchId, teamId);
            lineups = response.flatMap((lineup: MatchLineupResponse) => {
              if (!lineup.id || lineup.number == null) return [];
              return [
                {
                  id: lineup.id,
                  matchId,
                  playerRosterId: lineup.playerRosterId ?? "",
                  number: lineup.number,
                  positionId: lineup.positionId ?? "",
                },
              ];
            });
          } catch {
            lineups = [];
          }
        }

        if (lineups.length === 0) {
          try {
            lineups = await db.matchlineups
              .where("matchId")
              .equals(matchId)
              .toArray();
          } catch {
            lineups = [];
          }
        }

        // FALLBACK: If local DB and API return empty, dynamically construct roster from server event payload
        if (lineups.length === 0 && teamEvents.length > 0) {
          const lineupMap = new Map<string, MatchLineupLookup>();
          teamEvents.forEach((ev) => {
            if (ev.matchLineupId && !lineupMap.has(ev.matchLineupId)) {
              lineupMap.set(ev.matchLineupId, {
                id: ev.matchLineupId,
                matchId: matchId,
                playerRosterId: ev.matchLineupId,
                number: ev.playerNumber ?? 0,
                positionId: "",
              });
            }
          });
          lineups = Array.from(lineupMap.values()).sort(
            (a, b) => a.number - b.number,
          );
        }

        // 4. Fetch event definitions from local IndexedDB
        let defs: EventDefinitionLookup[] = [];
        try {
          defs = await db.eventdefinitions.toArray();
        } catch {
          defs = [];
        }

        const definitionsMap = new Map<string, EventDefinitionLookup>();
        defs.forEach((d) => definitionsMap.set(d.id, d));

        // SUPPLEMENT & OVERRIDE: Always enrich/override definitions map with server event metadata
        fetchedEvents.forEach((ev) => {
          if (ev.eventDefinitionId) {
            const existing = definitionsMap.get(ev.eventDefinitionId);
            definitionsMap.set(ev.eventDefinitionId, {
              id: ev.eventDefinitionId,
              sportId: existing?.sportId ?? "",
              name: ev.eventName || existing?.name || "Action",
              shortName: ev.eventName
                ? ev.eventName.substring(0, 4).toUpperCase()
                : existing?.shortName || "ACT",
              isPositive: ev.isPositive ?? existing?.isPositive ?? true,
            });
          }
        });

        if (isMounted) {
          setEvents(teamEvents);
          setTeamLineups(lineups);
          setEventDefinitionsMap(definitionsMap);
          // Reset player and action definition filters when changing active team
          setFilters((prev) => ({
            ...prev,
            selectedLineupIds: [],
            selectedPositiveDefIds: [],
            selectedNegativeDefIds: [],
          }));
        }
      } catch (err) {
        if (isMounted) {
          console.error("Failed to load match spatial analytics data:", err);
          setError("Failed to load spatial analytics data.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      isMounted = false;
    };
  }, [matchId, teamId]);

  // Compute filtered events based on active filters
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // Filter by period number (null = All)
      if (
        filters.periodNumber !== null &&
        ev.periodNumber !== filters.periodNumber
      ) {
        return false;
      }

      // Filter by selected player lineup IDs
      if (
        filters.selectedLineupIds.length > 0 &&
        (!ev.matchLineupId ||
          !filters.selectedLineupIds.includes(ev.matchLineupId))
      ) {
        return false;
      }

      // Filter by active category tab (Positive / Negative / All)
      if (filters.activeTab === "positive" && !ev.isPositive) return false;
      if (filters.activeTab === "negative" && ev.isPositive) return false;

      // Filter by specific event definition IDs
      if (
        filters.selectedPositiveDefIds.length > 0 &&
        ev.isPositive &&
        ev.eventDefinitionId &&
        !filters.selectedPositiveDefIds.includes(ev.eventDefinitionId)
      ) {
        return false;
      }

      if (
        filters.selectedNegativeDefIds.length > 0 &&
        !ev.isPositive &&
        ev.eventDefinitionId &&
        !filters.selectedNegativeDefIds.includes(ev.eventDefinitionId)
      ) {
        return false;
      }

      return true;
    });
  }, [events, filters]);

  const togglePeriodFilter = useCallback((period: number | null) => {
    setFilters((prev) => ({
      ...prev,
      periodNumber: prev.periodNumber === period ? null : period,
    }));
  }, []);

  const togglePlayerSelection = useCallback((lineupId: string) => {
    setFilters((prev) => {
      const exists = prev.selectedLineupIds.includes(lineupId);
      return {
        ...prev,
        selectedLineupIds: exists
          ? prev.selectedLineupIds.filter((id) => id !== lineupId)
          : [...prev.selectedLineupIds, lineupId],
      };
    });
  }, []);

  const handleSelectAllPlayers = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      selectedLineupIds: teamLineups.map((l) => l.id),
    }));
  }, [teamLineups]);

  const handleClearPlayerSelection = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      selectedLineupIds: [],
    }));
  }, []);

  const toggleActiveTab = useCallback(
    (tab: "all" | "positive" | "negative") => {
      setFilters((prev) => ({
        ...prev,
        activeTab: tab,
      }));
    },
    [],
  );

  const togglePositiveDefSelection = useCallback((defId: string) => {
    setFilters((prev) => {
      const exists = prev.selectedPositiveDefIds.includes(defId);
      return {
        ...prev,
        selectedPositiveDefIds: exists
          ? prev.selectedPositiveDefIds.filter((id) => id !== defId)
          : [...prev.selectedPositiveDefIds, defId],
      };
    });
  }, []);

  const toggleNegativeDefSelection = useCallback((defId: string) => {
    setFilters((prev) => {
      const exists = prev.selectedNegativeDefIds.includes(defId);
      return {
        ...prev,
        selectedNegativeDefIds: exists
          ? prev.selectedNegativeDefIds.filter((id) => id !== defId)
          : [...prev.selectedNegativeDefIds, defId],
      };
    });
  }, []);

  const toggleGoalLeadVectors = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      showGoalLeadVectors: !prev.showGoalLeadVectors,
    }));
  }, []);

  return {
    events,
    filteredEvents,
    teamLineups,
    eventDefinitionsMap,
    filters,
    isLoading,
    error,
    togglePeriodFilter,
    togglePlayerSelection,
    handleSelectAllPlayers,
    handleClearPlayerSelection,
    toggleActiveTab,
    togglePositiveDefSelection,
    toggleNegativeDefSelection,
    toggleGoalLeadVectors,
  };
}
