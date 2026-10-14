/**
 * Mise en forme stable des résumés d'instantanés (réservé aux tests) : empreinte courte,
 * arrondi sans zéro négatif, valeur canonique, décompte, paires DXF normalisées. Reprise à
 * l'identique des aides locales de `helicalOutputs.test.ts` (qui garde ses copies), avec le pas
 * d'arrondi des codes réels DXF en paramètre (défaut 1e-6, comme `helicalOutputs`).
 */
import { createHash } from "node:crypto";

/** Empreinte SHA-256 du texte, 16 premiers caractères hexadécimaux. */
export const sha = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Arrondi au pas `1 / scale`, sans zéro négatif. */
export function round(x: number, scale: number): number | string {
  if (!Number.isFinite(x)) return String(x);
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r;
}

/** Valeur canonique : nombres arrondis au pas `1 / scale`, champs indéfinis omis. */
export function canon(value: unknown, scale: number): unknown {
  if (typeof value === "number") return round(value, scale);
  if (Array.isArray(value)) return value.map((v) => canon(v, scale));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = canon(v, scale);
    }
    return out;
  }
  return value;
}

/** JSON de la valeur canonique (nombres au pas `1 / scale`, défaut 1e-6). */
export const json = (value: unknown, scale = 1e6): string => JSON.stringify(canon(value, scale));

/** Nombre d'occurrences de chaque valeur, triées. */
export function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of [...values].sort()) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** Codes de groupe réels (coordonnées, longueurs, angles). */
const isRealCode = (c: number): boolean =>
  (c >= 10 && c <= 59) ||
  (c >= 110 && c <= 149) ||
  (c >= 210 && c <= 239) ||
  (c >= 1010 && c <= 1059);

export type DxfPair = readonly [number, string];

/** Paires code / valeur d'un DXF, codes réels réécrits au pas `1 / scale` (défaut 1e-6). */
export function dxfPairs(text: string, scale = 1e6): DxfPair[] {
  const lines = text.split(/\r?\n/);
  const out: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    const raw = lines[i + 1]!;
    const value = isRealCode(code) ? String(round(Number(raw.trim()), scale)) : raw.trim();
    out.push([code, value]);
  }
  return out;
}

/** Texte d'un DXF, nombres réels réécrits au pas `1 / scale` (empreinte stable). */
export const dxfNormalized = (text: string, scale = 1e6): string =>
  dxfPairs(text, scale)
    .map(([c, v]) => `${c}=${v}`)
    .join("\n");
