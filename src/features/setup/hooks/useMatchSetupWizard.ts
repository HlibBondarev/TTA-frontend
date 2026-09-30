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
import { apiClient } from "../../../api/client";
import { db } from "../../../db/ttaDatabase";
import { navigateToHub } from "../../../store/slices/navigationSlice";
import { deleteLocalMatchEntitiesForUser } from "../../../services/hydrationService";
import type {
  SportLookup,
  SportConfigurationLookup,
} from "../../../db/ttaDatabase";

export interface UseMatchSetupWizardOptions {
  onQuickStart: (
    matchId: string,
    sportId: string,
    configurationId: string,
    activePlayersLimit: number,
    selectedTeamId: string,
  ) => Promise<void>;
}

export interface QuickMatchResponse {
  id: string;
  tournamentId: string;
  homeTeamId: string;
  guestTeamId: string;
  scheduledAt: string;
  createdAt: string;
}

export class StaleOperationError extends Error {
  constructor() {
    super("Operation cancelled due to user account change.");
    this.name = "StaleOperationError";
  }
}

export function checkUserFreshness(
  initiatedUserId: string | undefined,
  currentUserIdRef: React.RefObject<string | undefined>,
): void {
  if (currentUserIdRef.current !== initiatedUserId) {
    throw new StaleOperationError();
  }
}

export function useMatchSetupWizard({
  onQuickStart,
}: UseMatchSetupWizardOptions) {
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

  const [areDefinitionsLoaded, setAreDefinitionsLoaded] =
    useState<boolean>(false);
  const [isPresetSaved, setIsPresetSaved] = useState<boolean>(false);
  const [isGuestTeam, setIsGuestTeam] = useState<boolean>(false);

  const [isLoadingSports, setIsLoadingSports] = useState<boolean>(true);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState<boolean>(false);
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
      setAreDefinitionsLoaded(false);
      setIsPresetSaved(false);
      setIsGuestTeam(false);
      setIsSubmitting(false);
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
    if (selectedSportId === sportId || isSubmitting) return;
    setSelectedSportId(sportId);
    setSelectedConfigId(null);
    setIsPresetSaved(false);
    setIsGuestTeam(false);
    setAreDefinitionsLoaded(false);
    await loadConfigurations(sportId, sports);
  };

  const handleSelectConfig = (configId: string) => {
    if (selectedConfigId === configId || isSubmitting) return;
    setSelectedConfigId(configId);
    setIsPresetSaved(false);
  };

  const handleConfirmQuickStart = async () => {
    if (
      !selectedSportId ||
      !selectedConfigId ||
      !isPresetSaved ||
      !areDefinitionsLoaded ||
      isSubmitting
    ) {
      return;
    }

    const initiatedUserId = currentUserId;
    const verifyFreshness = () =>
      checkUserFreshness(initiatedUserId, currentUserIdRef);

    const clientMatchId = crypto.randomUUID();

    const selectedConfig = configurations.find(
      (c) => c.id === selectedConfigId,
    );
    const activePlayersLimit = selectedConfig?.activePlayersLimit ?? 7;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const quickMatch = await apiClient.post<QuickMatchResponse>(
        "/Matches/quick",
        {
          id: clientMatchId,
          sportId: selectedSportId,
          configurationId: selectedConfigId,
          isGuestTeam: isGuestTeam,
        },
      );

      verifyFreshness();

      const targetTeamId = isGuestTeam
        ? quickMatch.guestTeamId
        : quickMatch.homeTeamId;

      await onQuickStart(
        clientMatchId,
        selectedSportId,
        selectedConfigId,
        activePlayersLimit,
        targetTeamId,
      );
    } catch (err) {
      try {
        await apiClient.delete(`/Matches/${clientMatchId}`);
      } catch (deleteErr) {
        console.warn(
          `Compensating DELETE /Matches/${clientMatchId} failed:`,
          deleteErr,
        );
      }

      try {
        await deleteLocalMatchEntitiesForUser(clientMatchId, initiatedUserId);
      } catch (cleanupErr) {
        console.warn(
          `Local cleanup for match ${clientMatchId} failed:`,
          cleanupErr,
        );
      }

      if (
        err instanceof StaleOperationError ||
        (err instanceof Error && err.name === "StaleUserError")
      ) {
        return;
      }

      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to create quick match. Please try again.",
      );
    } finally {
      if (currentUserIdRef.current === initiatedUserId) {
        setIsSubmitting(false);
      }
    }
  };

  const handleBackToMenu = () => {
    dispatch(navigateToHub());
  };

  const configuratorUserId = currentUserId ?? "anonymous";
  const configuratorKey = `${configuratorUserId}:${selectedSportId}`;

  const isNavDisabled = isSubmitting;
  const isStartDisabled =
    !selectedSportId ||
    !selectedConfigId ||
    !isPresetSaved ||
    !areDefinitionsLoaded ||
    isSubmitting;

  return {
    sports,
    selectedSportId,
    configurations,
    selectedConfigId,
    isPresetSaved,
    areDefinitionsLoaded,
    isGuestTeam,
    isLoadingSports,
    isLoadingConfigs,
    isSubmitting,
    errorMessage,
    isNavDisabled,
    isStartDisabled,
    configuratorKey,
    setIsPresetSaved,
    setAreDefinitionsLoaded,
    setIsGuestTeam,
    handleSelectSport,
    handleSelectConfig,
    handleConfirmQuickStart,
    handleBackToMenu,
  };
}
