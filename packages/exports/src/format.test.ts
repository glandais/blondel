import { describe, expect, it } from "vitest";
import { escapeXml, formatFr, formatNum } from "./format.js";

describe("formatFr", () => {
  it("virgule décimale, milliers, zéros", () => {
    expect(formatFr(2700, { decimals: 0, thousands: " " })).toBe("2 700");
    expect(formatFr(176.666, { decimals: 1, thousands: "" })).toBe("176,7");
    expect(formatFr(-1234567.891, { decimals: 2, thousands: "." })).toBe("-1.234.567,89");
    expect(formatFr(-0.01, { decimals: 1 })).toBe("0,0");
    expect(formatFr(90, { decimals: 1, trimZeros: true })).toBe("90");
    expect(formatFr(Number.NaN)).toBe("—");
  });
});

describe("formatNum", () => {
  it("écrit un nombre machine compact", () => {
    expect(formatNum(1 / 3)).toBe("0.333333");
    expect(formatNum(250)).toBe("250");
    expect(formatNum(-1e-9)).toBe("0");
    expect(formatNum(123456789.1234567, 2)).toBe("123456789.12");
    expect(() => formatNum(1e21)).toThrow(RangeError);
    expect(() => formatNum(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("escapeXml", () => {
  it("échappe les cinq caractères réservés", () => {
    expect(escapeXml(`a<b>&"c'`)).toBe("a&lt;b&gt;&amp;&quot;c&apos;");
  });
});
