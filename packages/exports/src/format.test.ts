import { createTranslator } from "@blondel/i18n";
import fc from "fast-check";
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

describe('formatFr et createTranslator("fr").num', () => {
  it("donnent le même texte sur des cas limites choisis", () => {
    const fr = createTranslator("fr");
    const values = [
      0,
      -0,
      0.05,
      -0.05,
      0.04,
      -0.04,
      -0.4,
      -0.5,
      0.5,
      1.005,
      -1.005,
      2.675,
      9.95,
      -9.95,
      999.95,
      999.949,
      1000,
      -1000,
      1234.5,
      -1234.56,
      12_345_678.9,
      -12_345_678.9,
      1e15,
      180.667,
      250,
      1 / 3,
      -2 / 3,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (const value of values) {
      for (const decimals of [undefined, 0, 1, 2, 3, 6]) {
        for (const thousands of [undefined, "", " ", "."]) {
          for (const trimZeros of [undefined, false, true]) {
            const expected = formatFr(value, {
              ...(decimals === undefined ? {} : { decimals }),
              ...(thousands === undefined ? {} : { thousands }),
              ...(trimZeros === undefined ? {} : { trimZeros }),
            });
            const actual = fr.num(value, {
              ...(decimals === undefined ? {} : { digits: decimals }),
              ...(thousands === undefined ? {} : { thousands }),
              ...(trimZeros === undefined ? {} : { trimZeros }),
            });
            expect(actual, `${value} ${decimals} ${thousands} ${trimZeros}`).toBe(expected);
          }
        }
      }
    }
  });

  it("donnent le même texte (migration sans écart d'instantané, ADR-0007)", () => {
    const fr = createTranslator("fr");
    fc.assert(
      fc.property(
        fc.oneof(fc.double({ min: -1e9, max: 1e9 }), fc.constantFrom(0, -0, Number.NaN)),
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom(undefined, "", " ", "."),
        fc.boolean(),
        (value, decimals, thousands, trimZeros) => {
          const frOptions = thousands === undefined ? {} : { thousands };
          expect(fr.num(value, { digits: decimals, trimZeros, ...frOptions })).toBe(
            formatFr(value, { decimals, trimZeros, ...frOptions }),
          );
        },
      ),
    );
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
