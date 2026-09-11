import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { useDispatch } from "react-redux";
import { useAuth0 } from "@auth0/auth0-react";
import { sportService } from "../../../services/sportService";
import { teamService } from "../../../services/teamService";
import { apiClient } from "../../../api/client";
import { db } from "../../../db/ttaDatabase";
import { navigateToHub } from "../../../store/slices/navigationSlice";
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

interface LocalPersistResult {
  existingMatch?: MatchLookup;
  didPersist: boolean;
  existedLocally: boolean;
}

class StaleOperationError extends Error {
  constructor() {
    super("Operation cancelled due to user account change.");
    this.name = "StaleOperationError";
  }
}

class MatchOwnershipError extends Error {
  constructor() {
    super("Match session belongs to another user.");
    this.name = "MatchOwnershipError";
  }
}

function checkUserFreshness(
  initiatedUserId: string | undefined,
  currentUserIdRef: React.RefObject<string | undefined>,
): void {
  if (currentUserIdRef.current !== initiatedUserId) {
    throw new StaleOperationError();
  }
}

function getHttpStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.status === "number") {
      return obj.status;
    }
    if (
      typeof obj.response === "object" &&
      obj.response !== null &&
      typeof (obj.response as Record<string, unknown>).status === "number"
    ) {
      return (obj.response as Record<string, unknown>).status as number;
    }
  }
  return undefined;
}

async function persistOrRollbackTournament(
  tournamentId: string,
  tournamentData: {
    id: string;
    sportId: string;
    configurationId: string;
    cityId: string;
    ownerId: string;
    name: string;
    startDate: string;
    endDate: null;
    createdAt: string;
  },
  verifyFreshness: () => void,
): Promise<void> {
  const existingTournament = await db.tournaments.get(tournamentId);
  verifyFreshness();

  await db.tournaments.put(
    tournamentData as unknown as Parameters<typeof db.tournaments.put>[0],
  );

  try {
    verifyFreshness();
  } catch (err) {
    if (existingTournament) {
      await db.tournaments.put(existingTournament);
    } else {
      await db.tournaments.delete(tournamentId);
    }
    throw err;
  }
}

async function ensureTournamentPersisted(
  tournamentId: string,
  sportId: string,
  configurationId: string,
  verifyFreshness: () => void,
): Promise<void> {
  if (!db.tournaments) return;

  const quickTournamentPayload = {
    id: tournamentId,
    sportId,
    configurationId,
    cityId: "",
    ownerId: "",
    name: "Quick Tournament",
    startDate: new Date().toISOString(),
    endDate: null,
    createdAt: new Date().toISOString(),
  };

  let tournament: {
    id: string;
    sportId: string;
    configurationId: string;
  } | null = null;

  try {
    tournament = await apiClient.get<{
      id: string;
      sportId: string;
      configurationId: string;
    }>(`/Tournaments/${tournamentId}`);
  } catch (err) {
    if (err instanceof StaleOperationError) throw err;
  }

  verifyFreshness();

  if (tournament) {
    await persistOrRollbackTournament(
      tournamentId,
      {
        ...quickTournamentPayload,
        ...tournament,
      },
      verifyFreshness,
    );
    return;
  }

  const existingTourn = await db.tournaments.get(tournamentId);
  verifyFreshness();

  if (!existingTourn) {
    await persistOrRollbackTournament(
      tournamentId,
      quickTournamentPayload,
      verifyFreshness,
    );
  }
}

async function verifyMatchOwnership(
  matchId: string,
  currentUserId: string | undefined,
): Promise<boolean> {
  if (!db.matches) return true;
  const existingLocalMatch = await db.matches.get(matchId);
  if (
    existingLocalMatch?.userId &&
    existingLocalMatch.userId !== currentUserId
  ) {
    return false;
  }
  return true;
}

async function createQuickMatch(
  sportId: string,
  configurationId: string,
): Promise<string> {
  const response = await apiClient.post<{ id: string }>("/Matches/quick", {
    sportId,
    configurationId,
  });

  const matchId = typeof response?.id === "string" ? response.id.trim() : "";
  if (!matchId) {
    throw new Error("Failed to initialize quick match session.");
  }

  return matchId;
}

async function fetchAndNormalizeMatch(
  matchId: string,
  currentUserId: string | undefined,
): Promise<MatchLookup> {
  const match = await apiClient.get<MatchLookup>(`/Matches/${matchId}`);

  const isValidString = (val: unknown): val is string =>
    typeof val === "string" && val.trim().length > 0;

  if (
    !match ||
    !isValidString(match.id) ||
    !isValidString(match.homeTeamId) ||
    !isValidString(match.guestTeamId)
  ) {
    throw new Error("Failed to load match details.");
  }

  return {
    ...match,
    id: match.id.trim(),
    homeTeamId: match.homeTeamId.trim(),
    guestTeamId: match.guestTeamId.trim(),
    tournamentId:
      typeof match.tournamentId === "string" ? match.tournamentId.trim() : "",
    userId: currentUserId,
  };
}

async function saveSelectedConfig(
  selectedConfigId: string,
  configurations: SportConfigurationLookup[],
  verifyFreshness: () => void,
): Promise<void> {
  verifyFreshness();
  const selectedConfig = configurations.find((c) => c.id === selectedConfigId);
  if (selectedConfig && db.sportconfigurations) {
    const existingConfig = await db.sportconfigurations.get(selectedConfigId);
    verifyFreshness();

    await db.sportconfigurations.put(selectedConfig);

    try {
      verifyFreshness();
    } catch (err) {
      if (existingConfig) {
        await db.sportconfigurations.put(existingConfig);
      } else {
        await db.sportconfigurations.delete(selectedConfigId);
      }
      throw err;
    }
  }
}

async function resolveMatchSessionId(
  pendingMatchId: string | null,
  initiatedUserId: string | undefined,
  sportId: string,
  configId: string,
  verifyFreshness: () => void,
): Promise<string> {
  let matchId = pendingMatchId;

  if (matchId && !(await verifyMatchOwnership(matchId, initiatedUserId))) {
    throw new MatchOwnershipError();
  }

  verifyFreshness();

  if (!matchId) {
    matchId = await createQuickMatch(sportId, configId);
    verifyFreshness();
  }

  return matchId;
}

async function persistMatchLocally(
  normalizedMatch: MatchLookup,
  verifyFreshness: () => void,
): Promise<void> {
  if (!db.matches) return;
  verifyFreshness();
  const existingMatch = await db.matches.get(normalizedMatch.id);
  verifyFreshness();
  await db.matches.put(normalizedMatch);
  try {
    verifyFreshness();
  } catch (err) {
    if (existingMatch) {
      await db.matches.put(existingMatch);
    } else {
      await db.matches.delete(normalizedMatch.id);
    }
    throw err;
  }
}

async function persistTrackedTeamLocally(
  pendingMatchId: string,
  selectedTeamId: string,
  initiatedUserId: string | undefined,
  verifyFreshness: () => void,
): Promise<LocalPersistResult> {
  if (!db.matches) return { didPersist: false, existedLocally: false };
  const initialLocalMatch = await db.matches.get(pendingMatchId);
  verifyFreshness();

  const existedLocally = !!initialLocalMatch;
  let matchToNormalize = initialLocalMatch;

  if (!matchToNormalize) {
    try {
      matchToNormalize = await fetchAndNormalizeMatch(
        pendingMatchId,
        initiatedUserId,
      );
      verifyFreshness();
    } catch (err) {
      if (err instanceof StaleOperationError) {
        throw err;
      }
      throw new Error("Match session not found in local database.", {
        cause: err,
      });
    }
  }

  const matchToPut: MatchLookup = {
    ...matchToNormalize,
    trackedTeamId: selectedTeamId,
  };

  await db.matches.put(matchToPut);
  try {
    verifyFreshness();
  } catch (err) {
    if (existedLocally && initialLocalMatch) {
      await db.matches.put(initialLocalMatch);
    } else {
      await db.matches.delete(pendingMatchId);
    }
    throw err;
  }
  return {
    existingMatch: initialLocalMatch,
    didPersist: true,
    existedLocally,
  };
}

async function rollbackTrackedTeamLocally(
  pendingMatchId: string,
  existingMatch?: MatchLookup,
  existedLocally = false,
): Promise<void> {
  if (!db.matches) return;
  try {
    if (existedLocally && existingMatch) {
      await db.matches.put(existingMatch);
    } else {
      await db.matches.delete(pendingMatchId);
    }
  } catch (rollbackErr) {
    console.error("Failed to rollback local match record:", rollbackErr);
  }
}

async function loadMatchTeams(
  homeTeamId: string,
  guestTeamId: string,
  verifyFreshness: () => void,
): Promise<{ home: TeamLookup; guest: TeamLookup }> {
  const [home, guest] = await Promise.all([
    teamService.getTeamById(homeTeamId),
    teamService.getTeamById(guestTeamId),
  ]);
  verifyFreshness();
  return { home, guest };
}

interface CatchResult {
  wasOnline: boolean;
  queuedItemId?: number;
}

async function executeCatchMatch(catchEndpoint: string): Promise<CatchResult> {
  let catchSuccess = false;

  if (navigator.onLine) {
    try {
      await apiClient.post(catchEndpoint, {});
      catchSuccess = true;
    } catch (catchErr) {
      if (catchErr instanceof StaleOperationError) throw catchErr;
      const status = getHttpStatus(catchErr);
      if (typeof status === "number") {
        throw new TypeError(`Failed to catch match team (HTTP ${status}).`, {
          cause: catchErr,
        });
      }
      console.warn(
        "Catch match API call failed online, fallback to syncQueue:",
        catchErr,
      );
    }
  }

  if (catchSuccess) {
    return { wasOnline: true };
  }

  if (db.syncQueue) {
    const queuedItemId = (await db.syncQueue.put({
      actionType: "POST",
      endpoint: catchEndpoint,
      payload: "{}",
      createdAt: new Date().toISOString(),
    })) as unknown as number;
    return { wasOnline: false, queuedItemId };
  }

  throw new Error("Failed to queue catch match operation while offline.");
}

async function purgeStaleSyncItem(
  queuedItemId: number | undefined,
): Promise<void> {
  if (queuedItemId === undefined || !db.syncQueue) return;
  await db.syncQueue.delete(queuedItemId);
}

async function tryOnlineUncatch(
  catchEndpoint: string,
): Promise<boolean | "FALLBACK"> {
  if (!navigator.onLine) return "FALLBACK";

  try {
    await apiClient.delete(catchEndpoint);
    return true;
  } catch (err) {
    if (err instanceof StaleOperationError) throw err;
    const status = getHttpStatus(err);
    if (status === 404 || status === 410) {
      return true;
    }
    if (typeof status === "number") {
      console.warn(
        `Compensating online uncatch failed with terminal HTTP ${status}:`,
        err,
      );
      return false;
    }
    console.warn(
      "Compensating online uncatch failed due to network error, falling back to syncQueue:",
      err,
    );
    return "FALLBACK";
  }
}

async function compensateOnlineCatch(catchEndpoint: string): Promise<boolean> {
  const result = await tryOnlineUncatch(catchEndpoint);
  if (typeof result === "boolean") {
    return result;
  }

  if (db.syncQueue) {
    await db.syncQueue.put({
      actionType: "DELETE",
      endpoint: catchEndpoint,
      payload: "{}",
      createdAt: new Date().toISOString(),
    });
    return true;
  }

  return false;
}

async function compensateCatchMatch(
  catchEndpoint: string,
  catchResult?: CatchResult,
): Promise<boolean> {
  if (!catchResult) return true;

  if (catchResult.queuedItemId !== undefined) {
    await purgeStaleSyncItem(catchResult.queuedItemId);
    return true;
  }

  if (catchResult.wasOnline) {
    return compensateOnlineCatch(catchEndpoint);
  }

  return true;
}

async function compensateAndRollbackIfNeeded(
  catchEndpoint: string,
  catchResult: CatchResult | undefined,
  localPersistResult: LocalPersistResult | undefined,
  pendingMatchId: string,
): Promise<void> {
  if (!catchResult) {
    if (localPersistResult?.didPersist) {
      await rollbackTrackedTeamLocally(
        pendingMatchId,
        localPersistResult.existingMatch,
        localPersistResult.existedLocally,
      );
    }
    return;
  }

  let compensationSucceeded: boolean;
  try {
    compensationSucceeded = await compensateCatchMatch(
      catchEndpoint,
      catchResult,
    );
  } catch (compensationErr) {
    compensationSucceeded = false;
    const logMsg =
      catchResult.queuedItemId !== undefined
        ? "Failed to delete stale sync queue item:"
        : "Failed to compensate catch match operation:";
    console.error(logMsg, compensationErr);
  }

  if (compensationSucceeded && localPersistResult?.didPersist) {
    await rollbackTrackedTeamLocally(
      pendingMatchId,
      localPersistResult.existingMatch,
      localPersistResult.existedLocally,
    );
  }
}

async function handleConfirmQuickStartError(
  err: unknown,
  catchEndpoint: string,
  catchResult: CatchResult | undefined,
  localPersistResult: LocalPersistResult | undefined,
  pendingMatchId: string,
  setErrorMessage: (msg: string | null) => void,
): Promise<void> {
  await compensateAndRollbackIfNeeded(
    catchEndpoint,
    catchResult,
    localPersistResult,
    pendingMatchId,
  );

  if (
    err instanceof StaleOperationError ||
    (err instanceof Error && err.name === "StaleUserError")
  ) {
    return;
  }

  setErrorMessage(
    err instanceof Error ? err.message : "Failed to complete match setup.",
  );
}

export const MatchSetupWizard: React.FC<MatchSetupWizardProps> = ({
  onQuickStart,
}) => {
  const dispatch = useDispatch();
  const { user } = useAuth0();
  const currentUserId = user?.sub ?? user?.email;

  const currentUserIdRef = useRef(currentUserId);
  const prevUserIdRef = useRef(currentUserId);

  const [sports, setSports] = useState<SportLookup[]>([]);
  const [selectedSportId, setSelectedSportId] = useState<string | null>(null);

  const [configurations, setConfigurations] = useState<
    SportConfigurationLookup[]
  >([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

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

  useLayoutEffect(() => {
    if (currentUserIdRef.current !== currentUserId) {
      currentUserIdRef.current = currentUserId;
    }
  }, [currentUserId]);

  useEffect(() => {
    if (prevUserIdRef.current !== currentUserId) {
      prevUserIdRef.current = currentUserId;
      setPendingMatchId(null);
      setTeams(null);
      setSelectedTeamId(null);
      setIsSubmitting(false);
      setIsLoadingTeams(false);
      setErrorMessage(null);
    }
  }, [currentUserId]);

  const loadConfigurations = useCallback(
    async (sportId: string, sportList: SportLookup[]) => {
      const requestId = ++configRequestRef.current;
      try {
        setIsLoadingConfigs(true);
        setErrorMessage(null);
        const data = await sportService.getSportConfigurations(sportId);

        if (requestId !== configRequestRef.current) return;

        setConfigurations(data);

        if (data.length > 0 && db.sportconfigurations) {
          await db.sportconfigurations.bulkPut(data);
        }

        if (requestId !== configRequestRef.current) return;

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

        if (data.length > 0 && db.sports) {
          await db.sports.bulkPut(data);
        }

        if (data.length > 0) {
          const firstSportId = data[0].id;
          setSelectedSportId(firstSportId);
          await loadConfigurations(firstSportId, data);
        }
      } catch (err) {
        if (isMounted) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : "Failed to load sports disciplines.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingSports(false);
        }
      }
    };

    void fetchSports();

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

  const handleInitMatch = async () => {
    if (!selectedSportId || !selectedConfigId || isSubmitting) return;

    const initiatedUserId = currentUserId;
    const verifyFreshness = () =>
      checkUserFreshness(initiatedUserId, currentUserIdRef);

    try {
      setIsSubmitting(true);
      setIsLoadingTeams(true);
      setErrorMessage(null);

      await saveSelectedConfig(
        selectedConfigId,
        configurations,
        verifyFreshness,
      );

      const matchId = await resolveMatchSessionId(
        pendingMatchId,
        initiatedUserId,
        selectedSportId,
        selectedConfigId,
        verifyFreshness,
      );
      setPendingMatchId(matchId);

      const normalizedMatch = await fetchAndNormalizeMatch(
        matchId,
        initiatedUserId,
      );
      verifyFreshness();

      await persistMatchLocally(normalizedMatch, verifyFreshness);

      if (normalizedMatch.tournamentId) {
        await ensureTournamentPersisted(
          normalizedMatch.tournamentId,
          selectedSportId,
          selectedConfigId,
          verifyFreshness,
        );
        verifyFreshness();
      }

      const loadedTeams = await loadMatchTeams(
        normalizedMatch.homeTeamId,
        normalizedMatch.guestTeamId,
        verifyFreshness,
      );

      setTeams(loadedTeams);
      setSelectedTeamId(null);
    } catch (err) {
      if (err instanceof StaleOperationError) {
        if (currentUserIdRef.current !== initiatedUserId) {
          setPendingMatchId(null);
          setTeams(null);
          setSelectedTeamId(null);
        }
        return;
      }

      if (err instanceof MatchOwnershipError) {
        setPendingMatchId(null);
        setTeams(null);
        setSelectedTeamId(null);
      }

      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to initialize quick match session.",
      );
    } finally {
      if (currentUserIdRef.current === initiatedUserId) {
        setIsSubmitting(false);
        setIsLoadingTeams(false);
      }
    }
  };

  const handleConfirmQuickStart = async () => {
    if (
      !pendingMatchId ||
      !selectedSportId ||
      !selectedConfigId ||
      !selectedTeamId ||
      isSubmitting
    ) {
      return;
    }

    const initiatedUserId = currentUserId;
    const verifyFreshness = () =>
      checkUserFreshness(initiatedUserId, currentUserIdRef);

    const selectedConfig = configurations.find(
      (c) => c.id === selectedConfigId,
    );
    const activePlayersLimit = selectedConfig?.activePlayersLimit ?? 7;

    const catchEndpoint = `/Matches/${pendingMatchId}/teams/${selectedTeamId}/catch`;
    let catchResult: CatchResult | undefined;
    let localPersistResult: LocalPersistResult | undefined;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      localPersistResult = await persistTrackedTeamLocally(
        pendingMatchId,
        selectedTeamId,
        initiatedUserId,
        verifyFreshness,
      );

      catchResult = await executeCatchMatch(catchEndpoint);
      verifyFreshness();

      await onQuickStart(
        pendingMatchId,
        selectedSportId,
        selectedConfigId,
        activePlayersLimit,
        selectedTeamId,
      );
      verifyFreshness();
    } catch (err) {
      await handleConfirmQuickStartError(
        err,
        catchEndpoint,
        catchResult,
        localPersistResult,
        pendingMatchId,
        setErrorMessage,
      );
    } finally {
      if (currentUserIdRef.current === initiatedUserId) {
        setIsSubmitting(false);
      }
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

  const isNavDisabled = isSubmitting || isLoadingTeams;

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col flex-1 p-4 bg-gray-950 text-gray-100 overflow-y-auto">
      <header className="flex items-center justify-between pb-3 border-b border-gray-800 mb-4">
        <h2 className="text-sm font-black uppercase text-blue-500 tracking-wider">
          Match Setup Wizard
        </h2>
        <button
          type="button"
          disabled={isNavDisabled}
          onClick={() => dispatch(navigateToHub())}
          className="text-xs bg-gray-900 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 px-3 py-1 rounded border border-gray-700 transition-colors"
        >
          Back to Menu
        </button>
      </header>

      {errorMessage && (
        <div
          role="alert"
          className="mb-3 p-2 text-xs bg-red-900/50 border border-red-800 text-red-200 rounded text-center font-medium"
        >
          {errorMessage}
        </div>
      )}

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

      <fieldset className="mb-6 flex-1 min-w-0 border-0 p-0 m-0">
        <legend className="block text-[10px] uppercase text-gray-400 mb-1.5 font-bold p-0">
          2. Select Configuration Profile
        </legend>
        {renderConfigurationsContent()}
      </fieldset>

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
