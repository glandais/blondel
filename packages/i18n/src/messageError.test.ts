import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MessageError,
  createTranslatorFrom,
  dec,
  errorMessage,
  isMessageError,
  messageEquals,
  msg,
  num,
  textMessage,
  translatorFor,
  type MessageKey,
} from "./index";

/** Clé de test absente des dictionnaires (la traduction rend la clé). */
const k = (key: string): MessageKey => key as MessageKey;

describe("textMessage", () => {
  it("rend le texte tel quel dans toutes les langues", () => {
    const m = textMessage("M5");
    expect(m).toEqual({ key: "common.text", params: { text: "M5" } });
    expect(translatorFor("fr").t(m)).toBe("M5");
    expect(translatorFor("en").t(m)).toBe("M5");
  });
});

describe("messageEquals", () => {
  it("compare clés et paramètres, récursivement", () => {
    const a = msg(k("x.a"), { n: num(1.5, 1, "mm"), inner: textMessage("L1"), s: "b", c: 2 });
    const b = msg(k("x.a"), { c: 2, s: "b", inner: textMessage("L1"), n: num(1.5, 1, "mm") });
    expect(messageEquals(a, b)).toBe(true);
    expect(messageEquals(a, { ...b, key: k("x.b") })).toBe(false);
    expect(messageEquals(a, msg(k("x.a"), { ...b.params, n: num(1.5, 2, "mm") }))).toBe(false);
    expect(messageEquals(a, msg(k("x.a"), { ...b.params, inner: textMessage("L2") }))).toBe(false);
    expect(messageEquals(a, msg(k("x.a"), { ...b.params, c: "2" }))).toBe(false);
    expect(messageEquals(msg(k("x.a")), msg(k("x.a"), {}))).toBe(true);
    expect(messageEquals(msg(k("x.a"), { s: "b" }), msg(k("x.a"), { t: "b" }))).toBe(false);
    expect(
      messageEquals(msg(k("x.a"), { n: num(1) }), msg(k("x.a"), { n: textMessage("1") })),
    ).toBe(false);
  });
});

describe("MessageError", () => {
  it("porte le message ; son texte est la traduction française", () => {
    const m = textMessage("Hauteur impossible");
    const e = new MessageError(m);
    expect(e).toBeInstanceOf(Error);
    expect(e.msg).toBe(m);
    expect(e.message).toBe("Hauteur impossible");
    expect(e.name).toBe("MessageError");
    expect(() => {
      throw e;
    }).toThrow(/impossible/);
  });

  it("clé absente : le texte est la clé (jamais d'exception)", () => {
    expect(new MessageError(msg(k("x.absente"))).message).toBe("x.absente");
  });

  it("transmet la cause", () => {
    const cause = new Error("bas niveau");
    expect(new MessageError(textMessage("haut niveau"), { cause }).cause).toBe(cause);
  });

  it("sous-classes reconnues par isMessageError", () => {
    class StageError extends MessageError {}
    expect(isMessageError(new StageError(textMessage("a")))).toBe(true);
    expect(isMessageError(new Error("a"))).toBe(false);
    expect(isMessageError({ msg: textMessage("a") })).toBe(false);
  });
});

describe("dec (ancien fmt de core)", () => {
  /** L'ancien `fmt` de `rules/check.ts`, à l'identique. */
  const oldFmt = (x: number, digits = 1): string => {
    const f = 10 ** digits;
    return String(Math.round(x * f) / f).replace(".", ",");
  };
  const t = createTranslatorFrom("fr", { "x.v": "{v}" });

  it("rend exactement le texte de l'ancien fmt en français", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: 0, max: 3 }),
        (x, digits) => {
          expect(t.t(k("x.v"), { v: dec(x, digits) })).toBe(oldFmt(x, digits));
        },
      ),
    );
    expect(t.t(k("x.v"), { v: dec(1900) })).toBe("1900");
    expect(t.t(k("x.v"), { v: dec(-0.01) })).toBe("0");
    expect(t.t(k("x.v"), { v: dec(2.25, 2) })).toBe("2,25");
    expect(t.t(k("x.v"), { v: dec(-2.5, 0) })).toBe("-2");
  });

  it("anglais : point décimal, sans séparateur de milliers", () => {
    const t = createTranslatorFrom("en", { "x.v": "{v}" });
    expect(t.t(k("x.v"), { v: dec(12345.678, 2) })).toBe("12345.68");
    expect(t.t(k("x.v"), { v: dec(12, 1, "mm") })).toBe("12 mm");
  });
});

describe("errorMessage", () => {
  it("msg d'une MessageError, texte brut sinon", () => {
    const m = msg(k("x.a"), { v: 1 });
    expect(errorMessage(new MessageError(m))).toBe(m);
    expect(errorMessage(new Error("boum"))).toEqual(textMessage("boum"));
    expect(errorMessage("chaîne")).toEqual(textMessage("chaîne"));
    expect(errorMessage(42)).toEqual(textMessage("42"));
  });
});
