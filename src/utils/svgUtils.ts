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

// Regex matching individual HTML/XML attributes sequentially: key="val", key='val', key=val, or boolean key
const ATTR_REGEX =
  /(?:\s+|^)([a-zA-Z0-9:_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * Extracts the contents of the root <svg ...> opening tag safely.
 * Iterates deterministically O(N) to respect '>' inside quoted attributes without backtracking issues.
 */
const extractRootSvgAttributes = (svgString: string): string | null => {
  const match = /<svg\b/i.exec(svgString);
  if (!match) return null;

  const startIndex = match.index + match[0].length;
  let inQuote: '"' | "'" | null = null;

  for (let i = startIndex; i < svgString.length; i++) {
    const char = svgString[i];

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuote = char;
      } else if (char === ">") {
        return svgString.slice(startIndex, i);
      }
    }
  }

  return null;
};

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
    const attributesString = extractRootSvgAttributes(sanitizedSvg);
    if (attributesString === null) return null;

    const viewBoxAttr = getRootAttributeValue(attributesString, "viewBox");
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
