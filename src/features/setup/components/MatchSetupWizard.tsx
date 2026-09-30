import React from "react";
import { EventDefinitionsConfigurator } from "../../event-definitions/components/EventDefinitionsConfigurator";
import {
  useMatchSetupWizard,
  type UseMatchSetupWizardOptions,
} from "../hooks/useMatchSetupWizard";

export type MatchSetupWizardProps = UseMatchSetupWizardOptions;

export const MatchSetupWizard: React.FC<MatchSetupWizardProps> = (props) => {
  const {
    sports,
    selectedSportId,
    configurations,
    selectedConfigId,
    isPresetSaved,
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
  } = useMatchSetupWizard(props);

  let submitButtonLabel = "Start Tracking Match";
  if (isSubmitting) {
    submitButtonLabel = "Starting Quick Match...";
  } else if (!isPresetSaved) {
    submitButtonLabel = "Save Preset to Continue";
  }

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
            disabled={isSubmitting}
            onClick={() => handleSelectConfig(config.id)}
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
      <header className="flex items-center justify-between pb-3 border-b border-gray-800 mb-4">
        <h2 className="text-sm font-black uppercase text-blue-500 tracking-wider">
          Match Setup Wizard
        </h2>
        <button
          type="button"
          disabled={isNavDisabled}
          onClick={handleBackToMenu}
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
              disabled={isSubmitting}
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

      {selectedSportId && (
        <fieldset className="mb-6 min-w-0 border-0 p-0 m-0">
          <legend className="block text-[10px] uppercase text-gray-400 mb-1.5 font-bold p-0">
            3. Configure Actions
          </legend>
          <EventDefinitionsConfigurator
            key={configuratorKey}
            sportId={selectedSportId}
            disabled={isSubmitting}
            onPresetSaved={() => setIsPresetSaved(true)}
            onPresetModified={() => setIsPresetSaved(false)}
            onLoadStateChange={setAreDefinitionsLoaded}
          />
        </fieldset>
      )}

      <fieldset className="mb-6 min-w-0 border-0 p-0 m-0">
        <legend className="block text-[10px] uppercase text-gray-400 mb-1.5 font-bold p-0">
          4. Select Team to Track
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => setIsGuestTeam(false)}
            aria-pressed={!isGuestTeam}
            className={`p-3 rounded-xl text-xs font-bold text-center border transition-colors ${
              !isGuestTeam
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-gray-900 border-gray-800 text-gray-300 hover:bg-gray-800"
            }`}
          >
            <div className="text-[10px] uppercase opacity-60 mb-0.5">
              Tracking Focus
            </div>
            Home Squad
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => setIsGuestTeam(true)}
            aria-pressed={isGuestTeam}
            className={`p-3 rounded-xl text-xs font-bold text-center border transition-colors ${
              isGuestTeam
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-gray-900 border-gray-800 text-gray-300 hover:bg-gray-800"
            }`}
          >
            <div className="text-[10px] uppercase opacity-60 mb-0.5">
              Tracking Focus
            </div>
            Opponent Squad
          </button>
        </div>
      </fieldset>

      <button
        type="button"
        disabled={isStartDisabled}
        onClick={() => void handleConfirmQuickStart()}
        className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-black uppercase rounded-xl transition-colors tracking-wider text-xs shadow-lg"
      >
        {submitButtonLabel}
      </button>
    </div>
  );
};
