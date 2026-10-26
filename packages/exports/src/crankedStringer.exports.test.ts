/**
 * Limon coudé des profilés (`stringerLine` = `nosing`, chantier bent-stringer, sous-lots K2b et
 * K2c) : j3c traverse tous les exports sans exception ni grandeur non finie (SVG, DXF R12 /
 * AC1021, CSV, glTF, ZIP, PDF), en français et en anglais. K2c (CK8, contrat A33) : la pièce
 * finie (solide balayé) n'a pas de développé, ses tronçons LE2-1… en ont un chacun ; aucune pièce
 * n'est sortie deux fois dans le DXF ni dans le PDF, les textes anglais propres au limon coudé ne
 * gardent ni clé brute ni français, le solide balayé atteint l'onglet aux coins en plan. K2e
 * (K-Q4) : sur le demi-tournant du préréglage, une cornière retirée au coin du mur est absente de
 * la liste de débit, des développés et des pages du PDF, et sa remarque est traduite.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RULES,
  SteelProfileParamsSchema,
  applyStructureChoice,
  buildModel,
  buildSteelProfile,
  createProject,
  fabricatedParts,
  parseProjectText,
  type Project,
} from "@blondel/core";
import { meshSolid } from "@blondel/geometry";
import { createTranslator } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { cutListRows, exportCutListCsv } from "./csv/cutlist.js";
import { exportPartDxf } from "./dxf/part.js";
import { exportPartsDxf } from "./dxf/parts.js";
import { exportPlanDxf } from "./dxf/plan.js";
import { flatPartGroups } from "./flatGroups.js";
import { exportGlb } from "./gltf/glb.js";
import { RecordingCanvas, helveticaMeasure } from "./pdf/canvas.js";
import { exportPdfDocument, renderPdf } from "./pdf/document.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderFlatPatternSvg } from "./svg/flat.js";
import { renderPlanSvg } from "./svg/plan.js";
import { readDxf } from "./testing/dxf-reader.js";
import { residualFrench } from "./testing/french.js";
import { readGlb } from "./testing/glb-reader.js";
import { parseXml } from "./testing/xml.js";
import { createZip } from "./zip.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const NON_FINITE = /NaN|Infinity/;

function j3cNosing(): Project {
  const p = parseProjectText(
    readFileSync(join(EXAMPLES_DIR, "j3c-acceptance-01-upn.blondel.json"), "utf8"),
  );
  return {
    ...p,
    stair: {
      ...p.stair,
      structure: {
        ...p.stair.structure,
        params: { ...p.stair.structure.params, stringerLine: "nosing" },
      },
    },
  };
}

describe("limon coudé (K2b, K2c) — exports de j3c en `nosing`", () => {
  const project = j3cNosing();
  const model = buildModel(project);
  const stringers = model.parts.filter((p) => p.category === "stringer");
  const finished = stringers.filter((p) => p.componentOf === undefined);
  const segments = stringers.filter((p) => p.componentOf !== undefined);
  const finishedIds = new Set(finished.map((p) => p.id));

  it("pièces finies balayées sans développé, 13 tronçons à développé et coupes de jarret", () => {
    expect(model.errors).toEqual([]);
    expect(finished).toHaveLength(4);
    for (const s of finished) {
      expect(s.solid.kind).toBe("sweep");
      expect(s.flat).toBeUndefined();
    }
    expect(segments).toHaveLength(13);
    for (const s of segments) {
      expect(finishedIds.has(s.componentOf!)).toBe(true);
      expect(s.flat).toBeDefined();
    }
    const keys = segments.flatMap((s) => s.flat!.lines.map((l) => l.label?.key));
    expect(keys.filter((k) => k === "structure.steelProfile.joint.knee")).toHaveLength(9);
    expect(keys.filter((k) => k === "structure.steelProfile.joint.kneeWelded")).toHaveLength(9);
  });

  it("SVG, DXF (plan et pièces, R12 et AC1021), CSV, glTF, ZIP et PDF sans exception, en français et en anglais", () => {
    for (const locale of ["fr", "en"] as const) {
      const opts = { project, theme: "light" as const, title: project.name, locale };
      for (const svg of [renderPlanSvg(model, opts), renderElevationSvg(model, opts)]) {
        parseXml(svg);
        expect(svg).not.toMatch(NON_FINITE);
      }
      for (const s of segments) {
        const svg = renderFlatPatternSvg(s, { locale });
        parseXml(svg);
        expect(svg).not.toMatch(NON_FINITE);
      }
      expect(exportCutListCsv(model, { locale })).not.toMatch(NON_FINITE);
    }
    for (const version of ["R12", "AC1021"] as const) {
      const plan = exportPlanDxf(model, { project, version });
      expect(plan).not.toMatch(NON_FINITE);
      for (const s of segments) {
        const dxf = exportPartDxf(s, { version });
        expect(dxf, s.id).not.toMatch(NON_FINITE);
        expect(readDxf(dxf).entities.length, s.id).toBeGreaterThan(0);
      }
      for (const s of finished) expect(() => exportPartDxf(s, { version })).toThrow(RangeError);
    }
    const files = exportPartsDxf(model);
    const zip = createZip(files.map((f) => ({ name: f.filename, data: f.content })));
    expect(String.fromCharCode(zip[0]!, zip[1]!)).toBe("PK");
    // glTF : seules les pièces finies sont dessinées (les tronçons ne le sont pas).
    const glb = readGlb(exportGlb(model, { project }));
    const root = glb.doc.nodes[glb.doc.scenes[0]!.nodes[0]!]!;
    for (const ni of root.children!) expect(glb.doc.nodes[ni]!.mesh).toBeDefined();
    const names = JSON.stringify(glb.doc.nodes.map((n) => n.name ?? ""));
    for (const s of segments) expect(names).not.toContain(`"${s.mark}`);
    for (const locale of ["fr", "en"] as const) {
      const { bytes } = exportPdfDocument(model, {
        project,
        date: "25/10/2026",
        compress: false,
        locale,
      });
      const text = new TextDecoder("latin1").decode(bytes);
      expect(text.startsWith("%PDF-")).toBe(true);
      expect(text).not.toMatch(NON_FINITE);
    }
  });

  it("aucune pièce sortie deux fois : DXF des pièces, pages du PDF, liste de débit", () => {
    const groups = flatPartGroups(model.parts);
    const seen = new Map<string, number>();
    for (const g of groups) for (const id of g.ids) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const [id, n] of seen) expect(n, id).toBe(1);
    for (const id of finishedIds) expect(seen.has(id)).toBe(false);
    for (const s of segments) expect(seen.get(s.id)).toBe(1);
    expect(exportPartsDxf(model)).toHaveLength(groups.length);
    const { pages } = exportPdfDocument(model, { project, date: "25/10/2026", compress: false });
    const flatIds = pages.filter((p) => p.kind === "flat").flatMap((p) => p.partIds ?? []);
    expect(new Set(flatIds).size).toBe(flatIds.length);
    const templateIds = pages.filter((p) => p.kind === "template").flatMap((p) => p.partIds ?? []);
    for (const id of [...flatIds, ...templateIds]) expect(finishedIds.has(id)).toBe(false);
    for (const s of segments) expect(flatIds).toContain(s.id);
    // Liste de débit : les tronçons, jamais la pièce finie.
    const rows = cutListRows(model.parts);
    const marks = new Set(rows.map((r) => r.mark));
    for (const s of finished) expect(marks.has(s.mark)).toBe(false);
    for (const s of segments) expect(marks.has(s.mark)).toBe(true);
    expect(fabricatedParts(model.parts).some((p) => finishedIds.has(p.id))).toBe(false);
  });

  it("anglais : remarques, noms, références, coupes et textes des tronçons sans clé brute ni français", () => {
    const en = createTranslator("en");
    const notes = (model.notes ?? []).filter((n) => /cranked|jig/i.test(String(n.key)));
    expect(notes.length).toBeGreaterThanOrEqual(8);
    const texts = [
      ...notes.map((n) => en.t(n)),
      ...stringers.map((s) => en.t(s.name)),
      ...segments.map((s) => en.t(s.flat!.reference!.description!)),
      ...segments.flatMap((s) =>
        s.flat!.lines.filter((l) => l.label !== undefined).map((l) => en.t(l.label!)),
      ),
    ];
    expect(texts.length).toBeGreaterThan(40);
    for (const t of texts) expect(t).not.toMatch(/structure\.|\{|NaN|Infinity/);
    expect(residualFrench(texts)).toEqual([]);
  });

  it("fichiers anglais (CSV, SVG, DXF des pièces et du plan, PDF) : aucun texte français", () => {
    const verbatim = [project.name, ...project.site.walls.map((w) => w.id)];
    const svgTexts = (svg: string): string[] =>
      [...svg.matchAll(/<(text|tspan|title|desc)[^>]*>([^<]+)</g)].map((m) =>
        m[2]!.replace(/&apos;/g, "'").replace(/&amp;/g, "&"),
      );
    // DXF : textes du groupe 1 (TEXT / MTEXT).
    const dxfTexts = (dxf: string): string[] => {
      const l = dxf.split(/\r?\n/);
      const out: string[] = [];
      for (let i = 0; i < l.length - 1; i++) if (l[i]!.trim() === "1") out.push(l[i + 1]!);
      return out;
    };
    const opts = { project, theme: "light" as const, title: project.name, locale: "en" as const };
    const texts = [
      ...exportCutListCsv(model, { locale: "en" }).split(/\r?\n/),
      ...svgTexts(renderPlanSvg(model, opts)),
      ...svgTexts(renderElevationSvg(model, opts)),
      ...segments.flatMap((s) => svgTexts(renderFlatPatternSvg(s, { locale: "en" }))),
      ...segments.flatMap((s) => dxfTexts(exportPartDxf(s, { locale: "en", version: "AC1021" }))),
      ...dxfTexts(exportPlanDxf(model, { project, version: "R12", locale: "en" })),
    ];
    expect(texts.length).toBeGreaterThan(500);
    expect(residualFrench(texts, verbatim)).toEqual([]);
    // PDF : identifiants de règles et sources citées repris tels quels (comme `pdf/locale.test`).
    const c = new RecordingCanvas(297, 210, helveticaMeasure());
    renderPdf(c, model, { project, date: "25/10/2026", locale: "en" });
    const idents = [...RULES.map((r) => r.id), ...model.compliance.results.map((r) => r.ruleId)];
    const pdf = c.pageTexts().flat();
    expect(residualFrench(pdf, [...verbatim, ...idents], { citedSources: true })).toEqual([]);
  });

  it("PDF : page de chaque tronçon avec sa position dans le gabarit, en français et en anglais", () => {
    for (const locale of ["fr", "en"] as const) {
      const t = createTranslator(locale);
      const c = new RecordingCanvas(297, 210, helveticaMeasure());
      const pages = renderPdf(c, model, { project, date: "25/10/2026", locale });
      const texts = c.pageTexts();
      const jig = locale === "fr" ? /Gabarit : de \S+ à \S+ mm/ : /Jig: from \S+ to \S+ mm/;
      for (const s of segments) {
        const ref = t.t(s.flat!.reference!.description!);
        const expected = jig.exec(ref)?.[0];
        expect(expected, s.mark).toBeDefined();
        const i = pages.findIndex((pg) => pg.kind === "flat" && pg.partIds?.includes(s.id));
        expect(i, s.mark).toBeGreaterThanOrEqual(0);
        const page = texts[i]!.join(" ").replace(/\s+/g, " ");
        expect(page, s.mark).toContain(expected!);
      }
    }
  });

  it("masse de débit des tronçons contre la masse nette du solide fini : recouvrements seuls", () => {
    // Référence indépendante : volume du maillage du balayage (masse nette = ρ × volume). La
    // masse de débit (encombrements axiaux, recouvrements des coupes de jarret et d'onglet
    // compris) s'en écarte de −0,1 % (LI1 : balayage sous le sol, débit coupé au sol) à +2,5 %
    // (LE1, onglet) : même convention de masse brute que la barre droite.
    const params = SteelProfileParamsSchema.parse(project.stair.structure.params);
    const r = buildSteelProfile(
      { project, layout: model.layout, stepping: model.stepping },
      params,
    );
    const area = r.section!.area;
    let checked = 0;
    for (const x of r.stringers) {
      if (x.part.solid.kind !== "sweep" || !x.components) continue;
      const mesh = meshSolid(x.part.solid);
      let vol = 0;
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const p = (k: number) => {
          const j = mesh.indices[i + k]! * 3;
          return [mesh.positions[j]!, mesh.positions[j + 1]!, mesh.positions[j + 2]!] as const;
        };
        const [a, b, c] = [p(0), p(1), p(2)];
        vol +=
          (a[0] * (b[1] * c[2] - b[2] * c[1]) -
            a[1] * (b[0] * c[2] - b[2] * c[0]) +
            a[2] * (b[0] * c[1] - b[1] * c[0])) /
          6;
      }
      const debit = x.components.reduce((acc, q) => acc + q.stock!.length, 0) * area;
      const ratio = debit / Math.abs(vol);
      expect(ratio, x.face.mark).toBeGreaterThan(0.995);
      expect(ratio, x.face.mark).toBeLessThan(1.03);
      checked++;
    }
    expect(checked).toBe(4);
  });

  it("solide balayé : prolongé jusqu'à l'onglet aux coins, profondeur [0 ; b], z ⊇ contour, volume ± 5 %", () => {
    const params = SteelProfileParamsSchema.parse(project.stair.structure.params);
    const r = buildSteelProfile(
      { project, layout: model.layout, stepping: model.stepping },
      params,
    );
    const s = r.section!;
    expect(s.shape).toBe("U");
    for (const x of r.stringers) {
      if (x.part.solid.kind !== "sweep") continue;
      const f = x.face;
      const mesh = meshSolid(x.part.solid);
      const o = mesh.origin ?? { x: 0, y: 0, z: 0 };
      let u0 = Infinity;
      let u1 = -Infinity;
      let d0 = Infinity;
      let d1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const px = mesh.positions[i]! + o.x - f.a.x;
        const py = mesh.positions[i + 1]! + o.y - f.a.y;
        const z = mesh.positions[i + 2]! + o.z;
        const u = px * f.dir.x + py * f.dir.y;
        const d = px * f.into.x + py * f.into.y;
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        d0 = Math.min(d0, d);
        d1 = Math.max(d1, d);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      // Angle mural en volées (UPN, shift = 0) : onglet à 45°, allongement b en plan.
      if (f.start === "corner") expect(Math.abs(u0 - (x.uLo - s.b)), f.mark).toBeLessThan(0.5);
      if (f.end === "corner") expect(Math.abs(u1 - (x.uHi + s.b)), f.mark).toBeLessThan(0.5);
      expect(d0, f.mark).toBeGreaterThan(-1e-3);
      expect(Math.abs(d1 - s.b), f.mark).toBeLessThan(1e-3);
      const zs = x.outline.map((q) => q.y);
      expect(z0).toBeLessThanOrEqual(Math.min(...zs) + 1e-3);
      expect(z1).toBeGreaterThanOrEqual(Math.max(...zs) - 1e-3);
      const path = x.part.solid.path;
      let len = 0;
      for (let i = 1; i < path.length; i++) {
        len += Math.hypot(
          path[i]!.x - path[i - 1]!.x,
          path[i]!.y - path[i - 1]!.y,
          path[i]!.z - path[i - 1]!.z,
        );
      }
      let vol = 0;
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const p = (k: number) => {
          const j = mesh.indices[i + k]! * 3;
          return [mesh.positions[j]!, mesh.positions[j + 1]!, mesh.positions[j + 2]!] as const;
        };
        const [a, b, c] = [p(0), p(1), p(2)];
        vol +=
          (a[0] * (b[1] * c[2] - b[2] * c[1]) -
            a[1] * (b[0] * c[2] - b[2] * c[0]) +
            a[2] * (b[0] * c[1] - b[1] * c[0])) /
          6;
      }
      const ratio = Math.abs(vol) / (s.area * len);
      expect(ratio, f.mark).toBeGreaterThan(0.95);
      expect(ratio, f.mark).toBeLessThan(1.05);
    }
  });
});

describe("limon coudé (K2e, K-Q4) — cornière retirée au coin du mur, demi-tournant (préréglage) en `nosing`", () => {
  const project = applyStructureChoice(createProject("half-turn"), "steel-profile", {
    family: "UPN",
    stringerLine: "nosing",
  }).project;
  const model = buildModel(project);
  const params = SteelProfileParamsSchema.parse(project.stair.structure.params);
  const r = buildSteelProfile({ project, layout: model.layout, stepping: model.stepping }, params);
  const removed = r.cornerAngles!.removed;
  /** Pièces à développé (tronçons, ou pièce autonome) d'un limon. */
  const flatsOf = (faceId: string) =>
    model.parts.filter(
      (p) => p.flat !== undefined && (p.id === faceId || p.componentOf === faceId),
    );

  it("sans erreur, deux cornières retirées (M5 sur LE2, M8 sur LE3)", () => {
    expect(model.errors).toEqual([]);
    expect(removed.map((x) => `${x.treadMark}/${x.faceMark}`)).toEqual(["M5/LE2", "M8/LE3"]);
  });

  it("liste de débit : autant de cornières que de supports posés", () => {
    const n = cutListRows(model.parts)
      .filter((row) => row.category === "support")
      .reduce((a, row) => a + row.quantity, 0);
    expect(n).toBe(r.supports.length);
    const csv = exportCutListCsv(model);
    expect(csv).not.toMatch(NON_FINITE);
  });

  it("développés (SVG) et pages du PDF du limon : aucun traçage de la cornière retirée", () => {
    const c = new RecordingCanvas(297, 210, helveticaMeasure());
    const pages = renderPdf(c, model, { project, date: "26/10/2026", locale: "fr" });
    const texts = c.pageTexts();
    for (const x of removed) {
      const label = `Support ${x.treadMark}`;
      const flats = flatsOf(x.faceId);
      expect(flats.length).toBeGreaterThan(0);
      // Contrôle positif : les autres cornières du même limon restent tracées (le test d'absence
      // ne passe pas à vide si les libellés de support disparaissaient tous).
      const svgAll: string[] = [];
      const pdfAll: string[] = [];
      for (const p of flats) {
        const svg = renderFlatPatternSvg(p, { locale: "fr" });
        expect(svg, p.mark).not.toContain(label);
        const i = pages.findIndex((pg) => pg.kind === "flat" && pg.partIds?.includes(p.id));
        expect(i, p.mark).toBeGreaterThanOrEqual(0);
        expect(texts[i]!.join(" "), p.mark).not.toContain(label);
        svgAll.push(svg);
        pdfAll.push(texts[i]!.join(" "));
      }
      expect(svgAll.join(" "), x.faceMark).toMatch(/Support M\d+/);
      expect(pdfAll.join(" "), x.faceMark).toMatch(/Support M\d+/);
    }
  });

  it("remarque traduite en anglais sans clé brute ni français résiduel", () => {
    const en = createTranslator("en");
    const notes = (model.notes ?? []).filter(
      (n) => n.key === "structure.steelProfile.note.cornerAngleRemoved",
    );
    expect(notes).toHaveLength(2);
    const texts = notes.map((n) => en.t(n));
    for (const t of texts) expect(t).not.toMatch(/structure\.|\{|NaN|Infinity/);
    expect(residualFrench(texts)).toEqual([]);
  });
});
