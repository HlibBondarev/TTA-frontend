export interface SvgDimensions {
  width: number;
  height: number;
  aspectRatio: string;
}

// Number pattern supporting integers, decimals, and scientific/exponent notation (e.g., 1e2, -1.5e-3)
const NUM_PATTERN = String.raw`[-+]?(?:\d*\.?\d+|\d+)(?:[eE][-+]?\d+)?`;

// Regex matching exact viewBox attribute (preceded by whitespace or start of attributes string)
const VIEWBOX_REGEX = new RegExp(
  String.raw`(?:\s|^)viewBox\s*=\s*["']\s*(${NUM_PATTERN})[\s,]+(${NUM_PATTERN})[\s,]+(${NUM_PATTERN})[\s,]+(${NUM_PATTERN})\s*["']`,
  "i",
);

// Regex matching the attributes of the root <svg ...> element only
const ROOT_SVG_REGEX = /<svg\b([^>]*)>/i;

export const parseSvgDimensions = (
  svgString?: string | null,
): SvgDimensions | null => {
  if (!svgString) return null;

  try {
    // Strip XML/HTML comments to ensure we match the actual root <svg> element
    const sanitizedSvg = svgString.replace(/<!--[\s\S]*?-->/g, "");
    const rootMatch = ROOT_SVG_REGEX.exec(sanitizedSvg);
    if (!rootMatch?.[1]) return null;

    const match = VIEWBOX_REGEX.exec(rootMatch[1]);
    if (match?.[3] && match?.[4]) {
      const width = Number.parseFloat(match[3]);
      const height = Number.parseFloat(match[4]);
      if (
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width > 0 &&
        height > 0
      ) {
        return {
          width,
          height,
          aspectRatio: `${width} / ${height}`,
        };
      }
    }
  } catch {
    // Ignore parse error
  }

  return null;
};
