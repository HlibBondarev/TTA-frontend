import React, { useMemo } from "react";
import DOMPurify from "dompurify";
import { parseSvgDimensions } from "../../../utils/svgUtils";

export interface InteractiveShotMapProps {
  shotMap: string | null;
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
  const safeSvg = useMemo(
    () =>
      shotMap
        ? DOMPurify.sanitize(shotMap, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        : null,
    [shotMap],
  );

  const dimensions = useMemo(() => parseSvgDimensions(shotMap), [shotMap]);

  if (!safeSvg || !dimensions) {
    return null;
  }

  const hasCoordinates =
    typeof shotLocationX === "number" && typeof shotLocationY === "number";

  const handleGoalClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    const rawPctX = (clickX / rect.width) * 100;
    const rawPctY = ((rect.height - clickY) / rect.height) * 100;

    const clampX = Math.min(100, Math.max(0, rawPctX));
    const clampY = Math.min(100, Math.max(0, rawPctY));

    onShotLocationSelect(Number(clampX.toFixed(2)), Number(clampY.toFixed(2)));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!hasCoordinates) {
        onShotLocationSelect(50, 50);
      }
      return;
    }

    const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!arrowKeys.includes(event.key)) return;

    event.preventDefault();

    const currentX = shotLocationX ?? 50;
    const currentY = shotLocationY ?? 50;
    const step = 5;

    let newX = currentX;
    let newY = currentY;

    if (event.key === "ArrowLeft") newX = Math.max(0, currentX - step);
    if (event.key === "ArrowRight") newX = Math.min(100, currentX + step);
    if (event.key === "ArrowUp") newY = Math.min(100, currentY + step);
    if (event.key === "ArrowDown") newY = Math.max(0, currentY - step);

    onShotLocationSelect(Number(newX.toFixed(2)), Number(newY.toFixed(2)));
  };

  const handleClearLocation = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      onShotLocationSelect(null, null);
    }
  };

  return (
    <div className="w-full flex flex-col items-center space-y-2">
      <div className="w-full flex items-center justify-between px-1">
        <span className="text-[11px] font-bold uppercase text-amber-400">
          Goal Shot Map
        </span>
        {hasCoordinates ? (
          <div className="flex items-center space-x-1.5">
            <span className="px-2 py-0.5 text-[10px] font-black tracking-wide bg-amber-500/20 text-amber-300 rounded border border-amber-500/40 font-mono">
              X: {shotLocationX}% | Y: {shotLocationY}%
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
            Tap goal frame to select target point
          </span>
        )}
      </div>

      <div className="w-full relative">
        <div className="w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80 shadow-inner relative touch-pan-y">
          <button
            type="button"
            disabled={disabled}
            onClick={handleGoalClick}
            onKeyDown={handleKeyDown}
            aria-label="Goal Shot Location Map"
            className={`w-full relative flex justify-center items-center select-none border-0 p-0 bg-transparent ${
              disabled ? "cursor-not-allowed opacity-60" : "cursor-crosshair"
            }`}
            style={{ aspectRatio: dimensions.aspectRatio }}
          >
            <div
              className="w-full h-auto max-w-full pointer-events-none flex items-center justify-center [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
              dangerouslySetInnerHTML={{ __html: safeSvg }}
            />

            {hasCoordinates && (
              <div
                style={{
                  left: `${shotLocationX}%`,
                  top: `${100 - shotLocationY}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 transition-all duration-150 ease-out"
              >
                <span className="absolute -inset-1.5 rounded-full bg-amber-400/40 animate-ping" />
                <div className="relative w-4 h-4 rounded-full bg-amber-400 border-2 border-slate-950 shadow-lg flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />
                </div>
              </div>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
