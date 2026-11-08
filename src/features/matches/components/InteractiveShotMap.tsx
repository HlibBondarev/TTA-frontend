import React, { useMemo } from "react";
import DOMPurify from "dompurify";
import { parseSvgDimensions } from "../../../utils/svgUtils";

export interface InteractiveShotMapProps {
  shotMap?: string | null;
  shotLocationX?: number | null;
  shotLocationY?: number | null;
  disabled?: boolean;
  onShotLocationSelect: (x: number | null, y: number | null) => void;
}

export const InteractiveShotMap: React.FC<InteractiveShotMapProps> = ({
  shotMap,
  shotLocationX,
  shotLocationY,
  disabled = false,
  onShotLocationSelect,
}) => {
  const dimensions = useMemo(() => parseSvgDimensions(shotMap), [shotMap]);

  const safeShotMap = useMemo(
    () =>
      shotMap
        ? DOMPurify.sanitize(shotMap, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        : null,
    [shotMap],
  );

  const hasLocation = shotLocationX != null && shotLocationY != null;
  const isMapValid = Boolean(safeShotMap && dimensions);

  // Return null if neither SVG map nor location coordinates are available
  if (!isMapValid && !hasLocation) {
    return null;
  }

  const handleClear = () => {
    if (disabled) return;
    onShotLocationSelect(null, null);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;

    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const pctX = Math.round((clickX / rect.width) * 100);
    const pctY = Math.round((1 - clickY / rect.height) * 100);

    const clampedX = Math.max(0, Math.min(100, pctX));
    const clampedY = Math.max(0, Math.min(100, pctY));

    onShotLocationSelect(clampedX, clampedY);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!hasLocation) {
        onShotLocationSelect(50, 50);
      }
      return;
    }

    const currentX = shotLocationX ?? 50;
    const currentY = shotLocationY ?? 50;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      onShotLocationSelect(Math.min(100, currentX + 5), currentY);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onShotLocationSelect(Math.max(0, currentX - 5), currentY);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onShotLocationSelect(currentX, Math.min(100, currentY + 5));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onShotLocationSelect(currentX, Math.max(0, currentY - 5));
    }
  };

  const topPos = hasLocation ? 100 - shotLocationY! : 0;
  const leftPos = hasLocation ? shotLocationX! : 0;

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
        <span>Goal Shot Map</span>
        {hasLocation ? (
          <div className="flex items-center space-x-2">
            <span className="font-mono text-amber-400">
              X: {shotLocationX}% | Y: {shotLocationY}%
            </span>
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              className="px-2 py-0.5 text-[10px] bg-rose-900/50 hover:bg-rose-800 text-rose-200 border border-rose-700/50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Clear"
            >
              Clear
            </button>
          </div>
        ) : (
          isMapValid && (
            <span className="text-[11px] text-slate-400 font-normal">
              Tap goal frame to select target point
            </span>
          )
        )}
      </div>

      {isMapValid && (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label="Goal Shot Location Map"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className={`relative w-full rounded border border-gray-800 overflow-hidden bg-sky-950/90 select-none outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-crosshair"
          }`}
          style={{ aspectRatio: dimensions!.aspectRatio }}
        >
          <div
            className="w-full h-auto pointer-events-none opacity-90 [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
            dangerouslySetInnerHTML={{ __html: safeShotMap ?? "" }}
          />

          {hasLocation && (
            <div
              className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 border-2 border-slate-950 shadow-md animate-pulse pointer-events-none"
              style={{
                top: `${topPos}%`,
                left: `${leftPos}%`,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};
