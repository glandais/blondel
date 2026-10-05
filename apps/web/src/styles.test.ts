/**
 * Jetons de `styles.css` (système Industry, ADR-0009), relus dans la feuille (source unique) :
 *
 * - contraste non textuel (WCAG 2.1, critère 1.4.11) : la limite des champs de saisie et des
 *   boutons atteint 3:1 sur les surfaces où ils sont posés, dans les trois blocs de thème ;
 * - contraste du texte courant (WCAG 1.4.3) : 4,5:1 sur le fond et les panneaux ;
 * - fonds pleins d'accent qui portent du texte sur `--accent-fill` (ADR-0009 point 11) : texte à
 *   4,5:1 au moins dans les trois thèmes, vérifié dans toutes les feuilles de l'application ;
 * - grille du parcours libre (maquette 1b) ;
 * - angles vifs (`--radius: 0`), couleurs fonctionnelles seulement par `palette.css` (`--fn-*`) ;
 * - `main.tsx` charge `palette.css` avant `styles.css`, et aucune ressource externe.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(DIR, "styles.css"), "utf8");
/** Feuille sans commentaires (les commentaires citent volontiers des sélecteurs). */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, "");
const MAIN = readFileSync(join(DIR, "main.tsx"), "utf8");

type Block = Readonly<Record<string, string>>;

/** Déclarations `--nom: valeur` du premier bloc qui suit `selector`. */
function declarations(selector: string): Block {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`bloc introuvable : ${selector}`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const m of CSS.slice(open + 1, close).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out[m[1] as string] = (m[2] as string).trim();
  }
  return out;
}

const ROOT = declarations(":root {");

/**
 * Valeur hexadécimale de `name` dans un thème : déclaration du bloc du thème, sinon de `:root`,
 * en suivant les `var(--x)` (résolus eux aussi dans le thème d'abord, comme le navigateur le fait
 * sur l'élément racine).
 */
function resolve(theme: Block, name: string, seen: readonly string[] = []): string | undefined {
  if (seen.includes(name)) throw new Error(`référence circulaire : ${[...seen, name].join(" → ")}`);
  const value = theme[name] ?? ROOT[name];
  if (value === undefined) return undefined;
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (ref) return resolve(theme, ref[1] as string, [...seen, name]);
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs. */
function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Règle CSS (sélecteur exact en tête de ligne) → corps. */
function rule(selector: string): string {
  const i = CSS.indexOf(`\n${selector} {`);
  if (i < 0) throw new Error(`règle introuvable : ${selector}`);
  return CSS.slice(i, CSS.indexOf("}", i));
}

const DARK_SYSTEM = declarations(':root:not([data-theme="light"])');
const DARK_FORCED = declarations(':root[data-theme="dark"]');

const THEMES: Readonly<Record<string, Block>> = {
  clair: {},
  "sombre (système)": DARK_SYSTEM,
  "sombre (forcé)": DARK_FORCED,
};

function contrast(theme: Block, fg: string, bg: string): number {
  const a = resolve(theme, fg);
  const b = resolve(theme, bg);
  expect(a, fg).toBeDefined();
  expect(b, bg).toBeDefined();
  return contrastRatio(a as string, b as string);
}

describe("lecteur de jetons", () => {
  it("formule de référence", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#d6dade", "#ffffff")).toBeCloseTo(1.41, 2);
  });

  it("suit les var(--x) dans le thème puis dans :root", () => {
    expect(resolve({}, "--bg")).toBe(ROOT["--color-bg"]);
    expect(resolve(DARK_FORCED, "--bg")).toBe(DARK_FORCED["--color-bg"]);
    expect(resolve({}, "--accent")).toBe("#5980a6");
  });
});

describe("contraste des limites de composants (WCAG 1.4.11)", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    it(`thème ${name} : --control-border ≥ 3:1 sur --panel, --panel-2 et --bg`, () => {
      for (const surface of ["--panel", "--panel-2", "--bg"]) {
        expect(contrast(t, "--control-border", surface), surface).toBeGreaterThanOrEqual(3);
      }
    });

    it(`thème ${name} : focus (--focus) ≥ 3:1 sur --panel et --bg`, () => {
      for (const surface of ["--panel", "--bg"]) {
        expect(contrast(t, "--focus", surface), surface).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("boutons, listes et champs de texte ou de date bordés par --control-border", () => {
    expect(rule("button")).toContain("border: 1px solid var(--control-border)");
    expect(rule('select,\ninput[type="text"],\ninput[type="date"]')).toContain(
      "border: 1px solid var(--control-border)",
    );
  });
});

describe("contraste du texte (WCAG 1.4.3)", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    it(`thème ${name} : --text ≥ 4,5:1 sur --bg et --panel ; --muted ≥ 4,5:1 sur --panel`, () => {
      expect(contrast(t, "--text", "--bg")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t, "--text", "--panel")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t, "--muted", "--panel")).toBeGreaterThanOrEqual(4.5);
    });

    it(`thème ${name} : texte en accent (--accent-ink) ≥ 4,5:1 sur --bg et --panel`, () => {
      expect(contrast(t, "--accent-ink", "--bg")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t, "--accent-ink", "--panel")).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("le texte en accent passe par --accent-ink, jamais par --accent", () => {
    expect(CSS).not.toMatch(/(?:^|[^-])color:\s*var\(--accent\)/m);
  });
});

/** Feuilles `.css` de l'application (toutes tâches confondues), sans commentaires. */
function sheets(dir: string): { file: string; css: string }[] {
  const out: { file: string; css: string }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sheets(p));
    else if (e.name.endsWith(".css")) {
      out.push({
        file: relative(DIR, p),
        css: readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
      });
    }
  }
  return out;
}

/** Règles feuilles (sélecteur → corps) d'une feuille ; les blocs `@media` sont traversés. */
function rules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] as string).trim(),
    body: m[2] as string,
  }));
}

describe("contraste des fonds pleins d'accent (ADR-0009 point 11)", () => {
  it("--accent-fill : pas 700 de la ramp (#416180 en clair, #b5d9fd en sombre)", () => {
    expect(resolve({}, "--accent-fill")).toBe("#416180");
    expect(resolve(DARK_SYSTEM, "--accent-fill")).toBe("#b5d9fd");
    expect(resolve(DARK_FORCED, "--accent-fill")).toBe("#b5d9fd");
  });

  for (const [name, t] of Object.entries(THEMES)) {
    it(`thème ${name} : --accent-text ≥ 4,5:1 sur --accent-fill, son survol et son appui`, () => {
      for (const fill of ["--accent-fill", "--accent-fill-hover", "--accent-fill-pressed"]) {
        expect(contrast(t, "--accent-text", fill), fill).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("l'accent Industry seul ne porterait pas de texte (contre-épreuve)", () => {
    expect(contrast({}, "--accent-text", "--accent")).toBeLessThan(4.5);
  });

  const all = sheets(DIR);

  it("parcourt toutes les feuilles de l'application", () => {
    const files = all.map((s) => s.file);
    expect(files).toContain("styles.css");
    expect(files.length).toBeGreaterThan(5);
  });

  it("aucun fond plein en accent Industry (var(--accent) / var(--color-accent))", () => {
    const bad = all.flatMap(({ file, css }) =>
      rules(css)
        .filter((r) => /background(?:-color)?:\s*var\(--(?:color-)?accent\)/.test(r.body))
        .map((r) => `${file} : ${r.selector}`),
    );
    expect(bad).toEqual([]);
  });

  it("tout texte en --accent-text est posé sur un fond --accent-fill…", () => {
    const bad = all.flatMap(({ file, css }) =>
      rules(css)
        .filter((r) => /(?:^|[;\s])color:\s*var\(--accent-text\)/.test(r.body))
        .filter((r) => !/background(?:-color)?:\s*var\(--accent-fill[\w-]*\)/.test(r.body))
        .map((r) => `${file} : ${r.selector}`),
    );
    expect(bad).toEqual([]);
  });

  it("bouton primaire et option active d'un segmenté sur --accent-fill", () => {
    expect(rule(".btn-primary,\n.btn-primary.blueprint")).toContain(
      "background: var(--accent-fill);",
    );
    expect(
      rule(
        '.seg .seg-opt:is([aria-checked="true"], [aria-selected="true"], [aria-pressed="true"])',
      ),
    ).toContain("background: var(--accent-fill);");
  });
});

describe("mise en page du parcours libre (maquette 1b)", () => {
  it("colonnes : rail 76, panneau 330, inspecteur 340 ; vue en minmax(0, 1fr)", () => {
    expect(rule(".app")).toContain("grid-template-columns: 76px minmax(0, 1fr) 340px;");
    expect(rule('.app[data-panel="open"]')).toContain(
      "grid-template-columns: 76px 330px minmax(0, 1fr) 340px;",
    );
    expect(rule('.app[data-workspace="fabrication"]')).toContain(
      "grid-template-columns: minmax(0, 1fr) 340px;",
    );
  });

  it("zones placées par styles.css", () => {
    for (const [cls, area] of [
      ["topbar", "topbar"],
      ["rail", "rail"],
      ["free-panel", "panel"],
      ["workarea", "work"],
      ["inspector", "inspector"],
    ]) {
      expect(rule(`.app > .${cls}`)).toContain(`grid-area: ${area};`);
    }
  });

  it("anciennes règles retirées (barre d'outils, colonnes, barre d'état, onglets)", () => {
    for (const dead of [".toolbar", ".statusbar", ".tabs", ".left", ".right", ".center {"]) {
      expect(CSS, dead).not.toContain(dead);
    }
  });
});

describe("jetons Industry", () => {
  it("angles vifs : --radius vaut 0", () => {
    expect(ROOT["--radius"]).toBe("0");
  });

  it("jetons de couleur, de police, d'espacement et d'ombre présents", () => {
    for (const name of [
      "--color-bg",
      "--color-surface",
      "--color-text",
      "--color-accent",
      "--color-divider",
      "--font-heading",
      "--font-body",
      "--space-1",
      "--space-2",
      "--space-3",
      "--space-4",
      "--space-6",
      "--space-8",
      "--shadow-sm",
      "--shadow-md",
      "--shadow-lg",
    ]) {
      expect(ROOT[name], name).toBeDefined();
    }
    for (const ramp of ["accent", "neutral"]) {
      for (let step = 100; step <= 900; step += 100) {
        expect(resolve({}, `--color-${ramp}-${step}`), `${ramp}-${step}`).toBeDefined();
      }
    }
  });

  it("anciens noms de l'application définis et rattachés aux jetons", () => {
    for (const name of [
      "--bg",
      "--panel",
      "--panel-2",
      "--text",
      "--muted",
      "--border",
      "--control-border",
      "--accent",
      "--accent-text",
      "--focus",
      "--font",
      "--mono",
      "--gap",
    ]) {
      expect(ROOT[name], name).toBeDefined();
    }
    expect(ROOT["--font"]).toBe("var(--font-body)");
    expect(ROOT["--border"]).toBe("var(--color-divider)");
  });

  it("les deux blocs du thème sombre sont identiques", () => {
    expect(DARK_SYSTEM).toEqual(DARK_FORCED);
    expect(Object.keys(DARK_SYSTEM).length).toBeGreaterThan(10);
  });
});

describe("couleurs fonctionnelles : seulement par palette.css", () => {
  it("aucune valeur hexadécimale fonctionnelle dans styles.css", () => {
    for (const hex of [
      "#ff7a1a",
      "#ff9a4d",
      "#b3261e",
      "#9a6200",
      "#2f6fb3",
      "#2e7d32",
      "#f28b82",
      "#f0b85a",
      "#8fbdf0",
      "#81c995",
      "#6e40c9",
      "#a58cf0",
    ]) {
      expect(RAW.toLowerCase(), hex).not.toContain(hex);
    }
    expect(RAW).not.toMatch(/rgba?\(\s*255\s*,?\s*122\s*,?\s*26/);
  });

  it("alias déclarés une seule fois, dans :root, sur les --fn-*", () => {
    const aliases: Record<string, string> = {
      "--selected": "var(--fn-selection)",
      "--selected-fill": "color-mix(in srgb, var(--fn-selection) 40%, transparent)",
      "--danger": "var(--fn-blocking)",
      "--sev-bloquant": "var(--fn-blocking)",
      "--warn": "var(--fn-warning)",
      "--sev-avertissement": "var(--fn-warning)",
      "--info": "var(--fn-advice)",
      "--sev-conseil": "var(--fn-advice)",
      "--ok": "var(--fn-ok)",
      "--opening": "var(--fn-opening)",
    };
    for (const [name, value] of Object.entries(aliases)) {
      expect(ROOT[name], name).toBe(value);
      expect(DARK_SYSTEM[name], name).toBeUndefined();
      expect(DARK_FORCED[name], name).toBeUndefined();
      expect(CSS.split(`${name}:`).length - 1, name).toBe(1);
    }
  });
});

describe("main.tsx : feuilles et polices", () => {
  const imports = [...MAIN.matchAll(/^import\s+(?:[^"]*?from\s+)?"([^"]+)";/gm)].map(
    (m) => m[1] as string,
  );

  it("palette.css avant styles.css", () => {
    const palette = imports.indexOf("./palette.css");
    const styles = imports.indexOf("./styles.css");
    expect(palette).toBeGreaterThanOrEqual(0);
    expect(styles).toBeGreaterThan(palette);
  });

  it("polices embarquées (@fontsource), avant les feuilles de l'application", () => {
    const fonts = imports.filter((s) => s.startsWith("@fontsource/"));
    expect(fonts.length).toBeGreaterThanOrEqual(5);
    for (const family of ["@fontsource/barlow/", "@fontsource/barlow-condensed/"]) {
      expect(
        fonts.some((s) => s.startsWith(family)),
        family,
      ).toBe(true);
    }
    const lastFont = Math.max(...fonts.map((s) => imports.indexOf(s)));
    expect(lastFont).toBeLessThan(imports.indexOf("./palette.css"));
  });

  it("aucune ressource externe", () => {
    expect(MAIN).not.toMatch(/https?:\/\//);
    expect(RAW).not.toMatch(/@import|https?:\/\//);
  });
});
