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
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ">") {
      return svgString.slice(startIndex, i);
    }
  }

  return null;
};

/**
 * Deterministically parses XML/HTML attributes from the root SVG opening tag
 * without regular expression backtracking or complexity overhead.
 */
const getRootAttributeValue = (
  attributesString: string,
  targetAttr: string,
): string | null => {
  const targetLower = targetAttr.toLowerCase();
  let i = 0;
  const len = attributesString.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(attributesString[i])) {
      i++;
    }
    if (i >= len) break;

    // Read attribute key
    const keyStart = i;
    while (i < len && /[a-zA-Z0-9:_-]/.test(attributesString[i])) {
      i++;
    }
    if (i === keyStart) {
      i++;
      continue;
    }
    const key = attributesString.slice(keyStart, i);

    // Skip whitespace after key
    while (i < len && /\s/.test(attributesString[i])) {
      i++;
    }

    let value: string | null = null;
    if (i < len && attributesString[i] === "=") {
      i++; // consume '='
      while (i < len && /\s/.test(attributesString[i])) {
        i++;
      }
      if (i < len) {
        const quote = attributesString[i];
        if (quote === '"' || quote === "'") {
          i++; // consume opening quote
          const valStart = i;
          while (i < len && attributesString[i] !== quote) {
            i++;
          }
          value = attributesString.slice(valStart, i);
          if (i < len) i++; // consume closing quote
        } else {
          // Unquoted attribute value
          const valStart = i;
          while (i < len && !/\s/.test(attributesString[i])) {
            i++;
          }
          value = attributesString.slice(valStart, i);
        }
      }
    }

    if (key.toLowerCase() === targetLower) {
      return value ?? "";
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
