import React from "react";

export interface InteractivePlaygroundProps {
  playgroundSvg?: string | null;
  locationX?: number | null;
  locationY?: number | null;
  disabled?: boolean;
  onLocationSelect: (x: number | null, y: number | null) => void;
}

export const InteractivePlayground: React.FC<InteractivePlaygroundProps> = ({
  playgroundSvg,
  locationX,
  locationY,
  disabled = false,
  onLocationSelect,
}) => {
  const hasCoordinates =
    typeof locationX === "number" && typeof locationY === "number";

  const handlePlaygroundClick = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (disabled) return;

    // Handle keyboard-triggered click (e.g. Enter / Space) where click coordinates are 0
    if (event.clientX === 0 && event.clientY === 0) {
      onLocationSelect(50, 50);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Calculate relative click position inside container
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Convert to percentage scale [0.00, 100.00] relative to BOTTOM-LEFT origin (0,0)
    const rawX = (clickX / rect.width) * 100;
    const rawY = ((rect.height - clickY) / rect.height) * 100;

    const clampX = Math.min(100, Math.max(0, rawX));
    const clampY = Math.min(100, Math.max(0, rawY));

    onLocationSelect(Number(clampX.toFixed(2)), Number(clampY.toFixed(2)));
  };

  const handleClearLocation = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      onLocationSelect(null, null);
    }
  };

  return (
    <div className="w-full flex flex-col items-center space-y-2">
      {/* Top Header / Badge Bar */}
      <div className="w-full flex items-center justify-between px-1">
        <span className="text-[11px] font-bold uppercase text-slate-400">
          Field Location Map
        </span>
        {hasCoordinates ? (
          <div className="flex items-center space-x-1.5">
            <span className="px-2 py-0.5 text-[10px] font-black tracking-wide bg-blue-600/30 text-blue-300 rounded border border-blue-500/50">
              X: {locationX}% | Y: {locationY}%
            </span>
            <button
              type="button"
              onClick={handleClearLocation}
              disabled={disabled}
              className="text-[10px] font-bold uppercase text-rose-400 hover:text-rose-300 disabled:opacity-50 transition-colors"
            >
              Clear
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-slate-500 italic">
            Tap field to select point
          </span>
        )}
      </div>

      {/* Scrollable Adaptive Field Container */}
      <div className="w-full relative">
        <div className="w-full max-h-80 sm:max-h-112.5 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-700 bg-slate-900/60 shadow-inner custom-scrollbar relative touch-pan-y">
          <button
            type="button"
            disabled={disabled}
            onClick={handlePlaygroundClick}
            className={`w-full relative flex justify-center items-center select-none border-0 p-0 bg-transparent ${
              disabled ? "cursor-not-allowed opacity-60" : "cursor-crosshair"
            }`}
          >
            {/* SVG Playground Layout */}
            {playgroundSvg ? (
              <div
                className="w-full h-auto max-w-full pointer-events-none flex items-center justify-center [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
                dangerouslySetInnerHTML={{ __html: playgroundSvg }}
              />
            ) : (
              /* Fallback Waterpolo Pool SVG Layout */
              <div className="w-full aspect-4/3 bg-sky-950/80 border-2 border-sky-600/40 rounded-lg flex items-center justify-center relative overflow-hidden pointer-events-none">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-b border-sky-500/30" />
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 border-r border-sky-500/30" />
                <div className="w-16 h-16 rounded-full border border-sky-500/30" />
                <span className="text-sky-400/20 text-xs font-bold uppercase tracking-widest">
                  Standard Court
                </span>
              </div>
            )}

            {/* Location Pin Marker */}
            {hasCoordinates && (
              <div
                style={{
                  left: `${locationX}%`,
                  top: `${100 - locationY}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 transition-all duration-150 ease-out"
              >
                {/* Outer Pulse Effect */}
                <span className="absolute -inset-1.5 rounded-full bg-rose-500/40 animate-ping" />
                {/* Inner Pin Dot */}
                <div className="relative w-4 h-4 rounded-full bg-rose-500 border-2 border-white shadow-lg flex items-center justify-center">
                  <div className="w-1 h-1 rounded-full bg-white" />
                </div>
              </div>
            )}
          </button>
        </div>

        {/* Scroll Indicator Badge */}
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-slate-900/80 backdrop-blur text-[9px] text-slate-400 rounded border border-slate-800 pointer-events-none">
          Scroll for full view
        </div>
      </div>
    </div>
  );
};
