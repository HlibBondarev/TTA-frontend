import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useAuth0 } from "@auth0/auth0-react";

import { setPresenceLimits } from "../features/playerpresences/store/presenceSlice";
import {
  setActiveMatch,
  setRecentActions,
} from "../features/matches/store/matchSlice";
import {
  hydrateMatchData,
  getMatchRecoveryState,
  recoverRecentActions,
  StaleUserError,
} from "../services/hydrationService";
import { setTokenGetter } from "../services/tokenService";
import type { RootState, AppDispatch } from "../store";

export function useAppSession() {
  const dispatch = useDispatch<AppDispatch>();
  const initStarted = useRef(false);
  const [isInitializing, setIsInitializing] = useState(true);

  const activeMatchId = useSelector(
    (state: RootState) => state.match.activeMatchId,
  );
  const isPeriodActive = useSelector(
    (state: RootState) => state.match.isPeriodActive,
  );
  const currentView = useSelector(
    (state: RootState) => state.navigation.currentView,
  );

  const {
    getAccessTokenSilently,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
    user,
  } = useAuth0();

  const currentUserId = user?.sub ?? user?.email;
  const currentUserIdRef = useRef(currentUserId);

  useLayoutEffect(() => {
    if (currentUserIdRef.current !== currentUserId) {
      currentUserIdRef.current = currentUserId;
    }
  }, [currentUserId]);

  // Tab protection during active match session (even during inter-period breaks)
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (activeMatchId || isPeriodActive) {
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [activeMatchId, isPeriodActive]);

  useEffect(() => {
    if (isLoading) return;

    setTokenGetter(async () => {
      try {
        return await getAccessTokenSilently();
      } catch {
        return null;
      }
    });
  }, [isLoading, getAccessTokenSilently]);

  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    const initializeApp = async () => {
      setIsInitializing(false);
    };

    initializeApp();
  }, [dispatch]);

  const handleQuickStart = async (
    matchId: string,
    _sportId: string,
    _configurationId: string,
    activePlayersLimit: number,
    selectedTeamId: string,
  ) => {
    const initiatedUserId = currentUserId;

    dispatch(
      setPresenceLimits({
        limit: activePlayersLimit,
        period: 1,
      }),
    );

    const verifyFreshness = () => {
      if (currentUserIdRef.current !== initiatedUserId) {
        throw new StaleUserError();
      }
    };

    try {
      await hydrateMatchData(
        matchId,
        selectedTeamId,
        initiatedUserId,
        verifyFreshness,
      );
    } catch (error) {
      if (error instanceof StaleUserError) {
        console.warn(
          "Account changed during Quick Start hydration. Aborting session activation.",
        );
      } else {
        console.error("Hydration failed:", error);
      }
      throw error;
    }

    if (currentUserIdRef.current !== initiatedUserId) {
      console.warn(
        "Account changed during Quick Start hydration. Aborting session activation.",
      );
      throw new StaleUserError();
    }

    dispatch(
      setActiveMatch({
        matchId,
        teamId: selectedTeamId,
      }),
    );
  };

  const handleResumeMatch = async (matchId: string, teamId: string) => {
    const initiatedUserId = currentUserId;
    try {
      const { recoveredPeriod, activePlayersLimit } =
        await getMatchRecoveryState(matchId);

      if (currentUserIdRef.current !== initiatedUserId) {
        console.warn(
          "Account changed during match recovery. Aborting session resumption.",
        );
        return;
      }

      const recoveredActions = await recoverRecentActions(matchId);

      if (currentUserIdRef.current !== initiatedUserId) {
        console.warn(
          "Account changed during match recovery. Aborting session resumption.",
        );
        return;
      }

      dispatch(
        setPresenceLimits({
          limit: activePlayersLimit,
          period: recoveredPeriod,
        }),
      );

      dispatch(
        setActiveMatch({
          matchId,
          teamId,
        }),
      );

      if (recoveredActions.length > 0) {
        dispatch(setRecentActions(recoveredActions));
      }
    } catch (error) {
      console.error("Session recovery failed (non-critical):", error);
    }
  };

  return {
    isInitializing,
    isLoading,
    isAuthenticated,
    loginWithRedirect,
    currentView,
    activeMatchId,
    handleQuickStart,
    handleResumeMatch,
  };
}
