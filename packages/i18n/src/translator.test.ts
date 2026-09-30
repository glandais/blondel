import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  NARROW_NBSP,
  NBSP,
  createTranslator,
  createTranslatorFrom,
  detectLocale,
  isLocale,
  isMessage,
  listPlaceholders,
  msg,
  num,
  translatorFor,
  type MessageKey,
  type Messages,
} from "./index";

const FR: Messages = {
  "test.hello": "Bonjour {name}",
  "test.steps.one": "{count} marche",
  "test.steps.other": "{count} marches",
  "test.outer": "Constat : {inner}",
  "test.inner": "limon {mark}",
  "test.height": "Hauteur {h}",
  "test.repeat": "{a} et {a}",
};
const EN: Messages = {
  "test.hello": "Hello {name}",
  "test.steps.one": "{count} step",
  "test.steps.other": "{count} steps",
  "test.outer": "Finding: {inner}",
  "test.inner": "stringer {mark}",
  "test.height": "Height {h}",
  "test.repeat": "{a} and {a}",
};
const tFr = createTranslatorFrom("fr", FR);
const tEn = createTranslatorFrom("en", EN);
/** Les clés de test ne sont pas dans fr.json : conversion pour le typage seulement. */
const k = (key: string): MessageKey => key as MessageKey;

describe("langues", () => {
  it("détection par la langue du navigateur", () => {
    expect(detectLocale("en")).toBe("en");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("EN-gb")).toBe("en");
    expect(detectLocale("fr-FR")).toBe("fr");
    expect(detectLocale("de-DE")).toBe("fr");
    expect(detectLocale("eng")).toBe("fr");
    expect(detectLocale("")).toBe("fr");
    expect(detectLocale(undefined)).toBe("fr");
    expect(DEFAULT_LOCALE).toBe("fr");
  });

  it("isLocale", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("traducteur mémoïsé par langue", () => {
    expect(createTranslator("fr")).toBe(createTranslator("fr"));
    expect(createTranslator("en")).not.toBe(createTranslator("fr"));
    expect(translatorFor()).toBe(createTranslator("fr"));
    expect(translatorFor("en").locale).toBe("en");
  });

  it("dictionnaires réels", () => {
    expect(createTranslator("fr").t("common.language.label")).toBe("Langue");
    expect(createTranslator("en").t("common.language.label")).toBe("Language");
  });
});

describe("messages", () => {
  it("les clés sont typées par fr.json", () => {
    // @ts-expect-error clé absente de fr.json : refusée à la compilation
    const unknown = msg("unknown.key");
    expect(unknown.key).toBe("unknown.key");
  });

  it("msg, num et isMessage", () => {
    expect(msg("common.language.fr")).toEqual({ key: "common.language.fr" });
    expect(msg(k("test.hello"), { name: "Ada" })).toEqual({
      key: "test.hello",
      params: { name: "Ada" },
    });
    expect(num(1.5)).toEqual({ num: 1.5 });
    expect(num(1.5, 2, "mm")).toEqual({ num: 1.5, digits: 2, unit: "mm" });
    expect(isMessage(msg(k("a.b")))).toBe(true);
    expect(isMessage(num(1))).toBe(false);
    expect(isMessage("a.b")).toBe(false);
    expect(isMessage(null)).toBe(false);
  });

  it("interpolation", () => {
    expect(tFr.t(msg(k("test.hello"), { name: "Ada" }))).toBe("Bonjour Ada");
    expect(tEn.t(k("test.hello"), { name: "Ada" })).toBe("Hello Ada");
    expect(tFr.t(k("test.repeat"), { a: "x" })).toBe("x et x");
    // Paramètre manquant : le gabarit reste visible, pas d'exception.
    expect(tFr.t(k("test.hello"))).toBe("Bonjour {name}");
    // Les paramètres passés à t complètent ceux du message.
    expect(tFr.t(msg(k("test.hello"), { name: "A" }), { name: "B" })).toBe("Bonjour B");
  });

  it("repli : clé absente → la clé elle-même", () => {
    expect(tFr.t(k("absent.key"))).toBe("absent.key");
    expect(tEn.t(msg(k("absent.key"), { x: "1" }))).toBe("absent.key");
  });

  it("nombres en paramètre", () => {
    expect(tFr.t(k("test.height"), { h: num(180.667, 1, "mm") })).toBe(`Hauteur 180,7${NBSP}mm`);
    expect(tEn.t(k("test.height"), { h: num(180.667, 1, "mm") })).toBe("Height 180.7 mm");
    expect(tFr.t(k("test.height"), { h: { num: 250, digits: 1, trimZeros: true } })).toBe(
      "Hauteur 250",
    );
    expect(tFr.t(k("test.height"), { h: 2.5 })).toBe("Hauteur 2,5");
    expect(tEn.t(k("test.height"), { h: 12345 })).toBe("Height 12,345");
    expect(tFr.t(k("test.height"), { h: num(42, 0, "°") })).toBe("Hauteur 42°");
  });

  it("messages imbriqués", () => {
    const m = msg(k("test.outer"), { inner: msg(k("test.inner"), { mark: "L1" }) });
    expect(tFr.t(m)).toBe("Constat : limon L1");
    expect(tEn.t(m)).toBe("Finding: stringer L1");
  });

  it("pluriel en français : 0 et 1 au singulier", () => {
    const steps = (count: number) => tFr.t(k("test.steps"), { count });
    expect(steps(0)).toBe("0 marche");
    expect(steps(1)).toBe("1 marche");
    expect(steps(2)).toBe("2 marches");
    expect(steps(1.5)).toBe("1,5 marche");
    expect(steps(1_000_000)).toBe(`1${NARROW_NBSP}000${NARROW_NBSP}000 marches`);
  });

  it("pluriel en anglais : 1 seul au singulier", () => {
    const steps = (count: number) => tEn.t(k("test.steps"), { count });
    expect(steps(0)).toBe("0 steps");
    expect(steps(1)).toBe("1 step");
    expect(steps(2)).toBe("2 steps");
  });

  it("pluriel sur un paramètre numérique mis en forme", () => {
    expect(tEn.t(k("test.steps"), { count: num(1, 0) })).toBe("1 step");
    // « 1.0 » n'est pas singulier en anglais.
    expect(tEn.t(k("test.steps"), { count: num(1, 1) })).toBe("1.0 steps");
    expect(tEn.t(k("test.steps"), { count: { num: 1, digits: 1, trimZeros: true } })).toBe(
      "1 step",
    );
    expect(tFr.t(k("test.steps"), { count: num(1, 1) })).toBe("1,0 marche");
  });

  it("pluriel sur un nombre brut : valeur telle qu'affichée", () => {
    // 1,0004 s'affiche « 1 » (3 décimales au plus) : singulier en anglais.
    expect(tEn.t(k("test.steps"), { count: 1.0004 })).toBe("1 step");
    expect(tFr.t(k("test.steps"), { count: -0 })).toBe("0 marche");
    expect(tEn.t(k("test.steps"), { count: Number.NaN })).toBe("— steps");
  });

  it("jamais d'exception : décimales hors plage, paramètres inattendus", () => {
    expect(tFr.t(k("test.height"), { h: num(1.25, 500) })).toMatch(/^Hauteur 1,25/);
    expect(tFr.t(k("test.height"), { h: num(1.25, -3) })).toBe("Hauteur 1");
    expect(tEn.t(k("test.steps"), { count: num(1, 1000) })).toMatch(/steps$/);
    expect(createTranslator("fr").num(2.5, { digits: Number.NaN })).toBe("2,5");
    expect(tFr.t(k("test.hello"), { name: msg(k("absent.key")) })).toBe("Bonjour absent.key");
  });

  it("un Message survit à structuredClone (postMessage du worker) et se traduit pareil", () => {
    const m = msg(k("test.outer"), {
      inner: msg(k("test.inner"), { mark: "L1" }),
      h: num(12.5, 1, "mm"),
      count: 3,
    });
    const clone = structuredClone(m);
    expect(clone).toEqual(m);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    expect(tFr.t(clone)).toBe(tFr.t(m));
  });

  it("clé plurielle sans count : variante .other", () => {
    expect(tFr.t(k("test.steps"))).toBe("{count} marches");
  });

  it("listPlaceholders", () => {
    expect(listPlaceholders("{a} et {b}, encore {a}")).toEqual(["a", "b"]);
    expect(listPlaceholders("aucun")).toEqual([]);
  });
});

describe("nombres", () => {
  const fr = createTranslator("fr");
  const en = createTranslator("en");

  it("français : virgule et espace fine insécable (comme formatFr)", () => {
    expect(fr.num(1234.56)).toBe(`1${NARROW_NBSP}234,6`);
    expect(fr.num(1234.56, { digits: 2 })).toBe(`1${NARROW_NBSP}234,56`);
    expect(fr.num(1234567, { digits: 0 })).toBe(`1${NARROW_NBSP}234${NARROW_NBSP}567`);
    expect(fr.num(1234.5, { thousands: "" })).toBe("1234,5");
    expect(fr.num(250, { trimZeros: true })).toBe("250");
    expect(fr.num(250.5, { digits: 3, trimZeros: true })).toBe("250,5");
    expect(fr.num(-0.01)).toBe("0,0");
    expect(fr.num(-0)).toBe("0,0");
    expect(fr.num(-0.4, { digits: 0 })).toBe("0");
    expect(fr.num(-1234.5)).toBe(`-1${NARROW_NBSP}234,5`);
    expect(fr.num(Number.NaN)).toBe("—");
    expect(fr.num(Number.POSITIVE_INFINITY)).toBe("—");
    expect(fr.num(12.3, { unit: "mm" })).toBe(`12,3${NBSP}mm`);
  });

  it("anglais : point décimal et virgule des milliers", () => {
    expect(en.num(1234.56)).toBe("1,234.6");
    expect(en.num(1234567.891, { digits: 2 })).toBe("1,234,567.89");
    expect(en.num(250, { trimZeros: true })).toBe("250");
    expect(en.num(-0.01)).toBe("0.0");
    expect(en.num(Number.NaN)).toBe("—");
    expect(en.num(12.3, { unit: "mm" })).toBe("12.3 mm");
  });
});

describe("dates et tri", () => {
  it("dates", () => {
    const d = new Date(2026, 8, 3);
    expect(createTranslator("fr").date(d)).toBe("03/09/2026");
    expect(createTranslator("en").date(d)).toBe("2026-09-03");
    expect(createTranslator("fr").date(new Date(Number.NaN))).toBe("—");
  });

  it("comparaison selon la langue", () => {
    const fr = createTranslator("fr");
    expect(["limon", "Échappée", "escalier", "balustre"].sort(fr.compare)).toEqual([
      "balustre",
      "Échappée",
      "escalier",
      "limon",
    ]);
    expect(fr.compare("a", "a")).toBe(0);
  });
});
