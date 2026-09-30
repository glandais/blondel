import { describe, expect, it } from "vitest";
import { describeSkipped, DxfImportError, readDxfUnderlay } from "./dxf.js";
import { DxfUnderlaySchema, type UnderlayEntity } from "./schema.js";
import { entitySegments, segmentsBounds } from "./underlay.js";

/** Écrivain DXF minimal (paires code / valeur) pour les tests : en-tête, blocs, entités. */
function dxf(o: { insUnits?: number; blocks?: string[][]; entities: string[][] }): string {
  const lines: string[] = [];
  const pair = (code: number, value: string | number): void => {
    lines.push(String(code), String(value));
  };
  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1015");
  if (o.insUnits !== undefined) {
    pair(9, "$INSUNITS");
    pair(70, o.insUnits);
  }
  pair(0, "ENDSEC");
  if (o.blocks) {
    pair(0, "SECTION");
    pair(2, "BLOCKS");
    for (const b of o.blocks) lines.push(...b);
    pair(0, "ENDSEC");
  }
  pair(0, "SECTION");
  pair(2, "ENTITIES");
  for (const e of o.entities) lines.push(...e);
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return lines.join("\n") + "\n";
}

const g = (...kv: (string | number)[]): string[] => kv.map(String);

const line = (x1: number, y1: number, x2: number, y2: number, layer = "MURS"): string[] =>
  g(0, "LINE", 8, layer, 10, x1, 20, y1, 30, 0, 11, x2, 21, y2, 31, 0);

const lwpolyline = (pts: [number, number, number?][], closed: boolean, layer = "0"): string[] => [
  ...g(0, "LWPOLYLINE", 8, layer, 90, pts.length, 70, closed ? 1 : 0),
  ...pts.flatMap(([x, y, bulge]) => [
    ...g(10, x, 20, y),
    ...(bulge !== undefined ? g(42, bulge) : []),
  ]),
];

const polyline = (pts: [number, number][], closed: boolean): string[] => [
  ...g(0, "POLYLINE", 8, "PL", 66, 1, 10, 0, 20, 0, 30, 0, 70, closed ? 1 : 0),
  ...pts.flatMap(([x, y]) => g(0, "VERTEX", 8, "PL", 10, x, 20, y, 30, 0)),
  ...g(0, "SEQEND"),
];

const arc = (cx: number, cy: number, r: number, a0: number, a1: number): string[] =>
  g(0, "ARC", 8, "ARCS", 10, cx, 20, cy, 30, 0, 40, r, 50, a0, 51, a1);

const circle = (cx: number, cy: number, r: number): string[] =>
  g(0, "CIRCLE", 8, "POTEAUX", 10, cx, 20, cy, 30, 0, 40, r);

const text = (): string[] => g(0, "TEXT", 8, "TEXTES", 10, 0, 20, 0, 30, 0, 40, 2.5, 1, "Séjour");

const block = (name: string, base: [number, number], entities: string[][]): string[] => [
  ...g(0, "BLOCK", 8, "0", 2, name, 70, 0, 10, base[0], 20, base[1], 30, 0, 3, name),
  ...entities.flat(),
  ...g(0, "ENDBLK", 8, "0"),
];

const insert = (
  name: string,
  x: number,
  y: number,
  o: { sx?: number; sy?: number; rot?: number; layer?: string } = {},
): string[] =>
  g(
    0,
    "INSERT",
    8,
    o.layer ?? "BLOCS",
    2,
    name,
    10,
    x,
    20,
    y,
    30,
    0,
    41,
    o.sx ?? 1,
    42,
    o.sy ?? 1,
    50,
    o.rot ?? 0,
  );

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 0.01): void => {
  expect(Math.abs(a.x - b.x), `x ${a.x} ≠ ${b.x}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y), `y ${a.y} ≠ ${b.y}`).toBeLessThanOrEqual(tol);
};

function only<K extends UnderlayEntity["kind"]>(
  entities: readonly UnderlayEntity[],
  kind: K,
): Extract<UnderlayEntity, { kind: K }>[] {
  return entities.filter((e): e is Extract<UnderlayEntity, { kind: K }> => e.kind === kind);
}

describe("readDxfUnderlay — plan de masse écrit par le test", () => {
  const text_ = dxf({
    insUnits: 6, // mètres
    entities: [
      line(0, 0, 4, 0),
      line(4, 0, 4, 3),
      lwpolyline(
        [
          [0, 0],
          [2, 0, 1], // demi-cercle de (2, 0) à (2, 2), centre (2, 1), trigonométrique
          [2, 2],
          [0, 2],
        ],
        true,
      ),
      polyline(
        [
          [5, 0],
          [6, 0],
          [6, 1],
        ],
        false,
      ),
      arc(1, 1, 0.5, 0, 90),
      circle(3, 3, 0.1),
      text(),
    ],
  });
  const r = readDxfUnderlay(text_);

  it("lit $INSUNITS = 6 (mètre) : entités converties en mm", () => {
    expect(r.insUnits).toBe(6);
    expect(r.unitName).toBe("mètre");
    expect(r.unitScale).toBe(1000);
    expect(r.needsScale).toBe(false);
    const lines = only(r.entities, "line");
    expect(lines).toHaveLength(2);
    near(lines[1]!.a, { x: 4000, y: 0 });
    near(lines[1]!.b, { x: 4000, y: 3000 });
    expect(lines[0]!.layer).toBe("MURS");
  });

  it("LWPOLYLINE fermée à renflement, POLYLINE à sommets, ARC et CIRCLE", () => {
    const [lw, pl] = only(r.entities, "polyline");
    expect(lw!.closed).toBe(true);
    expect(lw!.points).toHaveLength(4);
    expect(lw!.bulges).toEqual([0, 1, 0, 0]);
    const semi = entitySegments(lw!)[1]!;
    expect(semi.kind).toBe("arc");
    if (semi.kind === "arc") {
      near(semi.center, { x: 2000, y: 1000 });
      expect(semi.radius).toBeCloseTo(1000, 6);
      expect(semi.sweep).toBeCloseTo(Math.PI, 9);
    }
    expect(pl!.closed).toBeUndefined();
    expect(pl!.points.map((p) => [p.x, p.y])).toEqual([
      [5000, 0],
      [6000, 0],
      [6000, 1000],
    ]);
    const [a] = only(r.entities, "arc");
    expect(a).toMatchObject({ center: { x: 1000, y: 1000 }, radius: 500, start: 0, end: 90 });
    const [c] = only(r.entities, "circle");
    expect(c).toMatchObject({ center: { x: 3000, y: 3000 }, radius: 100 });
  });

  it("ignore et compte les entités non prises en charge ; emprise et calques", () => {
    expect(r.skipped).toEqual({ TEXT: 1 });
    expect(r.layers).toEqual(["0", "ARCS", "MURS", "PL", "POTEAUX"]);
    expect(r.bounds).toEqual({ min: { x: 0, y: 0 }, max: { x: 6000, y: 3100 } });
    expect(r.truncated).toBe(false);
  });

  it("les entités lues forment un calque valide pour le projet", () => {
    const parsed = DxfUnderlaySchema.parse({
      name: "plan.dxf",
      unitScale: r.unitScale,
      placement: { origin: { x: 0, y: 0 } },
      entities: r.entities,
    });
    expect(parsed.entities).toEqual(r.entities);
  });
});

describe("readDxfUnderlay — unités", () => {
  const body = { entities: [line(0, 0, 100, 0)] };

  it("sans $INSUNITS : échelle demandée (needsScale), rien n'est deviné", () => {
    const r = readDxfUnderlay(dxf(body));
    expect(r.insUnits).toBeNull();
    expect(r.needsScale).toBe(true);
    expect(r.unitScale).toBe(1);
  });

  it("$INSUNITS = 0 (sans unité) : échelle demandée ; l'échelle saisie s'applique", () => {
    expect(readDxfUnderlay(dxf({ ...body, insUnits: 0 })).needsScale).toBe(true);
    const r = readDxfUnderlay(dxf({ ...body, insUnits: 0 }), { unitScale: 10 });
    expect(r.needsScale).toBe(false);
    near(only(r.entities, "line")[0]!.b, { x: 1000, y: 0 });
  });

  it("centimètres, pouces, millimètres ; l'échelle saisie l'emporte sur l'en-tête", () => {
    const b = (u: number, s?: number) =>
      only(
        readDxfUnderlay(dxf({ ...body, insUnits: u }), s ? { unitScale: s } : {}).entities,
        "line",
      )[0]!.b.x;
    expect(b(5)).toBe(1000);
    expect(b(1)).toBe(2540);
    expect(b(4)).toBe(100);
    expect(b(6, 1)).toBe(100);
  });

  it("échelle saisie invalide : erreur lisible", () => {
    expect(() => readDxfUnderlay(dxf(body), { unitScale: 0 })).toThrow(DxfImportError);
  });
});

describe("readDxfUnderlay — blocs (INSERT)", () => {
  const blocks = [block("PORTE", [0, 0], [line(0, 0, 10, 0, "0"), arc(0, 0, 10, 0, 90)])];

  it("insertion tournée et mise à l'échelle uniforme : arcs conservés, calque « 0 » hérité", () => {
    const r = readDxfUnderlay(
      dxf({ insUnits: 4, blocks, entities: [insert("PORTE", 100, 50, { sx: 2, sy: 2, rot: 90 })] }),
    );
    const [l] = only(r.entities, "line");
    near(l!.a, { x: 100, y: 50 });
    near(l!.b, { x: 100, y: 70 });
    expect(l!.layer).toBe("BLOCS");
    const [a] = only(r.entities, "arc");
    expect(a!.radius).toBe(20);
    expect(a!.start).toBeCloseTo(90, 6);
    expect(a!.end).toBeCloseTo(180, 6);
  });

  it("insertion en miroir (x négatif) : l'arc reste trigonométrique, extrémités exactes", () => {
    const r = readDxfUnderlay(
      dxf({ insUnits: 4, blocks, entities: [insert("PORTE", 0, 0, { sx: -1, sy: 1 })] }),
    );
    const [a] = only(r.entities, "arc");
    const seg = entitySegments(a!)[0]!;
    expect(seg.kind).toBe("arc");
    const b = segmentsBounds([seg])!;
    near(b.min, { x: -10, y: 0 });
    near(b.max, { x: 0, y: 10 });
  });

  it("échelles différentes en x et y : arc discrétisé en polyligne", () => {
    const r = readDxfUnderlay(
      dxf({ insUnits: 4, blocks, entities: [insert("PORTE", 0, 0, { sx: 2, sy: 1 })] }),
    );
    expect(only(r.entities, "arc")).toHaveLength(0);
    const [p] = only(r.entities, "polyline");
    near(p!.points[0]!, { x: 20, y: 0 });
    near(p!.points[p!.points.length - 1]!, { x: 0, y: 10 });
  });

  it("bloc inconnu : ignoré et compté", () => {
    const r = readDxfUnderlay(dxf({ insUnits: 4, entities: [insert("ABSENT", 0, 0)] }));
    expect(r.entities).toHaveLength(0);
    expect(r.skipped).toEqual({ INSERT: 1 });
  });
});

describe("readDxfUnderlay — bornes et erreurs", () => {
  it("tronque au-delà du nombre maximal d'entités et le signale", () => {
    const entities = Array.from({ length: 30 }, (_, i) => line(i, 0, i, 1));
    const r = readDxfUnderlay(dxf({ insUnits: 4, entities }), { maxEntities: 10 });
    expect(r.entities).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it("filtre par calque", () => {
    const r = readDxfUnderlay(
      dxf({ insUnits: 4, entities: [line(0, 0, 1, 0, "A"), line(0, 0, 1, 0, "B")] }),
      { layers: ["B"] },
    );
    expect(r.entities.map((e) => e.layer)).toEqual(["B"]);
  });

  it("fichier illisible : DxfImportError", () => {
    expect(() => readDxfUnderlay("0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n0\n10\n")).toThrow(
      DxfImportError,
    );
  });
});

describe("readDxfUnderlay — repère d'objet (OCS) à extrusion (0, 0, −1)", () => {
  // Relecture : cas fréquent des arcs symétrisés dans les logiciels de DAO, non testé jusqu'ici.
  it("ARC : x du centre inversé, sens de parcours rétabli (arc trigonométrique du repère général)", () => {
    const r = readDxfUnderlay(
      dxf({
        insUnits: 4,
        entities: [g(0, "ARC", 8, "A", 10, 100, 20, 0, 30, 0, 40, 50, 50, 0, 51, 90, 230, -1)],
      }),
    );
    const [a] = only(r.entities, "arc");
    expect(a).toBeDefined();
    near(a!.center, { x: -100, y: 0 });
    // OCS (150, 0) → (−150, 0) ; OCS (100, 50) → (−100, 50) : arc de 90° à 180°.
    const seg = entitySegments(a!)[0]!;
    expect(seg.kind).toBe("arc");
    if (seg.kind !== "arc") return;
    near(
      {
        x: seg.center.x + 50 * Math.cos(seg.startAngle),
        y: seg.center.y + 50 * Math.sin(seg.startAngle),
      },
      { x: -100, y: 50 },
    );
    near(
      {
        x: seg.center.x + 50 * Math.cos(seg.startAngle + seg.sweep),
        y: seg.center.y + 50 * Math.sin(seg.startAngle + seg.sweep),
      },
      { x: -150, y: 0 },
    );
    expect(seg.sweep).toBeCloseTo(Math.PI / 2, 9);
  });

  it("LWPOLYLINE : x inversés et renflement de signe opposé (même tracé en plan)", () => {
    const r = readDxfUnderlay(
      dxf({
        insUnits: 4,
        entities: [
          [
            ...g(0, "LWPOLYLINE", 8, "P", 90, 2, 70, 0),
            ...g(10, 0, 20, 0, 42, 1),
            ...g(10, 0, 20, 100),
            ...g(230, -1),
          ],
        ],
      }),
    );
    const [p] = only(r.entities, "polyline");
    near(p!.points[0]!, { x: 0, y: 0 });
    near(p!.points[1]!, { x: 0, y: 100 });
    // OCS : demi-cercle trigonométrique de (0,0) à (0,100) passant par (50, 50) → WCS (−50, 50).
    const b = segmentsBounds(entitySegments(p!))!;
    near(b.min, { x: -50, y: 0 });
    near(b.max, { x: 0, y: 100 });
  });
});

describe("ELLIPSE, SPLINE et entités ignorées signalées (QUESTIONS D6)", () => {
  const ellipse = (a0: number, a1: number): string[] =>
    g(
      0,
      "ELLIPSE",
      8,
      "E",
      10,
      1000,
      20,
      500,
      30,
      0,
      11,
      400,
      21,
      0,
      31,
      0,
      40,
      0.5,
      41,
      a0,
      42,
      a1,
    );

  it("ELLIPSE entière : polyligne fermée sur l'ellipse (demi-axes 400 et 200)", () => {
    const r = readDxfUnderlay(dxf({ insUnits: 4, entities: [ellipse(0, 2 * Math.PI)] }));
    expect(r.skipped).toEqual({});
    const [p] = only(r.entities, "polyline");
    expect(p!.closed).toBe(true);
    for (const q of p!.points) {
      const u = (q.x - 1000) / 400;
      const v = (q.y - 500) / 200;
      expect(u * u + v * v).toBeCloseTo(1, 3);
    }
    expect(r.bounds!.min.x).toBeCloseTo(600, 1);
    expect(r.bounds!.max.y).toBeCloseTo(700, 1);
  });

  it("arc d'ellipse : extrémités aux paramètres de début et de fin, polyligne ouverte", () => {
    const r = readDxfUnderlay(dxf({ insUnits: 5, entities: [ellipse(0, Math.PI / 2)] }));
    const [p] = only(r.entities, "polyline");
    expect(p!.closed).toBeUndefined();
    // Unité : centimètre (× 10).
    near(p!.points[0]!, { x: 14000, y: 5000 });
    near(p!.points.at(-1)!, { x: 10000, y: 7000 });
  });

  it("SPLINE : approchée par de Boor (Bézier quadratique), extrémités exactes", () => {
    // Nœuds 0 0 0 1 1 1 : Bézier de (0,0), (100,200), (200,0) ; sommet en (100, 100).
    const spline = [
      ...g(0, "SPLINE", 8, "S", 70, 8, 71, 2, 72, 6, 73, 3, 74, 0),
      ...g(40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1),
      ...g(10, 0, 20, 0, 30, 0, 10, 100, 20, 200, 30, 0, 10, 200, 20, 0, 30, 0),
    ];
    const r = readDxfUnderlay(dxf({ insUnits: 4, entities: [spline] }));
    expect(r.skipped).toEqual({});
    const [p] = only(r.entities, "polyline");
    expect(p!.points).toHaveLength(9);
    near(p!.points[0]!, { x: 0, y: 0 });
    near(p!.points[4]!, { x: 100, y: 100 });
    near(p!.points.at(-1)!, { x: 200, y: 0 });
    // Chaque point est sur la parabole y = 2x(200 − x) / 200.
    for (const q of p!.points) expect(q.y).toBeCloseTo((2 * q.x * (200 - q.x)) / 200, 1);
  });

  it("SPLINE sans nœuds cohérents : points de lissage, sinon ignorée et comptée", () => {
    const fitOnly = [
      ...g(0, "SPLINE", 8, "S", 70, 8, 71, 3, 72, 0, 73, 0, 74, 3),
      ...g(11, 0, 21, 0, 31, 0, 11, 50, 21, 10, 31, 0, 11, 100, 21, 0, 31, 0),
    ];
    const broken = [
      ...g(0, "SPLINE", 8, "S", 70, 8, 71, 3, 72, 0, 73, 1),
      ...g(10, 0, 20, 0, 30, 0),
    ];
    const r = readDxfUnderlay(dxf({ insUnits: 4, entities: [fitOnly, broken] }));
    const [p] = only(r.entities, "polyline");
    expect(p!.points.map((q) => [q.x, q.y])).toEqual([
      [0, 0],
      [50, 10],
      [100, 0],
    ]);
    expect(r.skipped).toEqual({ SPLINE: 1 });
  });

  it("describeSkipped : textes, cotes, hachures et autres détaillés pour l'utilisateur", () => {
    expect(describeSkipped({})).toBe("");
    expect(
      describeSkipped({ TEXT: 2, MTEXT: 1, DIMENSION: 4, HATCH: 1, POINT: 2, "INSERT:réseau": 1 }),
    ).toBe("3 texte(s), 4 cote(s), 1 hachure(s), 3 autre(s) (INSERT, POINT)");
    expect(describeSkipped({ paperSpace: 1, "calque:COTES": 5 })).toBe(
      "1 entité(s) de l'espace papier, 5 entité(s) hors des calques choisis",
    );
  });
});
