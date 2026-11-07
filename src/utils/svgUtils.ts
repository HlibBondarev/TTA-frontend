export interface SvgDimensions {
  width: number;
  height: number;
  aspectRatio: string;
}

export const parseSvgDimensions = (
  svgString?: string | null,
): SvgDimensions | null => {
  if (!svgString) return null;

  try {
    const match = svgString.match(
      /viewBox=["']\s*([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)\s*["']/i,
    );
    if (match && match[3] && match[4]) {
      const width = parseFloat(match[3]);
      const height = parseFloat(match[4]);
      if (width > 0 && height > 0) {
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
