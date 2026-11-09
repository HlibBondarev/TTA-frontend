export interface SvgDimensions {
  width: number;
  height: number;
  aspectRatio: string;
}

// Number pattern supporting integers, decimals, and scientific/exponent notation (e.g., 1e2, -1.5e-3)
const NUM_PATTERN = String.raw`[-+]?(?:\d*\.?\d+|\d+)(?:[eE][-+]?\d+)?`;

// Regex matching values of 4 viewBox coordinates
const VIEWBOX_VALUE_REGEX = new RegExp(
  String.raw`^\s*(${NUM_PATTERN})[\s,]+(${NUM_PATTERN})[\s,]+(${NUM_PATTERN})[\s,]+(${NUM_PATTERN})\s*$`,
);

// Regex matching the attributes string of the root <svg ...> element only
const ROOT_SVG_REGEX = /<svg\b([^>]*)>/i;

// Regex matching individual HTML/XML attributes sequentially: key="val", key='val', key=val, or boolean key
const ATTR_REGEX =
  /(?:\s+|^)([a-zA-Z0-9:_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const getRootAttributeValue = (
  attributesString: string,
  targetAttr: string,
): string | null => {
  ATTR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_REGEX.exec(attributesString)) !== null) {
    const attrName = match[1];
    if (attrName.toLowerCase() === targetAttr.toLowerCase()) {
      return match[2] ?? match[3] ?? match[4] ?? null;
    }
  }
  return null;
};

export const parseSvgDimensions = (
  svgString?: string | null,
): SvgDimensions | null => {
  if (!svgString) return null;

  try {
    // Strip XML/HTML comments to ensure we match the actual root <svg> element
    const sanitizedSvg = svgString.replace(/<!--[\s\S]*?-->/g, "");
    const rootMatch = ROOT_SVG_REGEX.exec(sanitizedSvg);
    if (!rootMatch?.[1]) return null;

    const viewBoxAttr = getRootAttributeValue(rootMatch[1], "viewBox");
    if (!viewBoxAttr) return null;

    const match = VIEWBOX_VALUE_REGEX.exec(viewBoxAttr);
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
