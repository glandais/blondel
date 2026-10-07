import { translatorFor } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import type { Part, PartFixing } from "../model/derived.js";
import { FASTENER_JOINTS, fastenerLines } from "../model/fasteners.js";
import type { Vec2 } from "../model/primitives.js";
import type { Wall } from "../model/project.js";
import type { GuardsAnalysis, HandrailRun, SideAnalysis } from "../guards/types.js";
import { holePolygon } from "../structures/steelCommon.js";
import { DEFAULT_FASTENER_PROFILE, resolveFastenerProfile } from "../workshop/fasteners.js";
import { computeFasteners, holeDiameterOf, nominalDiameterFor } from "./compute.js";

const EN = translatorFor("en");
const profile = DEFAULT_FASTENER_PROFILE;
const vertical = { x: 0, y: 0, z: 1 };
const horizontal = { x: 1, y: 0, z: 0 };

/** Pièce minimale (solide extrudé de normale `zAxis`). */
function part(
  over: Partial<Part> & Pick<Part, "id" | "mark" | "category">,
  zAxis = vertical,
): Part {
  return {
    name: { key: "part.wallHandrail.name" },
    material: "steel-raw",
    solid: {
      kind: "extrusion",
      frame: {
        origin: { x: 0, y: 0, z: 0 },
        xAxis: { x: 0, y: 1, z: 0 },
        yAxis: { x: 0, y: 0, z: 1 },
        zAxis,
      },
      profile: { outer: [], holes: [] },
      depth: 10,
    },
    quantities: {},
    ...over,
  };
}

/** Platine percée de `n` trous de diamètre `d`. */
function plate(
  id: string,
  mark: string,
  n: number,
  d: number,
  zAxis = vertical,
  assembledWith?: string[],
): Part {
  const holes: Vec2[][] = Array.from({ length: n }, (_, i) =>
    holePolygon({ x: 30 + 50 * i, y: 30 }, d),
  );
  return part(
    {
      id,
      mark,
      category: "fixing",
      flat: { outline: { outer: [], holes }, lines: [], thickness: 10 },
      ...(assembledWith ? { assembledWith } : {}),
    },
    zAxis,
  );
}

describe("holeDiameterOf", () => {
  it("cercle : diamètre ; lumière oblongue : largeur", () => {
    expect(holeDiameterOf(holePolygon({ x: 5, y: 7 }, 13))).toBeCloseTo(13, 9);
    expect(holeDiameterOf(holePolygon({ x: 0, y: 0 }, 11, 30, { x: 1, y: 1 }))).toBeCloseTo(11, 9);
  });
});

describe("computeFasteners — platines", () => {
  it("platine de pied : perçage 13 mm, jeu 1 mm → M12, quantité = perçages × perPoint", () => {
    const out = computeFasteners({ parts: [plate("pf", "PF1", 2, 13)], walls: [], profile });
    expect(out).toHaveLength(1);
    const f = out[0]!;
    expect(f).toMatchObject({
      id: "fastener-plateFloor-pf",
      mark: "VS1",
      kind: "anchor",
      grade: "zinc-plated",
      diameter: 12,
      length: 100,
      quantity: 2,
      joint: "plateFloor",
      partIds: ["pf"],
      deduced: ["diameter", "quantity"],
    });
    expect(fr(f.name)).toBe("Cheville mécanique M12 × 100, acier zingué");
    expect(fr(f.origin)).toBe("Platine PF1 → sol");
    expect(EN.t(f.name)).toBe("Expansion anchor M12 × 100, zinc-plated steel");
    expect(EN.t(f.origin)).toBe("Plate PF1 → floor");
  });

  it("platine verticale : chevêtre ; platine entre deux pièces : boulonnée", () => {
    const parts = [
      part({ id: "s", mark: "LI1", category: "stringer" }),
      part({ id: "p", mark: "P1", category: "post" }),
      plate("ph", "PH1", 2, 13, horizontal, ["s"]),
      plate("pa", "PA1", 4, 13, horizontal, ["s", "p"]),
    ];
    const out = computeFasteners({ parts, walls: [], profile });
    expect(out.map((f) => f.joint)).toEqual(["plateTrimmer", "plateBolted"]);
    expect(out[0]!.partIds).toEqual(["ph"]);
    expect(fr(out[0]!.origin)).toBe("Platine PH1 → chevêtre");
    const bolted = out[1]!;
    expect(bolted.partIds).toEqual(["s", "p", "pa"]);
    expect(bolted.quantity).toBe(4);
    expect(fr(bolted.name)).toBe("Boulon M12 × 100, classe 8.8");
    expect(fr(bolted.origin)).toBe("Platine PA1 → LI1, P1");
    // Désignations différentes : repères différents.
    expect(out.map((f) => f.mark)).toEqual(["VS1", "VS2"]);
  });

  it("pièce sans perçage ni fixation : aucune visserie", () => {
    const parts = [
      plate("x", "PL", 0, 13),
      part({ id: "s", mark: "LI1", category: "stringer" }),
      part({ id: "t", mark: "M1", category: "tread", material: "wood-oak" }),
    ];
    expect(computeFasteners({ parts, walls: [], profile })).toEqual([]);
  });

  it("repères identiques pour des désignations identiques", () => {
    const parts = [plate("a", "PF1", 2, 13), plate("b", "PF2", 2, 13), plate("c", "PP1", 4, 13)];
    const out = computeFasteners({ parts, walls: [], profile });
    expect(out.map((f) => f.mark)).toEqual(["VS1", "VS1", "VS1"]);
    const lines = fastenerLines(out);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(8);
  });

  it("réglage du projet : surcharge d'un champ, jeu de perçage", () => {
    const p = resolveFastenerProfile({
      holeClearance: 2,
      joints: { plateFloor: { kind: "chemical-anchor", length: 120, perPoint: 2 } },
    });
    const [f] = computeFasteners({ parts: [plate("pf", "PF1", 2, 13)], walls: [], profile: p });
    expect(f).toMatchObject({
      kind: "chemical-anchor",
      grade: "zinc-plated",
      // Jeu minimal 2 mm : M12 (12 + 2 > 13) ne passe plus, M10 si.
      diameter: 10,
      length: 120,
      quantity: 4,
    });
  });

  it("diamètre nominal : plus grand diamètre de la série qui passe avec le jeu (14 → M12, 18 → M16)", () => {
    const series = DEFAULT_FASTENER_PROFILE.nominalDiameters;
    expect(nominalDiameterFor(11, series, 1)).toBe(10);
    expect(nominalDiameterFor(13, series, 1)).toBe(12);
    expect(nominalDiameterFor(14, series, 1)).toBe(12);
    expect(nominalDiameterFor(18, series, 1)).toBe(16);
    expect(nominalDiameterFor(22, series, 1)).toBe(20);
    expect(nominalDiameterFor(2, series, 1)).toBeNaN();
    expect(nominalDiameterFor(13, [], 1)).toBeNaN();
    const out = computeFasteners({
      parts: [plate("a", "PF1", 2, 18), plate("b", "PF2", 2, 14)],
      walls: [],
      profile,
    });
    expect(out.map((f) => [f.diameter, f.deduced.includes("diameter")])).toEqual([
      [16, true],
      [12, true],
    ]);
    expect(fr(out[0]!.name)).toBe("Cheville mécanique M16 × 100, acier zingué");
    // Série du profil : désignations limitées à la série (ici M6 et M10).
    const p = resolveFastenerProfile({ nominalDiameters: [10, 6] });
    expect(p.nominalDiameters).toEqual([6, 10]);
    const [f] = computeFasteners({ parts: [plate("a", "PF1", 2, 18)], walls: [], profile: p });
    expect(f!.diameter).toBe(10);
  });

  it("jeu trop grand : diamètre du profil, non déduit", () => {
    const p = resolveFastenerProfile({ holeClearance: 20 });
    const [f] = computeFasteners({ parts: [plate("pf", "PF1", 2, 13)], walls: [], profile: p });
    expect(f!.diameter).toBe(DEFAULT_FASTENER_PROFILE.joints.plateFloor.diameter);
    expect(f!.deduced).toEqual(["quantity"]);
  });
});

describe("computeFasteners — fixations déclarées", () => {
  const supportFixings: PartFixing[] = [
    { joint: "supportBolted", points: 2, holeDiameter: 11, with: ["s"] },
    { joint: "treadScrewed", points: 2 },
  ];
  const parts = (treadMaterial: Part["material"]): Part[] => [
    part({
      id: "t",
      mark: "M1",
      category: "tread",
      material: treadMaterial,
      assembledWith: ["sup"],
    }),
    part({ id: "s", mark: "LI1", category: "stringer", assembledWith: ["sup"] }),
    part({
      id: "sup",
      mark: "CR1",
      category: "support",
      assembledWith: ["t", "s"],
      fixings: supportFixings,
    }),
  ];

  it("support boulonné sous une marche bois : boulons M10 et vis de la marche", () => {
    const out = computeFasteners({ parts: parts("wood-oak"), walls: [], profile });
    expect(out.map((f) => f.joint)).toEqual(["supportBolted", "treadScrewed"]);
    const [bolt, screw] = out;
    expect(bolt).toMatchObject({ kind: "bolt", diameter: 10, quantity: 2, partIds: ["s", "sup"] });
    expect(fr(bolt!.origin)).toBe("Support CR1 → LI1");
    expect(screw).toMatchObject({
      kind: "wood-screw",
      diameter: 6,
      quantity: 2,
      partIds: ["t", "sup"],
      deduced: ["quantity"],
    });
    expect(fr(screw!.name)).toBe("Vis à bois Ø6 × 30, acier zingué");
    expect(fr(screw!.origin)).toBe("Marche M1 → support CR1");
  });

  it("vis à bois déclarées sous une marche en tôle : aucun élément (matériau inattendu)", () => {
    const out = computeFasteners({ parts: parts("steel-raw"), walls: [], profile });
    expect(out.map((f) => f.joint)).toEqual(["supportBolted"]);
  });

  /** Support sous une marche de matériau donné, fixation de la marche `treadBolted` (A31). */
  const boltedTread = (treadMaterial: Part["material"], holeDiameter = 9): Part[] =>
    parts(treadMaterial).map((p) =>
      p.id === "sup"
        ? { ...p, fixings: [{ joint: "treadBolted" as const, points: 3, holeDiameter }] }
        : p,
    );

  it("marche en tôle vissée (A31) : vis à métaux M8 lues sur le perçage de 9 mm", () => {
    const out = computeFasteners({ parts: boltedTread("steel-painted"), walls: [], profile });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      joint: "treadBolted",
      kind: "machine-screw",
      grade: "8.8",
      diameter: 8,
      length: 20,
      quantity: 3,
      partIds: ["t", "sup"],
      deduced: ["diameter", "quantity"],
    });
    expect(fr(out[0]!.name)).toBe("Vis à métaux M8 × 20, classe 8.8");
    expect(fr(out[0]!.origin)).toBe("Marche M1 → support CR1");
    expect(EN.t(out[0]!.origin)).toBe("Tread M1 → support CR1");
  });

  it("vis à métaux déclarées sous une marche bois : aucun élément", () => {
    expect(computeFasteners({ parts: boltedTread("wood-oak"), walls: [], profile })).toEqual([]);
  });

  it("perçage de marche plus grand : diamètre nominal déduit (M10 dans 11 mm)", () => {
    const out = computeFasteners({ parts: boltedTread("steel-raw", 11), walls: [], profile });
    expect(out[0]!.diameter).toBe(10);
  });

  it("réglage d'atelier de la marche en tôle vissée : longueur et quantité par point", () => {
    const p = resolveFastenerProfile({ joints: { treadBolted: { length: 25, perPoint: 2 } } });
    const [f] = computeFasteners({ parts: boltedTread("steel-raw"), walls: [], profile: p });
    expect(f).toMatchObject({ length: 25, quantity: 6, diameter: 8 });
  });

  it("contremarche d'arrivée fixée au chevêtre", () => {
    const riser = part({
      id: "riser-15",
      mark: "CM15",
      category: "riser",
      fixings: [{ joint: "riserTrimmer", points: 3, holeDiameter: 11 }],
    });
    const [f] = computeFasteners({ parts: [riser], walls: [], profile });
    expect(f).toMatchObject({ joint: "riserTrimmer", diameter: 10, quantity: 3, length: 80 });
    expect(fr(f!.origin)).toBe("Contremarche d'arrivée CM15 → chevêtre");
  });
});

describe("computeFasteners — longueur déduite (`PartFixing.length`, limon central bois)", () => {
  const tread = (n: number): Part =>
    part({ id: `tread-${n}`, mark: `M${n}`, category: "tread", material: "wood-oak" });
  /** Poutre déclarant ses boulons traversants, une fixation par assise et par longueur. */
  const beam = (fixings: PartFixing[]): Part =>
    part({
      id: "wood-central-beam",
      mark: "LC1",
      category: "carriage",
      material: "wood-oak",
      fixings,
    });

  it("longueur déduite prioritaire sur le profil, M10 lu sur le perçage de 11 mm", () => {
    const parts = [
      tread(1),
      beam([
        { joint: "treadBeamBolted", points: 2, holeDiameter: 11, length: 260, with: ["tread-1"] },
      ]),
    ];
    const [f] = computeFasteners({ parts, walls: [], profile });
    expect(profile.joints.treadBeamBolted.length).not.toBe(260);
    expect(f).toMatchObject({
      joint: "treadBeamBolted",
      kind: "bolt",
      diameter: 10,
      length: 260,
      quantity: 2,
      partIds: ["tread-1", "wood-central-beam"],
      deduced: ["diameter", "quantity", "length"],
    });
    expect(fr(f!.name)).toMatch(/M10 × 260/);
    expect(fr(f!.origin)).toBe("Marche M1 → limon central LC1");
    expect(EN.t(f!.origin)).not.toBe("fastener.origin.treadBeamBolted");
  });

  it("repères distincts par longueur, identiques pour une même longueur", () => {
    const parts = [
      tread(1),
      tread(2),
      tread(3),
      beam([
        { joint: "treadBeamBolted", points: 2, holeDiameter: 11, length: 260, with: ["tread-1"] },
        { joint: "treadBeamBolted", points: 2, holeDiameter: 11, length: 270, with: ["tread-2"] },
        { joint: "treadBeamBolted", points: 2, holeDiameter: 11, length: 260, with: ["tread-3"] },
      ]),
    ];
    const out = computeFasteners({ parts, walls: [], profile });
    expect(out.map((f) => f.length)).toEqual([260, 270, 260]);
    expect(out[0]!.mark).toBe(out[2]!.mark);
    expect(out[0]!.mark).not.toBe(out[1]!.mark);
    expect(new Set(out.map((f) => f.id)).size).toBe(3);
  });

  it("longueur absente, nulle ou non finie : longueur du profil, non déduite", () => {
    for (const length of [undefined, 0, Number.NaN]) {
      const fx: PartFixing = {
        joint: "treadBeamBolted",
        points: 1,
        holeDiameter: 11,
        with: ["tread-1"],
        ...(length !== undefined ? { length } : {}),
      };
      const [f] = computeFasteners({ parts: [tread(1), beam([fx])], walls: [], profile });
      expect(f!.length).toBe(profile.joints.treadBeamBolted.length);
      expect(f!.deduced).not.toContain("length");
    }
  });

  it("sabot : chevilles au sol, boulons au travers de la poutre (origine des deux joints)", () => {
    const shoe = part({
      id: "wood-central-shoe-foot",
      mark: "SP1",
      category: "fixing",
      fixings: [
        { joint: "plateFloor", points: 2, holeDiameter: 13 },
        {
          joint: "shoeBolted",
          points: 2,
          holeDiameter: 13,
          length: 120,
          with: ["wood-central-beam"],
        },
      ],
    });
    const out = computeFasteners({ parts: [beam([]), shoe], walls: [], profile });
    expect(out.map((f) => f.joint)).toEqual(["plateFloor", "shoeBolted"]);
    const bolt = out[1]!;
    expect(bolt).toMatchObject({ kind: "bolt", diameter: 12, length: 120, quantity: 2 });
    expect(bolt.partIds).toEqual(["wood-central-beam", "wood-central-shoe-foot"]);
    expect(fr(bolt.origin)).toBe("Sabot SP1 → LC1");
    expect(EN.t(bolt.origin)).not.toBe("fastener.origin.shoeBolted");
  });
});

describe("computeFasteners — garde-corps", () => {
  const side = (s: "inner" | "outer", wallId?: string): SideAnalysis => ({
    side: s,
    length: 3000,
    intervals: [{ from: 0, to: 3000, kind: "wall", ...(wallId ? { wallId } : {}) }],
    maxFall: 0,
  });
  const handrail = (s: "inner" | "outer", partId: string): HandrailRun => ({
    id: partId,
    partId,
    side: s,
    onGuard: false,
    from: 0,
    to: 3000,
    nosingHeights: [],
    sectionWidth: 42,
    intrusion: 0,
  });
  const sweep = (id: string, mark: string, length: number): Part => ({
    ...part({ id, mark, category: "handrail", material: "wood-oak" }),
    solid: {
      kind: "sweep",
      path: [
        { x: 0, y: 0, z: 0 },
        { x: length, y: 0, z: 0 },
      ],
      section: { outer: [], holes: [] },
    },
  });
  const guards = (sides: SideAnalysis[], handrails: HandrailRun[]): GuardsAnalysis =>
    ({
      runs: [
        { kind: "rake", postPartIds: ["g1", "g2"] },
        { kind: "opening", postPartIds: ["g2", "g3"] },
      ],
      sides,
      handrails,
    }) as unknown as GuardsAnalysis;
  const posts = ["g1", "g2", "g3"].map((id, i) =>
    part({ id, mark: i < 2 ? "PG1" : "PG2", category: "post" }),
  );
  const walls: Wall[] = [
    { id: "porteur", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 200, loadBearing: true },
    { id: "cloison", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 70, loadBearing: false },
  ];

  it("poteaux : rampant sur l'escalier bois, trémie sur le plancher (poteau partagé compté une fois)", () => {
    const wood = [
      part({ id: "s", mark: "LI1", category: "stringer", material: "wood-oak" }),
      ...posts,
    ];
    const out = computeFasteners({ parts: wood, guards: guards([], []), walls, profile });
    expect(out.map((f) => [f.partIds[0], f.joint, f.quantity])).toEqual([
      ["g1", "guardPostStair", 4],
      ["g2", "guardPostStair", 4],
      ["g3", "guardPostFloor", 4],
    ]);
    expect(out[0]!.kind).toBe("lag-screw");
    expect(out[0]!.deduced).toEqual([]);
    expect(fr(out[0]!.origin)).toBe("Poteau PG1 → escalier");
    expect(fr(out[2]!.origin)).toBe("Poteau PG2 → plancher");
  });

  it("poteaux de rampant selon le support : limons acier → boulons, jamais de tire-fond", () => {
    const steel = [
      part({ id: "s", mark: "LI1", category: "stringer", material: "steel-painted" }),
      // Marches bois sur limons acier : le poteau est porté par la structure latérale.
      part({ id: "t", mark: "M1", category: "tread", material: "wood-oak" }),
      ...posts,
    ];
    const out = computeFasteners({ parts: steel, guards: guards([], []), walls, profile });
    const rake = out.filter((f) => f.partIds[0] !== "g3");
    expect(rake.map((f) => f.joint)).toEqual(["guardPostStairMetal", "guardPostStairMetal"]);
    expect(rake.every((f) => f.kind === "bolt")).toBe(true);
    // Sans limon (limon central, noyau) : les marches portent ; marches bois → tire-fonds.
    const core = [part({ id: "t", mark: "M1", category: "tread", material: "wood-oak" }), ...posts];
    const onTreads = computeFasteners({ parts: core, guards: guards([], []), walls, profile });
    expect(onTreads[0]!.joint).toBe("guardPostStair");
    // Ni limon ni marche bois : métal.
    const bare = computeFasteners({ parts: posts, guards: guards([], []), walls, profile });
    expect(bare[0]!.joint).toBe("guardPostStairMetal");
  });

  it("main courante murale : supports à l'entraxe maximal, mur porteur ou cloison", () => {
    const parts = [sweep("h1", "MC1", 2500), sweep("h2", "MC2", 3000)];
    const g = guards(
      [side("inner", "porteur"), side("outer", "cloison")],
      [handrail("inner", "h1"), handrail("outer", "h2")],
    );
    const out = computeFasteners({ parts, guards: g, walls, profile });
    // ⌈2500 / 1000⌉ + 1 = 4 supports ; ⌈3000 / 1000⌉ + 1 = 4 supports ; 2 chevilles par support.
    expect(out.map((f) => [f.joint, f.quantity])).toEqual([
      ["handrailWall", 8],
      ["handrailPartition", 8],
    ]);
    expect(fr(out[0]!.origin)).toBe("Main courante MC1 : 4 supports → mur porteur");
    expect(fr(out[1]!.origin)).toBe("Main courante MC2 : 4 supports → cloison");
    expect(EN.t(out[1]!.origin)).toBe("Handrail MC2: 4 brackets → non-load-bearing wall");
    expect(out[1]!.kind).toBe("hollow-wall-anchor");
  });

  it("mur imposé (sans mur du site) : selon le profil d'atelier, porteur par défaut", () => {
    const g = guards([side("inner")], [handrail("inner", "h1")]);
    const [f] = computeFasteners({ parts: [sweep("h1", "MC1", 900)], guards: g, walls, profile });
    expect(f).toMatchObject({ joint: "handrailWall", quantity: 4, unknownWall: true });
    const p = resolveFastenerProfile({ unknownWallLoadBearing: false });
    const [c] = computeFasteners({
      parts: [sweep("h1", "MC1", 900)],
      guards: g,
      walls,
      profile: p,
    });
    expect(c).toMatchObject({ joint: "handrailPartition", kind: "hollow-wall-anchor" });
    expect(c!.unknownWall).toBe(true);
    // Mur décrit par le site : pas d'hypothèse.
    const known = guards([side("inner", "porteur")], [handrail("inner", "h1")]);
    const [k] = computeFasteners({
      parts: [sweep("h1", "MC1", 900)],
      guards: known,
      walls,
      profile: p,
    });
    expect(k!.joint).toBe("handrailWall");
    expect(k!.unknownWall).toBeUndefined();
  });

  it("main courante sur garde-corps : aucune visserie murale", () => {
    const g = guards([side("inner", "porteur")], [{ ...handrail("inner", "h1"), onGuard: true }]);
    expect(
      computeFasteners({ parts: [sweep("h1", "MC1", 900)], guards: g, walls, profile }),
    ).toEqual([]);
  });
});

describe("computeFasteners — propriétés", () => {
  const jointArb = fc.constantFrom(...FASTENER_JOINTS);
  const fixingArb = fc.record({
    joint: jointArb,
    points: fc.integer({ min: 0, max: 12 }),
    holeDiameter: fc.option(fc.double({ min: 0.5, max: 40, noNaN: true }), { nil: undefined }),
  });
  const partsArb = fc
    .array(
      fc.record({
        fixings: fc.array(fixingArb, { maxLength: 3 }),
        holes: fc.integer({ min: 0, max: 6 }),
        wood: fc.boolean(),
      }),
      { maxLength: 8 },
    )
    .map((specs) =>
      specs.flatMap((s, i): Part[] => {
        const tread = part({
          id: `t${i}`,
          mark: `M${i}`,
          category: "tread",
          material: s.wood ? "wood-oak" : "steel-raw",
          assembledWith: [`x${i}`],
        });
        const main =
          s.holes > 0
            ? plate(`x${i}`, `X${i}`, s.holes, 13)
            : part({ id: `x${i}`, mark: `X${i}`, category: "support" });
        return [
          tread,
          {
            ...main,
            assembledWith: [`t${i}`],
            fixings: s.fixings.map((f) => ({
              joint: f.joint,
              points: f.points,
              ...(f.holeDiameter !== undefined ? { holeDiameter: f.holeDiameter } : {}),
              with: [`t${i}`, "inconnu"],
            })),
          },
        ];
      }),
    );

  it("quantités entières > 0, pièces connues, identifiants uniques, repère par désignation", () => {
    fc.assert(
      fc.property(partsArb, (parts) => {
        const out = computeFasteners({ parts, walls: [], profile });
        const ids = new Set(parts.map((p) => p.id));
        expect(new Set(out.map((f) => f.id)).size).toBe(out.length);
        const byMark = new Map<string, string>();
        for (const f of out) {
          expect(Number.isInteger(f.quantity)).toBe(true);
          expect(f.quantity).toBeGreaterThan(0);
          expect(f.diameter).toBeGreaterThan(0);
          for (const id of f.partIds) expect(ids.has(id)).toBe(true);
          const key = `${f.kind}|${f.grade}|${f.diameter}|${f.length}`;
          expect(byMark.get(f.mark) ?? key).toBe(key);
          byMark.set(f.mark, key);
        }
        expect(new Set(byMark.values()).size).toBe(byMark.size);
      }),
    );
  });
});
