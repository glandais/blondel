import { describe, expect, it } from "vitest";
import { offset, offsetStations } from "./polyline.js";

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
