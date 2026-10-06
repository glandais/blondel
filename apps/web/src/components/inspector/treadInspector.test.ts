/**
 * Inspecteur Marche (maquette 2a, ADR-0009) en rendu serveur : valeurs lues dans le modèle,
 * « — » sans champ du cœur, échappée « non limitée », ‹ › désactivés aux bouts, bloc « Ligne de
 * nez » (angle, valeur calculée, retouches, orphelines) ou indisponible en hélicoïdal, français
 * et anglais sans clé brute, mention indicative en pied.
 */
import {
  ProjectSchema,
  buildModel,
  createProject,
  parseProjectText,
  type Model,
  type Project,
} from "@blondel/core";
import curvedDemo from "../../../../../examples/demo-quarter-curved.blondel.json?raw";
import { translatorFor } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { withAngleOverride, withFixedOverride } from "../../lib/nosingOverrides.js";
import { appStore, journeyStore, modelService } from "../../store/appStore.js";
import { uiStore } from "../../store/uiStore.js";
import { selectionLegendText } from "../guided/GuidedView.js";
import { lastTreadBefore } from "./ArrivalNosingInspector.js";
import { Inspector } from "./Inspector.js";
import { arrowsTargetNosing, nosingArrowGroup } from "./NosingLineBlock.js";
import {
  MISSING,
  TreadInspector,
  neighbourTreads,
  nextTarget,
  treadValues,
} from "./TreadInspector.js";

const initial = appStore.getState().project;

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant des stores.
appStore.getInitialState = appStore.getState;
modelService.store.getInitialState = modelService.store.getState;
journeyStore.getInitialState = journeyStore.getState;
uiStore.getInitialState = uiStore.getState;

/** Projet courant et son modèle (calculé ici, sans le worker), éventuellement retouché. */
function load(p: Project, patch: (m: Model) => Model = (m) => m): Model {
  appStore.getState().replaceProject(p);
  const project = appStore.getState().project;
  const model = patch(buildModel(project));
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project, pending: false },
  }));
  return model;
}

afterEach(() => {
  appStore.getState().select(null);
  appStore.getState().setDisplayUnit("mm");
  appStore.getState().setLocale("fr");
  load(initial);
});

function render(n: number, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(TreadInspector, { number: n }));
}

const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s/gu, " ");

/** Lignes du tableau : identifiant → [libellé, valeur]. */
function rows(html: string): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  const re = /data-value="(\w+)"><td>(.*?)<\/td><td>(.*?)<\/td>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    out[m[1]!] = [decode(m[2]!), decode(m[3]!)];
  }
  return out;
}

const quarter = createProject("quarter-left");
/** Première marche balancée du quart tournant. */
const winder = (m: Model) => m.stepping.treads.find((t) => t.kind === "winder")!.number;

/** Modèle sans les champs exposés par le cœur pour l'inspecteur (modèle d'avant la vague 3). */
const withoutCoreFields = (m: Model): Model => {
  const { headroomAtNosings: _h, ...rest } = m;
  return {
    ...rest,
    stepping: {
      ...m.stepping,
      nosings: m.stepping.nosings.map(({ angle: _a, computedAngle: _c, ...n }) => n),
    },
  };
};

describe("valeurs de la marche", () => {
  it("lues dans le modèle, mm entiers ; cm suivis", () => {
    const m = load(quarter, (x) => ({
      ...x,
      headroomAtNosings: x.stepping.nosings.map(() => 2345.4),
    }));
    const n = winder(m);
    const tread = m.stepping.treads.find((t) => t.number === n)!;
    const v = rows(render(n));
    expect(v["going"]).toEqual(["Giron (ligne de foulée)", `${Math.round(tread.going)} mm`]);
    expect(v["collet"]![0]).toBe("Collet");
    expect(v["collet"]![1]).toMatch(/^\d[\d ]* mm$/);
    expect(v["rise"]).toEqual(["Hauteur", `${Math.round(m.stepping.rises[n - 1]!)} mm`]);
    expect(v["altitude"]![0]).toBe("Altitude du nez");
    expect(v["headroom"]).toEqual(["Échappée au nez", "2 345 mm"]);
    appStore.getState().setDisplayUnit("cm");
    expect(rows(render(n))["headroom"]![1]).toBe("234,5 cm");
  });

  it("échappée : null → « non limitée », champ absent → « — »", () => {
    const m = load(quarter, (x) => ({
      ...x,
      headroomAtNosings: x.stepping.nosings.map(() => null),
    }));
    expect(rows(render(winder(m)))["headroom"]![1]).toBe("non limitée");
    expect(rows(render(winder(m), "en"))["headroom"]).toEqual(["Headroom at nosing", "unlimited"]);
    const bare = load(quarter, withoutCoreFields);
    expect(rows(render(winder(bare)))["headroom"]![1]).toBe(MISSING);
  });

  it("fonction pure : marche inconnue → « — » partout", () => {
    const m = buildModel(quarter);
    const v = treadValues(m, 999, "mm", "fr", "non limitée");
    expect(v.map((x) => x.value)).toEqual([MISSING, MISSING, MISSING, MISSING, MISSING]);
  });
});

describe("en-tête", () => {
  it("surtitre du tournant, étiquette « balancée », pastille et titre", () => {
    const m = load(quarter);
    const html = render(winder(m));
    expect(html).toContain('class="insp-eyebrow">Marche · tournant 1</span>');
    expect(html).toContain('<span class="insp-swatch" aria-hidden="true"></span>');
    expect(html).toContain(`<h3 class="insp-title">Marche ${winder(m)}</h3>`);
    expect(html).toContain('<span class="tag tag-neutral">balancée</span>');
    const straight = render(1);
    expect(straight).toContain('class="insp-eyebrow">Marche</span>');
    expect(straight).not.toContain("tag-neutral");
  });

  it("‹ désactivé sur la première marche ; › de la dernière mène au nez d'arrivée (A28)", () => {
    const m = load(quarter);
    const numbers = m.stepping.treads.map((t) => t.number);
    const first = Math.min(...numbers);
    const last = Math.max(...numbers);
    expect(neighbourTreads(m.stepping, first)).toEqual({ prev: null, next: first + 1 });
    expect(neighbourTreads(m.stepping, last)).toEqual({ prev: last - 1, next: null });
    expect(nextTarget(m.stepping, first)).toEqual({ kind: "tread", number: first + 1 });
    expect(nextTarget(m.stepping, last)).toEqual({ kind: "nosing", index: last });
    const prev = /<button[^>]*aria-label="Marche précédente"[^>]*>/;
    const next = /<button[^>]*aria-label="Marche suivante"[^>]*>/;
    const toArrival = /<button[^>]*aria-label="Nez d&#x27;arrivée"[^>]*>/;
    expect(prev.exec(render(first))![0]).toContain('disabled=""');
    expect(next.exec(render(first))![0]).not.toContain("disabled");
    expect(next.exec(render(last))).toBeNull();
    expect(toArrival.exec(render(last))![0]).not.toContain("disabled");
    expect(prev.exec(render(last))![0]).not.toContain("disabled");
  });

  it("› sans nez d'arrivée (découpage sans nez au-delà) : rien", () => {
    const m = buildModel(quarter);
    const last = Math.max(...m.stepping.treads.map((t) => t.number));
    const cut = { ...m.stepping, nosings: m.stepping.nosings.slice(0, last) };
    expect(nextTarget(cut, last)).toBeNull();
  });
});

describe("bloc « Ligne de nez »", () => {
  it("angle du cœur, valeur calculée par la méthode de la zone, aide clavier", () => {
    const m = load(quarter, (x) => ({
      ...x,
      stepping: {
        ...x.stepping,
        nosings: x.stepping.nosings.map((n) => ({ ...n, angle: 12.34, computedAngle: 11 })),
      },
    }));
    const html = render(winder(m));
    expect(html).toContain("Ligne de nez");
    expect(html).toMatch(/<input[^>]*value="12,3"/);
    expect(html).toMatch(
      /Calculé par M3 · courbe continue \([a-z]+\)<\/span><span class="nosing-line__value">11,0°/,
    );
    expect(html).toMatch(/aria-pressed="false"[^>]*>Fixer le nez <kbd aria-hidden="true">F<\/kbd>/);
    expect(html).toMatch(
      /<button type="button" class="btn btn-ghost" disabled="" title="[^"]*">Retirer la retouche/,
    );
    expect(html).toContain(
      "← / → ±1°, Maj ±0,1° quand la vue a le focus ; Suppr retire la retouche.",
    );
    // Hors zone balancée.
    expect(render(1)).toContain("Calculé hors balancement");
  });

  it("« Angle imposé » : libellé seul, unité ° à droite du champ (libellés unifiés § 4)", () => {
    const m = load(quarter, (x) => ({
      ...x,
      stepping: {
        ...x.stepping,
        nosings: x.stepping.nosings.map((n) => ({ ...n, angle: 12.34, computedAngle: 11 })),
      },
    }));
    const html = render(winder(m));
    const label = translatorFor("fr").t("ui.inspector.tread.nosing.angle");
    expect(label).toBe("Angle imposé");
    expect(html).toMatch(
      new RegExp(
        `<label for="[^"]+">${label}</label><span class="input-unit"><input[^>]*value="12,3"[^>]*/><span class="input-unit__unit" aria-hidden="true">°</span>`,
      ),
    );
    expect(render(winder(m), "en")).toContain(">Imposed angle</label>");
  });

  it("marche balancée dont le nez avant précède la zone (démo débillardé, M3) : libellé cohérent", () => {
    const m = load(parseProjectText(curvedDemo));
    const n = m.stepping.treads.find(
      (t) =>
        t.kind === "winder" &&
        !m.stepping.balancedZones.some((z) => z.from <= t.number - 1 && t.number - 1 <= z.to),
    )?.number;
    expect(n).toBeDefined();
    if (n === undefined) return;
    const html = decode(render(n));
    expect(html).toContain("Nez hors balancement (zone M3");
    expect(html).not.toContain("Calculé hors balancement");
  });

  it("champs du cœur absents : « — » au lieu d'une saisie", () => {
    const m = load(quarter, withoutCoreFields);
    const html = render(winder(m));
    expect(html).not.toMatch(/<input/);
    expect(html).toContain('<span class="nosing-line__value">—</span>');
  });

  it("retouches : nez fixe pressé, retrait actif, compteur, orphelines", () => {
    const n = winder(buildModel(quarter));
    const count = buildModel(quarter).stepping.nosings.length;
    let p = withFixedOverride(quarter, n - 1, true);
    p = withAngleOverride(p, n - 1, 4.5);
    p = ProjectSchema.parse(withFixedOverride(p, count + 3, true));
    load(p);
    const html = decode(render(n));
    expect(html).toMatch(/aria-pressed="true"[^>]*>Fixer le nez/);
    expect(html).toMatch(/class="btn btn-ghost" title="[^"]*">Retirer la retouche/);
    expect(html).toContain("3 retouches sur l'escalier");
    expect(html).toContain("Tout retirer");
    expect(html).toContain("1 retouche orpheline (nez inexistant)");
    expect(html).toContain("Retirer les orphelines");
    expect(html).toContain('aria-label="Remarques du calcul sur les lignes de nez"');
  });

  it("hélicoïdal : bloc indisponible avec son motif", () => {
    const m = load(createProject("helical"));
    const html = decode(render(m.stepping.treads[2]!.number));
    expect(html).toContain("Retouche de la ligne de nez indisponible : Hélicoïdal");
    expect(html).not.toContain("Fixer le nez");
  });

  it("flèches : seulement dans la vue, hors de ses commandes ; groupe par nez", () => {
    expect(arrowsTargetNosing(null)).toBe(false);
    expect(nosingArrowGroup(3)).not.toBe(nosingArrowGroup(4));
  });
});

describe("langues, mention et dispatch", () => {
  it("anglais : libellés traduits, aucune clé brute ni texte français", () => {
    const m = load(quarter);
    const html = decode(render(winder(m), "en"));
    for (const text of [
      `Tread ${winder(m)}`,
      "Tread · turn 1",
      "winder",
      "Going (walking line)",
      "Narrow end",
      "Rise",
      "Nosing level",
      "Headroom at nosing",
      "Nosing line",
      "Fix the nosing",
      "Remove the override",
      'aria-label="Previous tread"',
    ]) {
      expect(html).toContain(text);
    }
    for (const text of ["Marche", "Giron", "Collet", "Fixer", "Retirer"]) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toMatch(/\b(ui|compliance|stepping)\.[a-z]+\.[\w.]+/);
    expect(decode(render(winder(m)))).not.toMatch(/\b(ui|compliance|stepping)\.[a-z]+\.[\w.]+/);
  });

  it("mention indicative en dernier", () => {
    const m = load(quarter);
    const html = render(winder(m));
    expect(html).toMatch(
      /<p class="inspector-disclaimer">Contrôle de conception indicatif : il ne vaut pas attestation de conformité\.<\/p><\/div>$/,
    );
  });

  it("Inspector : marche ou nez → gabarit 2a ; rien → 2d", () => {
    const m = load(quarter);
    const n = winder(m);
    appStore.getState().select({ location: { kind: "tread", number: n } });
    let html = renderToStaticMarkup(createElement(Inspector));
    expect(html).toContain('data-template="tread"');
    expect(html).toContain(`data-tread-number="${n}"`);
    appStore.getState().select({ location: { kind: "nosing", index: n - 1 } });
    html = renderToStaticMarkup(createElement(Inspector));
    expect(html).toContain(`data-tread-number="${n}"`);
    appStore.getState().select(null);
    html = renderToStaticMarkup(createElement(Inspector));
    expect(html).toContain('data-template="project"');
    expect(html).not.toContain("tread-inspector");
  });
});

describe("nez d'arrivée (QUESTIONS A28)", () => {
  const inspect = (k: number, locale: "fr" | "en" = "fr"): string => {
    appStore.getState().setLocale(locale);
    appStore.getState().select({ location: { kind: "nosing", index: k } });
    return decode(renderToStaticMarkup(createElement(Inspector)));
  };
  const arrival = (m: Model): number => m.stepping.nosings.length - 1;

  it("gabarit « nez » : bloc « Ligne de nez » seul, sans fiche de marche", () => {
    const m = load(quarter);
    const k = arrival(m);
    const html = inspect(k);
    expect(html).toContain('data-template="nosing"');
    expect(html).toContain(`data-nosing-index="${k}"`);
    expect(html).toContain(`class="insp-eyebrow">Nez ${k} · palier d'arrivée</span>`);
    expect(html).toContain(`<h3 class="insp-title">Nez d'arrivée</h3>`);
    expect(html).toContain("Aucune marche ne porte ce nez");
    // Bloc « Ligne de nez » : angle affiché non modifiable avec son motif (les bords s'arrêtent
    // au nez d'arrivée, question A30), valeur calculée, Fixer, Retirer, aide clavier sans flèches.
    expect(html).toContain("Ligne de nez");
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="0,0"/);
    expect(html).toContain("Angle non modifiable : les bords de l'escalier s'arrêtent");
    expect(html).toContain("data-computed");
    expect(html).toContain("Fixer le nez");
    expect(html).toContain("Retirer la retouche");
    expect(html).toContain("F fixe le nez ; Suppr retire la retouche.");
    expect(html).not.toContain("← / → ±1°");
    // Pas de fiche de marche : ni valeurs, ni contrôles, ni pièces, ni « Marche n ».
    expect(html).not.toContain("data-tread-number");
    expect(html).not.toContain("insp-values");
    expect(html).not.toContain("Giron");
    expect(html).not.toContain(`Marche ${k}<`);
  });

  it("‹ revient à la dernière marche", () => {
    const m = load(quarter);
    const k = arrival(m);
    const prev = /<button[^>]*aria-label="Dernière marche"[^>]*>/.exec(inspect(k));
    expect(prev![0]).not.toContain("disabled");
    expect(lastTreadBefore(m.stepping, k)).toBe(k);
    expect(lastTreadBefore({ treads: [] }, k)).toBeNull();
  });

  it("retouches du nez d'arrivée : pressé, retirable, lien de la liste vers le nez", () => {
    const k = arrival(buildModel(quarter));
    load(withAngleOverride(withFixedOverride(quarter, k, true), k, 2));
    const html = inspect(k);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Fixer le nez/);
    expect(html).toMatch(/class="btn btn-ghost" title="[^"]*">Retirer la retouche/);
    // Entrée de la liste : bouton (nez d'arrivée) marqué courant.
    expect(html).toContain(
      `<li data-nosing="${k}" aria-current="true"><button type="button" class="link nosing-line__entry" title="Nez d'arrivée">`,
    );
    // Depuis une marche, l'entrée du nez d'arrivée est aussi un lien (vers le nez).
    expect(decode(render(1))).toContain(
      `<li data-nosing="${k}"><button type="button" class="link nosing-line__entry" title="Nez d'arrivée">`,
    );
  });

  it("anglais : « Top nosing », aucune clé brute ni texte français", () => {
    const m = load(quarter);
    const k = arrival(m);
    const html = inspect(k, "en");
    expect(html).toContain(`Nosing ${k} · top landing`);
    expect(html).toContain('<h3 class="insp-title">Top nosing</h3>');
    expect(html).toContain('aria-label="Last tread"');
    expect(html).toContain("Nosing line");
    for (const text of ["Nez", "Marche", "Fixer", "Retirer", "palier"]) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toMatch(/\b(ui|compliance|stepping)\.[a-z]+\.[\w.]+/);
  });

  it("légende du guidé : « Nez d'arrivée sélectionné »", () => {
    const m = load(quarter);
    const k = arrival(m);
    const sel = { location: { kind: "nosing", index: k } } as const;
    expect(selectionLegendText(sel, m, translatorFor("fr"))).toBe("Nez d'arrivée sélectionné");
    expect(selectionLegendText(sel, m, translatorFor("en"))).toBe("Top nosing selected");
  });
});
