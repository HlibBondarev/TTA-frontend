import { describe, it, expect } from "vitest";
import { parseSvgDimensions } from "../../utils/svgUtils";

describe("parseSvgDimensions", () => {
  it("returns null when input is empty, null, or undefined", () => {
    expect(parseSvgDimensions(null)).toBeNull();
    expect(parseSvgDimensions(undefined)).toBeNull();
    expect(parseSvgDimensions("")).toBeNull();
  });

  it("returns null when SVG tag lacks viewBox attribute", () => {
    const svgWithoutViewBox = `<svg width="100" height="100"><rect /></svg>`;
    expect(parseSvgDimensions(svgWithoutViewBox)).toBeNull();
  });

  it("correctly parses viewBox with double quotes", () => {
    const svg = `<svg viewBox="0 0 800 600"></svg>`;
    expect(parseSvgDimensions(svg)).toEqual({
      width: 800,
      height: 600,
      aspectRatio: "800 / 600",
    });
  });

  it("correctly parses viewBox with single quotes", () => {
    const svg = `<svg viewBox='0 0 300 400'></svg>`;
    expect(parseSvgDimensions(svg)).toEqual({
      width: 300,
      height: 400,
      aspectRatio: "300 / 400",
    });
  });

  it("supports comma separators and arbitrary whitespace in viewBox", () => {
    const svgWithCommas = `<svg viewBox="0, 0, 1000, 500"></svg>`;
    expect(parseSvgDimensions(svgWithCommas)).toEqual({
      width: 1000,
      height: 500,
      aspectRatio: "1000 / 500",
    });

    const svgMixedSeparators = `<svg viewBox="  0, 0   250 125  "></svg>`;
    expect(parseSvgDimensions(svgMixedSeparators)).toEqual({
      width: 250,
      height: 125,
      aspectRatio: "250 / 125",
    });
  });

  it("correctly handles negative origin coordinates in viewBox", () => {
    const svg = `<svg viewBox="-50 -50 100 200"></svg>`;
    expect(parseSvgDimensions(svg)).toEqual({
      width: 100,
      height: 200,
      aspectRatio: "100 / 200",
    });
  });

  it("correctly parses decimal width and height values", () => {
    const svg = `<svg viewBox="0 0 100.5 200.75"></svg>`;
    expect(parseSvgDimensions(svg)).toEqual({
      width: 100.5,
      height: 200.75,
      aspectRatio: "100.5 / 200.75",
    });
  });

  it("is case-insensitive for viewBox attribute name", () => {
    const svgLowercase = `<svg viewbox="0 0 400 300"></svg>`;
    expect(parseSvgDimensions(svgLowercase)).toEqual({
      width: 400,
      height: 300,
      aspectRatio: "400 / 300",
    });
  });

  it("returns null when width or height is zero or negative", () => {
    expect(parseSvgDimensions(`<svg viewBox="0 0 0 100"></svg>`)).toBeNull();
    expect(parseSvgDimensions(`<svg viewBox="0 0 100 0"></svg>`)).toBeNull();
    expect(parseSvgDimensions(`<svg viewBox="0 0 -100 50"></svg>`)).toBeNull();
    expect(parseSvgDimensions(`<svg viewBox="0 0 50 -100"></svg>`)).toBeNull();
  });

  it("returns null for invalid or malformed viewBox values", () => {
    expect(
      parseSvgDimensions(`<svg viewBox="invalid viewBox format"></svg>`),
    ).toBeNull();
    expect(parseSvgDimensions(`<svg viewBox="0 0 abc def"></svg>`)).toBeNull();
  });
});
