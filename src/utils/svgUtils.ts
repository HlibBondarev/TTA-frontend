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

const skipWhitespace = (str: string, startIndex: number): number => {
  let i = startIndex;
  while (i < str.length && /\s/.test(str[i])) {
    i++;
  }
  return i;
};

const parseAttributeValue = (
  str: string,
  startIndex: number,
): { value: string; nextIndex: number } => {
  let i = skipWhitespace(str, startIndex);
  if (i >= str.length) return { value: "", nextIndex: i };

  const quote = str[i];
  if (quote === '"' || quote === "'") {
    i++;
    const valStart = i;
    while (i < str.length && str[i] !== quote) {
      i++;
    }
    const value = str.slice(valStart, i);
    return { value, nextIndex: i < str.length ? i + 1 : i };
  }

  const valStart = i;
  while (i < str.length && !/\s/.test(str[i])) {
    i++;
  }
  return { value: str.slice(valStart, i), nextIndex: i };
};

interface AttributeMatch {
  key: string;
  value: string | null;
  nextIndex: number;
}

const parseNextAttribute = (
  str: string,
  startIndex: number,
): AttributeMatch | null => {
  let i = skipWhitespace(str, startIndex);
  if (i >= str.length) return null;

  const keyStart = i;
  while (i < str.length && /[a-zA-Z0-9:_-]/.test(str[i])) {
    i++;
  }
  if (i === keyStart) {
    return { key: "", value: null, nextIndex: i + 1 };
  }
  const key = str.slice(keyStart, i);
  i = skipWhitespace(str, i);

  if (i >= str.length || str[i] !== "=") {
    return { key, value: null, nextIndex: i };
  }

  i++; // consume '='
  const { value, nextIndex } = parseAttributeValue(str, i);
  return { key, value, nextIndex };
};

/**
 * Deterministically parses XML/HTML attributes from the root SVG opening tag
 * without regular expression backtracking or high cognitive complexity.
 */
const getRootAttributeValue = (
  attributesString: string,
  targetAttr: string,
): string | null => {
  const targetLower = targetAttr.toLowerCase();
  let i = 0;

  while (i < attributesString.length) {
    const attr = parseNextAttribute(attributesString, i);
    if (!attr) break;

    i = attr.nextIndex;
    if (attr.key?.toLowerCase() === targetLower) {
      return attr.value ?? "";
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
