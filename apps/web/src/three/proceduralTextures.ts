/**
 * Textures **procédurales** des matériaux (jalon 6) : générées au runtime, sans fichier externe
 * (ni licence, ni poids de téléchargement). Données pures (tableaux RGBA), sans three.js ni
 * DOM : testables, et générables par tranches de lignes (`fillRows`) pour ne jamais bloquer le
 * fil principal (voir `three/textures.ts`).
 *
 * Convention d'axes : x (u) = sens du fil / du brossage, y (v) = travers (voir `grainUVs` de
 * `@blondel/geometry`). Toutes les textures se raccordent sans couture (bruits périodiques de
 * période entière).
 *
 * Aucune règle métier : teintes, fréquences et tailles de motif sont des choix de présentation.
 */

export type TextureKind =
  "oak" | "beech" | "ash" | "pine" | "glulam" | "steel-raw" | "galvanized" | "brushed" | "concrete";

export const TEXTURE_KINDS: readonly TextureKind[] = [
  "oak",
  "beech",
  "ash",
  "pine",
  "glulam",
  "steel-raw",
  "galvanized",
  "brushed",
  "concrete",
];

/** Dimensions physiques d'un carreau de texture (m) : le long du fil (u) et en travers (v). */
export const TEXTURE_TILE: Readonly<Record<TextureKind, { u: number; v: number }>> = {
  oak: { u: 1.2, v: 0.3 },
  beech: { u: 1.2, v: 0.3 },
  ash: { u: 1.2, v: 0.3 },
  pine: { u: 1.2, v: 0.3 },
  // Lamellé-collé : 8 lamelles de 40 mm par carreau (présentation).
  glulam: { u: 1.2, v: 0.32 },
  "steel-raw": { u: 0.6, v: 0.6 },
  galvanized: { u: 0.5, v: 0.5 },
  brushed: { u: 0.4, v: 0.2 },
  concrete: { u: 1, v: 1 },
};

/** Texture générée : couleur (sRGB) et rugosité (canal G, linéaire), RGBA 8 bits. */
export interface TextureData {
  readonly kind: TextureKind;
  readonly size: number;
  readonly color: Uint8Array;
  readonly roughness: Uint8Array;
}

// ------------------------------------------------------------------ bruits périodiques

/** Hachage entier → [0, 1). */
function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a: number, p: number): number => ((a % p) + p) % p;
const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const fract = (x: number): number => x - Math.floor(x);

/**
 * Bruit de valeur périodique : (x, y) en coordonnées de réseau, périodes entières (px, py).
 * Résultat dans [0, 1).
 */
export function valueNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const ax = mod(x0, px);
  const bx = mod(x0 + 1, px);
  const ay = mod(y0, py);
  const by = mod(y0 + 1, py);
  return lerp(
    lerp(hash(ax, ay, seed), hash(bx, ay, seed), tx),
    lerp(hash(ax, by, seed), hash(bx, by, seed), tx),
    ty,
  );
}

/**
 * Bruit fractal périodique sur le carreau unité (s, t ∈ [0, 1)) : fréquences de base (fx, fy)
 * entières, doublées à chaque octave. Résultat dans [0, 1).
 */
export function fbm(
  s: number,
  t: number,
  fx: number,
  fy: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const kx = fx << o;
    const ky = fy << o;
    sum += amp * valueNoise(s * kx, t * ky, kx, ky, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Distance au germe le plus proche (cellules de Voronoï périodiques), et hachage de la cellule. */
function cellular(s: number, t: number, n: number, seed: number): { d: number; id: number } {
  const x = s * n;
  const y = t * n;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best = Infinity;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = mod(cx + i, n);
      const gy = mod(cy + j, n);
      const fx = cx + i + hash(gx, gy, seed);
      const fy = cy + j + hash(gx, gy, seed + 1);
      const d = (fx - x) ** 2 + (fy - y) ** 2;
      if (d < best) {
        best = d;
        id = hash(gx, gy, seed + 2);
      }
    }
  }
  return { d: Math.sqrt(best), id };
}

// ------------------------------------------------------------------ recettes

type Rgb = readonly [number, number, number];

/** Couleur (sRGB 0–255) et rugosité (0–1) d'un texel (s, t). */
type Shader = (s: number, t: number, px: number) => { rgb: Rgb; r: number };

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
const shade = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

interface WoodTone {
  readonly early: Rgb;
  readonly late: Rgb;
  /** Nombre de cernes par carreau (entier), contraste du bois final, pores. */
  readonly rings: number;
  readonly contrast: number;
  readonly pores: number;
  readonly roughness: number;
  readonly seed: number;
}

const WOODS: Readonly<Record<"oak" | "beech" | "ash" | "pine", WoodTone>> = {
  oak: {
    early: [196, 150, 102],
    late: [138, 96, 58],
    rings: 14,
    contrast: 0.8,
    pores: 0.35,
    roughness: 0.62,
    seed: 11,
  },
  beech: {
    early: [218, 178, 136],
    late: [192, 146, 106],
    rings: 18,
    contrast: 0.35,
    pores: 0.12,
    roughness: 0.55,
    seed: 23,
  },
  ash: {
    early: [226, 206, 170],
    late: [176, 146, 104],
    rings: 12,
    contrast: 0.9,
    pores: 0.3,
    roughness: 0.6,
    seed: 37,
  },
  pine: {
    early: [232, 198, 140],
    late: [182, 122, 64],
    rings: 10,
    contrast: 1,
    pores: 0.05,
    roughness: 0.7,
    seed: 41,
  },
};

/** Veinage de dosse : cernes le long du fil (lignes de v constant) ondulés, pores allongés. */
function woodTexel(tone: WoodTone, s: number, t: number, rings: number, offset: number) {
  const warp = fbm(s, t, 2, 3, 3, tone.seed) - 0.5;
  const wiggle = fbm(s, t, 1, 8, 2, tone.seed + 5) - 0.5;
  const r = fract(t * rings + warp * 2.2 + wiggle * 0.6 + offset);
  // Bois final : transition douce vers la fin du cerne.
  const late = smooth(clamp01((r - 0.55) / 0.4)) * tone.contrast;
  // Pores et fibres : bruit très étiré le long du fil.
  const fibre = valueNoise(s * 4, t * 96, 4, 96, tone.seed + 9);
  const base = mix(tone.early, tone.late, late);
  const k =
    1 - tone.pores * 0.35 * (fibre - 0.5) - 0.06 * (fbm(s, t, 3, 3, 2, tone.seed + 3) - 0.5);
  return {
    rgb: shade(base, k),
    r: clamp01(tone.roughness + 0.08 * late + 0.1 * tone.pores * (fibre - 0.5)),
  };
}

const RECIPES: Readonly<Record<TextureKind, Shader>> = {
  oak: (s, t) => woodTexel(WOODS.oak, s, t, WOODS.oak.rings, 0),
  beech: (s, t) => woodTexel(WOODS.beech, s, t, WOODS.beech.rings, 0),
  ash: (s, t) => woodTexel(WOODS.ash, s, t, WOODS.ash.rings, 0),
  pine: (s, t) => woodTexel(WOODS.pine, s, t, WOODS.pine.rings, 0),
  glulam: (s, t) => {
    // 8 lamelles par carreau, teinte et phase des cernes propres à chaque lamelle, joint de colle.
    const n = 8;
    const lam = Math.floor(t * n);
    const local = fract(t * n);
    const tone = WOODS.pine;
    const w = woodTexel(tone, s, t, 24, hash(lam, 0, 5));
    const k = 0.92 + 0.14 * hash(lam, 1, 7);
    const glue = local < 0.015 || local > 0.985;
    return glue ? { rgb: [120, 92, 60], r: 0.6 } : { rgb: shade(w.rgb, k), r: w.r };
  },
  "steel-raw": (s, t) => {
    // Calamine : marbrure gris bleuté, taches plus claires.
    const m = fbm(s, t, 4, 4, 4, 51);
    const spots = smooth(clamp01((fbm(s, t, 8, 8, 2, 53) - 0.6) * 4));
    const rgb = mix(mix([72, 78, 86], [104, 108, 114], m), [136, 134, 128], spots * 0.6);
    return { rgb, r: clamp01(0.45 + 0.25 * m + 0.1 * spots) };
  },
  galvanized: (s, t) => {
    // Fleurage du zinc : cellules de teinte et de rugosité différentes.
    const c = cellular(s, t, 14, 61);
    const edge = smooth(clamp01(c.d * 2.2));
    const g = 150 + 60 * c.id - 12 * edge;
    const n = fbm(s, t, 8, 8, 2, 63) - 0.5;
    return { rgb: [g + 8 * n, g + 4 + 8 * n, g + 10 + 8 * n], r: clamp01(0.25 + 0.3 * c.id) };
  },
  brushed: (s, t) => {
    // Inox brossé : stries fines le long du fil (u), rugosité striée (anisotropie simulée).
    const streak = valueNoise(s * 3, t * 400, 3, 400, 71);
    const fine = valueNoise(s * 8, t * 1200, 8, 1200, 73);
    const k = 0.93 + 0.06 * streak + 0.03 * fine;
    return { rgb: shade([200, 204, 208], k), r: clamp01(0.22 + 0.16 * streak + 0.06 * fine) };
  },
  concrete: (s, t, px) => {
    const m = fbm(s, t, 4, 4, 5, 81);
    const pit = hash(Math.floor(s * px), Math.floor(t * px), 83) > 0.992;
    const rgb = shade([170, 166, 158], 0.82 + 0.3 * (m - 0.5) + (pit ? -0.35 : 0));
    return { rgb, r: clamp01(0.8 + 0.15 * m) };
  },
};

/** Couleur moyenne indicative (remplissage avant génération, sRGB 0–255). */
export function baseColor(kind: TextureKind): Rgb {
  const { rgb } = RECIPES[kind](0.37, 0.61, 64);
  return rgb;
}

/** Texture allouée, remplie d'une teinte unie en attendant la génération. */
export function allocateTexture(kind: TextureKind, size: number): TextureData {
  if (!Number.isInteger(size) || size < 4) throw new Error(`taille de texture invalide : ${size}`);
  const color = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const [r, g, b] = baseColor(kind);
  for (let k = 0; k < color.length; k += 4) {
    color[k] = r;
    color[k + 1] = g;
    color[k + 2] = b;
    color[k + 3] = 255;
    roughness[k] = 255;
    roughness[k + 1] = 160;
    roughness[k + 2] = 255;
    roughness[k + 3] = 255;
  }
  return { kind, size, color, roughness };
}

const byte = (x: number): number => (x <= 0 ? 0 : x >= 255 ? 255 : Math.round(x));

/** Génère les lignes [y0, y1) de `data`. */
export function fillRows(data: TextureData, y0: number, y1: number): void {
  const { size, color, roughness } = data;
  const shader = RECIPES[data.kind];
  for (let y = y0; y < Math.min(y1, size); y++) {
    const t = y / size;
    for (let x = 0; x < size; x++) {
      const { rgb, r } = shader(x / size, t, size);
      const k = 4 * (y * size + x);
      color[k] = byte(rgb[0]);
      color[k + 1] = byte(rgb[1]);
      color[k + 2] = byte(rgb[2]);
      color[k + 3] = 255;
      // Rugosité dans le canal G (convention three.js), métallicité (B) inutilisée.
      const rr = byte(r * 255);
      roughness[k] = rr;
      roughness[k + 1] = rr;
      roughness[k + 2] = rr;
      roughness[k + 3] = 255;
    }
  }
}

/** Texture complète, générée d'un coup (tests, outils). */
export function generateTexture(kind: TextureKind, size: number): TextureData {
  const data = allocateTexture(kind, size);
  fillRows(data, 0, size);
  return data;
}
