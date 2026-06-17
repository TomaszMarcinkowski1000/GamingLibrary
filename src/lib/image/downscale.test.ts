import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_EDGE, computeTargetDimensions } from "./downscale";

describe("computeTargetDimensions", () => {
  it("clamps a landscape image's long edge to maxEdge, preserving aspect ratio", () => {
    const { width, height } = computeTargetDimensions(4000, 3000, 1024);
    expect(width).toBe(1024);
    expect(height).toBe(768);
    expect(width / height).toBeCloseTo(4000 / 3000, 5);
  });

  it("clamps a portrait image's long edge (height) to maxEdge", () => {
    const { width, height } = computeTargetDimensions(3000, 4000, 1024);
    expect(height).toBe(1024);
    expect(width).toBe(768);
  });

  it("passes a below-threshold image through unscaled", () => {
    const dims = computeTargetDimensions(800, 600, 1024);
    expect(dims).toEqual({ width: 800, height: 600 });
  });

  it("passes an exactly-at-threshold image through unscaled", () => {
    const dims = computeTargetDimensions(1024, 512, 1024);
    expect(dims).toEqual({ width: 1024, height: 512 });
  });

  it("rounds fractional scaled dimensions to whole pixels", () => {
    const { width, height } = computeTargetDimensions(1000, 333, 500);
    expect(width).toBe(500);
    expect(height).toBe(167); // 333 * 0.5 = 166.5 → 167
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });

  it("handles a square image at the bound", () => {
    expect(computeTargetDimensions(2048, 2048, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it("defaults maxEdge to DEFAULT_MAX_EDGE when omitted", () => {
    const { width } = computeTargetDimensions(DEFAULT_MAX_EDGE * 2, DEFAULT_MAX_EDGE, undefined);
    expect(width).toBe(DEFAULT_MAX_EDGE);
  });
});
