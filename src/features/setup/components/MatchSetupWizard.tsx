import React, { useEffect, useState, useCallback, useRef } from "react";
import { sportService } from "../../../services/sportService";
import { teamService } from "../../../services/teamService";
import { apiClient } from "../../../api/client";
import { db } from "../../../db/ttaDatabase";
import type {
  SportLookup,
  SportConfigurationLookup,
  MatchLookup,
  TeamLookup,
} from "../../../db/ttaDatabase";

interface MatchSetupWizardProps {
  onQuickStart: (
    matchId: string,
    sportId: string,
    configurationId: string,
    activePlayersLimit: number,
    selectedTeamId: string,
  ) => Promise<void>;
}

async function ensureTournamentPersisted(
  tournamentId: string,
  sportId: string,
  configurationId: string,
): Promise<void> {
  if (!db.tournaments) return;

  try {
    const tournament = await apiClient.get<{
      id: string;
      sportId: string;
      configurationId: string;
    }>(`/Tournaments/${tournamentId}`);

    if (tournament) {
      await db.tournaments.put(
        tournament as unknown as Parameters<typeof db.tournaments.put>[0],
      );
    }
  } catch {
    const existingTourn = await db.tournaments.get(tournamentId);
    if (!existingTourn) {
      await db.tournaments.put({
        id: tournamentId,
        sportId,
        configurationId,
        cityId: "",
        ownerId: "",
        name: "Quick Tournament",
        startDate: new Date().toISOString(),
        endDate: null,
        createdAt: new Date().toISOString(),
      });
    }
  }
}

export const MatchSetupWizard: React.FC<MatchSetupWizardProps> = ({
  onQuickStart,
}) => {
  const [sports, setSports] = useState<SportLookup[]>([]);
  const [selectedSportId, setSelectedSportId] = useState<string | null>(null);

  const [configurations, setConfigurations] = useState<
    SportConfigurationLookup[]
  >([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  // Quick match draft context for team selection
  const [pendingMatchId, setPendingMatchId] = useState<string | null>(null);
  const [teams, setTeams] = useState<{
    home: TeamLookup;
    guest: TeamLookup;
  } | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const [isLoadingSports, setIsLoadingSports] = useState<boolean>(true);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState<boolean>(false);
  const [isLoadingTeams, setIsLoadingTeams] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const configRequestRef = useRef(0);

  const loadConfigurations = useCallback(
    async (sportId: string, sportList: SportLookup[]) => {
      const requestId = ++configRequestRef.current;
      try {
        setIsLoadingConfigs(true);
        setErrorMessage(null);
        const data = await sportService.getSportConfigurations(sportId);

        if (requestId !== configRequestRef.current) return;

        setConfigurations(data);

        // Persist retrieved configurations to IndexedDB immediately
        if (data.length > 0 && db.sportconfigurations) {
          await db.sportconfigurations.bulkPut(data);
        }

        const currentSport = sportList.find((s) => s.id === sportId);
        const defaultConfig = data.find(
          (c) => c.id === currentSport?.defaultConfigId,
        );

        if (defaultConfig) {
          setSelectedConfigId(defaultConfig.id);
        } else if (data.length > 0) {
          setSelectedConfigId(data[0].id);
        } else {
          setSelectedConfigId(null);
        }
      } catch (err) {
        if (requestId !== configRequestRef.current) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Failed to load sport configurations.",
        );
        setConfigurations([]);
        setSelectedConfigId(null);
      } finally {
        if (requestId === configRequestRef.current) {
          setIsLoadingConfigs(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    const fetchSports = async () => {
      try {
        setIsLoadingSports(true);
        setErrorMessage(null);
        const data = await sportService.getSports();

        if (!isMounted) return;

        setSports(data);

        // Persist sports to IndexedDB
        if (data.length > 0 && db.sports) {
          await db.sports.bulkPut(data);
        }

        if (data.length > 0) {
          const firstSportId = data[0].id;
          setSelectedSportId(firstSportId);
          await loadConfigurations(firstSportId, data);
        }
      } catch (err) {
        if (!isMounted) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Failed to load sports disciplines.",
        );
      } finally {
        if (isMounted) {
          setIsLoadingSports(false);
        }
      }
    };

    fetchSports();

    return () => {
      isMounted = false;
    };
  }, [loadConfigurations]);

  const handleSelectSport = async (sportId: string) => {
    if (selectedSportId === sportId || pendingMatchId) return;
    setSelectedSportId(sportId);
    setSelectedConfigId(null);
    setPendingMatchId(null);
    setTeams(null);
    setSelectedTeamId(null);
    await loadConfigurations(sportId, sports);
  };

  // Step A: Create quick match (or reuse pendingMatchId) and load participating teams
  const handleInitMatch = async () => {
    if (!selectedSportId || !selectedConfigId || isSubmitting) return;

    try {
      setIsSubmitting(true);
      setIsLoadingTeams(true);
      setErrorMessage(null);

      // Ensure the chosen configuration is explicitly in Dexie before proceeding
      const selectedConfig = configurations.find(
        (c) => c.id === selectedConfigId,
      );
      if (selectedConfig && db.sportconfigurations) {
        await db.sportconfigurations.put(selectedConfig);
      }

      let matchId = pendingMatchId;

      if (!matchId) {
        const response = await apiClient.post<{ id: string }>(
          "/Matches/quick",
          {
            sportId: selectedSportId,
            configurationId: selectedConfigId,
          },
        );
        matchId = response.id;
        setPendingMatchId(matchId);
      }

      const match = await apiClient.get<MatchLookup>(`/Matches/${matchId}`);

      // Store match locally
      if (match && db.matches) {
        await db.matches.put(match);
      }

      // If match points to a tournament, ensure tournament is also stored
      if (match.tournamentId) {
        await ensureTournamentPersisted(
          match.tournamentId,
          selectedSportId,
          selectedConfigId,
        );
      }

      const [home, guest] = await Promise.all([
        teamService.getTeamById(match.homeTeamId),
        teamService.getTeamById(match.guestTeamId),
      ]);

      setTeams({ home, guest });
      setSelectedTeamId((prev) => prev ?? home.id);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to initialize quick match session.",
      );
    } finally {
      setIsSubmitting(false);
      setIsLoadingTeams(false);
    }
  };

  // Step B: Confirm team selection and proceed to console
  const handleConfirmQuickStart = async () => {
    if (
      !pendingMatchId ||
      !selectedSportId ||
      !selectedConfigId ||
      !selectedTeamId ||
      isSubmitting
    )
      return;

    const selectedConfig = configurations.find(
      (c) => c.id === selectedConfigId,
    );
    const activePlayersLimit = selectedConfig?.activePlayersLimit ?? 7;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      await onQuickStart(
        pendingMatchId,
        selectedSportId,
        selectedConfigId,
        activePlayersLimit,
        selectedTeamId,
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to complete match setup.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderConfigurationsContent = () => {
    if (isLoadingConfigs) {
      return (
        <div className="p-4 text-center text-xs text-gray-500 bg-gray-900 rounded-xl border border-gray-800">
          Loading configurations...
        </div>
      );
    }

    if (configurations.length === 0) {
      return (
        <div className="p-4 text-center text-xs text-gray-500 bg-gray-900 rounded-xl border border-gray-800">
          No configurations available for this sport.
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-2">
        {configurations.map((config) => (
          <button
            key={config.id}
            type="button"
            disabled={!!pendingMatchId}
            onClick={() => {
              if (!pendingMatchId) {
                setSelectedConfigId(config.id);
              }
            }}
            aria-pressed={selectedConfigId === config.id}
            className={`p-3 rounded-xl text-xs text-left transition-colors border ${
              selectedConfigId === config.id
                ? "bg-emerald-600 border-emerald-500 text-white font-bold"
                : "bg-gray-900 border-gray-800 text-gray-300 hover:bg-gray-800"
            }`}
          >
            <div className="flex justify-between items-center mb-1">
              <span>
                Periods: {config.periodsCount} ({config.periodDurationMinutes}{" "}
                min)
              </span>
              <span className="text-[10px] opacity-75">
                {config.usesCleanTime ? "Clean Time" : "Running Time"}
              </span>
            </div>
            <div className="text-[10px] opacity-75">
              Field: {config.fieldSize} | Active Players:{" "}
              {config.activePlayersLimit}
            </div>
          </button>
        ))}
      </div>
    );
  };

  if (isLoadingSports) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6 text-gray-400 text-sm">
        Loading sports disciplines...
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col flex-1 p-4 bg-gray-950 text-gray-100 overflow-y-auto">
      <h2 className="text-sm font-black uppercase text-blue-500 mb-4 text-center tracking-wider">
        Match Setup Wizard
      </h2>

      {errorMessage && (
        <div
          role="alert"
          className="mb-3 p-2 text-xs bg-red-900/50 border border-red-800 text-red-200 rounded text-center font-medium"
        >
          {errorMessage}
        </div>
      )}

      {/* Step 1: Sport Discipline Selection */}
      <fieldset className="mb-4 min-w-0 border-0 p-0 m-0">
        <legend className="block text-[10px] uppercase text-gray-400 mb-1.5 font-bold p-0">
          1. Select Sport Discipline
        </legend>
        <div className="grid grid-cols-1 gap-2">
          {sports.map((sport) => (
            <button
              key={sport.id}
              type="button"
              disabled={!!pendingMatchId}
              onClick={() => void handleSelectSport(sport.id)}
              aria-pressed={selectedSportId === sport.id}
              className={`p-3 rounded-xl text-xs font-semibold text-left transition-colors flex items-center justify-between border ${
                selectedSportId === sport.id
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "bg-gray-900 border-gray-800 text-gray-300 hover:bg-gray-800"
              }`}
            >
              <span>{sport.name}</span>
              <span className="text-[10px] opacity-75 uppercase px-1.5 py-0.5 bg-black/20 rounded">
                {sport.shortName}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Step 2: Sport Configuration Selection */}
      <fieldset className="mb-6 flex-1 min-w-0 border-0 p-0 m-0">
        <legend className="block text-[10px] uppercase text-gray-400 mb-1.5 font-bold p-0">
          2. Select Configuration Profile
        </legend>
        {renderConfigurationsContent()}
      </fieldset>

      {/* Step 3: Team Selection (Revealed once match is initialized) */}
      {teams && (
        <fieldset className="mb-6 min-w-0 border-0 p-0 m-0">
          <legend className="block text-[10px] uppercase text-gray-400 mb-1.5 font-bold p-0">
            3. Select Team to Track
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSelectedTeamId(teams.home.id)}
              aria-pressed={selectedTeamId === teams.home.id}
              className={`p-3 rounded-xl text-xs font-bold text-center border transition-colors ${
                selectedTeamId === teams.home.id
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "bg-gray-900 border-gray-800 text-gray-300 hover:bg-gray-800"
              }`}
            >
              <div className="text-[10px] uppercase opacity-60 mb-0.5">
                Home
              </div>
              {teams.home.name}
            </button>
            <button
              type="button"
              onClick={() => setSelectedTeamId(teams.guest.id)}
              aria-pressed={selectedTeamId === teams.guest.id}
              className={`p-3 rounded-xl text-xs font-bold text-center border transition-colors ${
                selectedTeamId === teams.guest.id
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "bg-gray-900 border-gray-800 text-gray-300 hover:bg-gray-800"
              }`}
            >
              <div className="text-[10px] uppercase opacity-60 mb-0.5">
                Guest
              </div>
              {teams.guest.name}
            </button>
          </div>
        </fieldset>
      )}

      {/* Action Button */}
      {!teams ? (
        <button
          type="button"
          disabled={
            !selectedSportId ||
            !selectedConfigId ||
            isSubmitting ||
            isLoadingTeams
          }
          onClick={() => void handleInitMatch()}
          className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-black uppercase rounded-xl transition-colors tracking-wider text-xs shadow-lg"
        >
          {isSubmitting || isLoadingTeams
            ? "Initializing Match..."
            : "Quick Start Match"}
        </button>
      ) : (
        <button
          type="button"
          disabled={!selectedTeamId || isSubmitting}
          onClick={() => void handleConfirmQuickStart()}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-black uppercase rounded-xl transition-colors tracking-wider text-xs shadow-lg"
        >
          {isSubmitting ? "Loading Roster..." : "Confirm & Start Tracking"}
        </button>
      )}
    </div>
  );
};
