import React, { useEffect, useState, useCallback, useRef } from "react";
import { sportService } from "../../../services/sportService";
import type {
  SportLookup,
  SportConfigurationLookup,
} from "../../../db/ttaDatabase";

interface MatchSetupWizardProps {
  onQuickStart: (
    sportId: string,
    configurationId: string,
    activePlayersLimit: number,
  ) => Promise<void>;
}

/**
 * Mobile-optimized setup wizard component for Step-1 (Sport Selection)
 * and Step-2 (Configuration Selection) of the User Initial Application Workflow.
 */
export const MatchSetupWizard: React.FC<MatchSetupWizardProps> = ({
  onQuickStart,
}) => {
  const [sports, setSports] = useState<SportLookup[]>([]);
  const [selectedSportId, setSelectedSportId] = useState<string | null>(null);

  const [configurations, setConfigurations] = useState<
    SportConfigurationLookup[]
  >([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  const [isLoadingSports, setIsLoadingSports] = useState<boolean>(true);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Request sequence ref to prevent race conditions during rapid configuration fetches
  const configRequestRef = useRef(0);

  // Function to fetch configurations for a specific sport id
  const loadConfigurations = useCallback(
    async (sportId: string, sportList: SportLookup[]) => {
      const requestId = ++configRequestRef.current;
      try {
        setIsLoadingConfigs(true);
        setErrorMessage(null);
        const data = await sportService.getSportConfigurations(sportId);

        if (requestId !== configRequestRef.current) return;

        setConfigurations(data);

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

  // Step 1: Fetch available sports on mount and initialize default selection
  useEffect(() => {
    let isMounted = true;

    const fetchSports = async () => {
      try {
        setIsLoadingSports(true);
        setErrorMessage(null);
        const data = await sportService.getSports();

        if (!isMounted) return;

        setSports(data);
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

  // Handle sport selection change explicitly from user interaction
  const handleSelectSport = async (sportId: string) => {
    if (selectedSportId === sportId) return;
    setSelectedSportId(sportId);
    setSelectedConfigId(null);
    await loadConfigurations(sportId, sports);
  };

  const handleQuickStart = async () => {
    if (!selectedSportId || !selectedConfigId || isSubmitting) return;

    const selectedConfig = configurations.find(
      (c) => c.id === selectedConfigId,
    );
    const activePlayersLimit = selectedConfig?.activePlayersLimit ?? 7;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      await onQuickStart(selectedSportId, selectedConfigId, activePlayersLimit);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Failed to initialize quick match session.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper method to render configurations content avoiding nested ternaries in JSX
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
            onClick={() => setSelectedConfigId(config.id)}
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

      {/* Step 3: Quick Start Action */}
      <button
        type="button"
        disabled={!selectedSportId || !selectedConfigId || isSubmitting}
        onClick={handleQuickStart}
        className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-black uppercase rounded-xl transition-colors tracking-wider text-xs shadow-lg"
      >
        {isSubmitting ? "Initializing Match..." : "Quick Start Match"}
      </button>
    </div>
  );
};
