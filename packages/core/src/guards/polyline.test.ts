import { describe, expect, it } from "vitest";
import { offset, offsetStations, offsetTrimmed } from "./polyline.js";

const P = (x: number, y: number) => ({ x, y });

describe("offsetStations", () => {
  it("stations près d'un angle concave : bornées à l'onglet, sans rebroussement", () => {
    // Bord montant puis tournant à gauche ; décalage de 30 à gauche (côté concave).
    // Station à 13 mm de l'angle : le décalage naïf la placerait au-delà de l'onglet.
    const pts = [P(0, 0), P(0, 932), P(0, 945), P(-117, 945), P(-240, 945)];
    const naive = offset(pts, 30);
    expect(naive[1]!.y).toBeGreaterThan(naive[2]!.y); // rebroussement du décalage naïf
    const r = offsetStations(pts, 30)!;
    expect(r.points).toEqual([P(-30, 0), P(-30, 915), P(-117, 915), P(-240, 915)]);
    expect(r.group).toEqual([0, 1, 1, 2, 3]);
    expect(r.corner).toEqual([true, false, true, false, true]);
  });

  it("côté convexe : stations décalées normalement, onglet au sommet", () => {
    const pts = [P(0, 0), P(0, 50), P(0, 100), P(-100, 100)];
    const r = offsetStations(pts, -30)!;
    expect(r.points).toEqual([P(30, 0), P(30, 50), P(30, 130), P(-100, 130)]);
  });

  it("segment intérieur plus court que les retraits : null ; extrémité : absorbée", () => {
    // U : segment central de 40 mm, décalage de 30 vers l'intérieur des deux angles.
    const u = [P(0, 0), P(0, 500), P(-40, 500), P(-40, 0)];
    expect(offsetStations(u, 30)).toBeNull();
    // Dernier segment de 20 mm après l'angle : le chemin s'arrête à l'onglet.
    const end = [P(0, 0), P(0, 500), P(-20, 500)];
    const r = offsetStations(end, 30)!;
    expect(r.points).toEqual([P(-30, 0), P(-30, 470)]);
    expect(r.group).toEqual([0, 1, 1]);
  });
});

describe("offsetTrimmed", () => {
  // Arc de rayon 350 facetté tous les 3° (segments de 18 mm) puis bord radial vers l'extérieur :
  // angle concave pour un décalage de 50 mm vers l'extérieur de l'arc (à droite du parcours).
  const arc = Array.from({ length: 21 }, (_, i) => {
    const a = (i * 3 * Math.PI) / 180;
    return { x: 350 * Math.cos(a), y: 350 * Math.sin(a) };
  });
  const end = arc[arc.length - 1]!;
  const chain = [...arc, { x: end.x * (1200 / 350), y: end.y * (1200 / 350) }];

  it("offset brut : rebroussement près de l'angle (segments inversés)", () => {
    const raw = offset(chain, -50);
    const inverted = raw.slice(1).some((p, k) => {
      const d = { x: p.x - raw[k]!.x, y: p.y - raw[k]!.y };
      const o = { x: chain[k + 1]!.x - chain[k]!.x, y: chain[k + 1]!.y - chain[k]!.y };
      return d.x * o.x + d.y * o.y <= 0;
    });
    expect(inverted).toBe(true);
  });

  it("aucun segment inversé, coupe au sommet concave décalé, extrémités conservées", () => {
    const raw = offset(chain, -50);
    const out = offsetTrimmed(chain, -50);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
    // Chaque point est à 50 mm du bord radial ou à 400 mm du centre (arc décalé), sans pointe.
    for (let k = 1; k < out.length; k++) {
      const len = Math.hypot(out[k]!.x - out[k - 1]!.x, out[k]!.y - out[k - 1]!.y);
      expect(len).toBeGreaterThan(0);
    }
    const u = { x: Math.cos(Math.PI / 3), y: Math.sin(Math.PI / 3) };
    const corner = out[out.length - 2]!;
    expect(Math.abs(corner.x * u.y - corner.y * u.x)).toBeCloseTo(50, 0);
    expect(Math.hypot(corner.x, corner.y)).toBeLessThan(Math.hypot(400, 50) + 1);
    // Toute la polyligne reste du côté décalé : au moins 50 mm (à 1 mm près) de l'arc d'origine.
    for (const p of out) expect(Math.hypot(p.x, p.y)).toBeGreaterThan(398);
  });
});
