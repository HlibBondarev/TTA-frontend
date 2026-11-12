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

  it("supports optional whitespace around the equals sign", () => {
    const svgWithSpaces = `<svg viewBox = "0 0 800 600"></svg>`;
    expect(parseSvgDimensions(svgWithSpaces)).toEqual({
      width: 800,
      height: 600,
      aspectRatio: "800 / 600",
    });

    const svgSpaceBefore = `<svg viewBox = '0 0 500 400'></svg>`;
    expect(parseSvgDimensions(svgSpaceBefore)).toEqual({
      width: 500,
      height: 400,
      aspectRatio: "500 / 400",
    });
  });

  it("correctly parses numbers in exponent/scientific notation", () => {
    const svgScientific = `<svg viewBox="0 0 1e3 5e2"></svg>`;
    expect(parseSvgDimensions(svgScientific)).toEqual({
      width: 1000,
      height: 500,
      aspectRatio: "1000 / 500",
    });

    const svgScientificDecimals = `<svg viewBox="0 0 1.5e2 2.5E2"></svg>`;
    expect(parseSvgDimensions(svgScientificDecimals)).toEqual({
      width: 150,
      height: 250,
      aspectRatio: "150 / 250",
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

  it("returns null when width or height values are non-finite (Infinity)", () => {
    expect(
      parseSvgDimensions(`<svg viewBox="0 0 1e1000 500"></svg>`),
    ).toBeNull();
    expect(
      parseSvgDimensions(`<svg viewBox="0 0 500 1e1000"></svg>`),
    ).toBeNull();
  });

  it("returns null for invalid or malformed viewBox values", () => {
    expect(
      parseSvgDimensions(`<svg viewBox="invalid viewBox format"></svg>`),
    ).toBeNull();
    expect(parseSvgDimensions(`<svg viewBox="0 0 abc def"></svg>`)).toBeNull();
  });

  it("returns null and ignores viewBox on nested elements when root SVG element has no viewBox", () => {
    const svgWithNestedViewBox = `<svg width="100" height="100"><symbol viewBox="0 0 50 50"></symbol></svg>`;
    expect(parseSvgDimensions(svgWithNestedViewBox)).toBeNull();
  });

  it("parses viewBox strictly from the root SVG element, ignoring nested viewBox attributes", () => {
    const svgWithMultipleViewBoxes = `<svg viewBox="0 0 800 600"><svg viewBox="0 0 100 100"></svg></svg>`;
    expect(parseSvgDimensions(svgWithMultipleViewBoxes)).toEqual({
      width: 800,
      height: 600,
      aspectRatio: "800 / 600",
    });
  });

  it("returns null when root SVG has data-viewBox instead of viewBox", () => {
    const svgWithDataViewBox = `<svg data-viewBox="0 0 50 50"></svg>`;
    expect(parseSvgDimensions(svgWithDataViewBox)).toBeNull();
  });

  it("ignores <svg> tags inside comments before the root SVG element", () => {
    const svgWithComment = `<!-- <svg viewBox="0 0 50 50"></svg> --><svg viewBox="0 0 800 600"></svg>`;
    expect(parseSvgDimensions(svgWithComment)).toEqual({
      width: 800,
      height: 600,
      aspectRatio: "800 / 600",
    });
  });

  it("returns null when viewBox text appears inside another attribute value of root SVG element", () => {
    const svgWithNestedAttrText = `<svg data-note='text viewBox="0 0 50 50"'></svg>`;
    expect(parseSvgDimensions(svgWithNestedAttrText)).toBeNull();
  });

  it("correctly reads root viewBox when preceding attributes contain viewBox text in quotes", () => {
    const svgWithComplexAttr = `<svg data-note='text viewBox="0 0 50 50"' viewBox="0 0 800 600"></svg>`;
    expect(parseSvgDimensions(svgWithComplexAttr)).toEqual({
      width: 800,
      height: 600,
      aspectRatio: "800 / 600",
    });
  });

  it("returns null when root SVG attribute value contains '>' and no viewBox attribute exists", () => {
    const svgWithGreaterThanInAttr = `<svg data-note='text viewBox="0 0 50 50" > more'></svg>`;
    expect(parseSvgDimensions(svgWithGreaterThanInAttr)).toBeNull();
  });

  it("correctly parses root viewBox when a preceding attribute contains '>' inside quotes", () => {
    const svgWithGreaterThanAndValidViewBox = `<svg data-note='text viewBox="0 0 50 50" > more' viewBox="0 0 800 600"></svg>`;
    expect(parseSvgDimensions(svgWithGreaterThanAndValidViewBox)).toEqual({
      width: 800,
      height: 600,
      aspectRatio: "800 / 600",
    });
  });

  it("returns null for invalid or malformed viewBox values", () => {
    expect(
      parseSvgDimensions(`<svg viewBox="invalid viewBox format"></svg>`),
    ).toBeNull();
    expect(parseSvgDimensions(`<svg viewBox="0 0 abc def"></svg>`)).toBeNull();
    expect(
      parseSvgDimensions(`<svg viewBox="0,,0,,100,,100"></svg>`),
    ).toBeNull();
    expect(
      parseSvgDimensions(`<svg viewBox="0, , 0, 100, 100"></svg>`),
    ).toBeNull();
  });
});
