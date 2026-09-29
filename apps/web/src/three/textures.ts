/**
 * Textures procédurales en `DataTexture` three.js, **générées une seule fois** (cache du module,
 * partagé par les montages successifs de la vue 3D) et **par tranches** : une tranche de lignes
 * par tâche, rendue au navigateur au-delà de `SLICE_MS`, pour qu'aucune génération ne compte
 * comme tâche longue (budget e2e de 200 ms).
 *
 * Une texture demandée est utilisable tout de suite : allouée à sa taille définitive et remplie
 * d'une teinte unie, puis remplacée par le motif quand il est prêt (`needsUpdate`, même taille :
 * ni réallocation ni recompilation de shaders), les abonnés (`onTextureReady`) redemandant alors
 * une image.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import {
  TEXTURE_TILE,
  allocateTexture,
  fillRows,
  type TextureData,
  type TextureKind,
} from "./proceduralTextures.js";

/** Durée maximale d'une tranche de génération (ms). */
export const SLICE_MS = 8;

export interface MaterialTextures {
  readonly kind: TextureKind;
  /** Couleur (sRGB). */
  readonly map: DataTexture;
  /** Rugosité (canal G, linéaire). */
  readonly roughnessMap: DataTexture;
  /** Motif généré (sinon : teinte unie provisoire). */
  ready: boolean;
}

interface Job {
  readonly data: TextureData;
  readonly textures: MaterialTextures;
  next: number;
}

const cache = new Map<string, MaterialTextures>();
const queue: Job[] = [];
const listeners = new Set<() => void>();
let running = false;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

function makeTexture(
  pixels: Uint8Array,
  size: number,
  srgb: boolean,
  kind: TextureKind,
  filtering: TextureFiltering,
) {
  const t = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = filtering.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  t.generateMipmaps = filtering.mipmaps;
  t.anisotropy = filtering.mipmaps ? filtering.anisotropy : 1;
  // UV en mètres (`grainUVs`) : un carreau couvre TEXTURE_TILE mètres.
  const tile = TEXTURE_TILE[kind];
  t.repeat.set(1 / tile.u, 1 / tile.v);
  t.name = `blondel-${kind}${srgb ? "" : "-roughness"}`;
  t.needsUpdate = true;
  return t;
}

/** Filtrage des textures (fixé à la création). */
export interface TextureFiltering {
  /** Mipmaps et filtrage trilinéaire ; sinon bilinéaire (moins d'accès mémoire). */
  readonly mipmaps: boolean;
  /** Filtrage anisotrope (1 = aucun), avec mipmaps seulement. */
  readonly anisotropy: number;
}

const DEFAULT_FILTERING: TextureFiltering = { mipmaps: true, anisotropy: 1 };

/** Planificateur de tranches (injectable dans les tests). */
export type Scheduler = (run: () => void) => void;

const defaultScheduler: Scheduler = (run) => {
  setTimeout(run, 0);
};

let schedule: Scheduler = defaultScheduler;

/** Remplace le planificateur (tests) ; sans argument, rétablit `setTimeout`. */
export function setTextureScheduler(s?: Scheduler): void {
  schedule = s ?? defaultScheduler;
}

function pump(): void {
  const t0 = now();
  while (queue.length > 0) {
    const job = queue[0]!;
    const { size } = job.data;
    // Au moins une ligne par tranche, pour progresser même sur une machine lente.
    do {
      fillRows(job.data, job.next, job.next + 8);
      job.next += 8;
    } while (job.next < size && now() - t0 < SLICE_MS);
    if (job.next >= size) {
      queue.shift();
      job.textures.map.needsUpdate = true;
      job.textures.roughnessMap.needsUpdate = true;
      job.textures.ready = true;
      for (const l of listeners) l();
    }
    if (now() - t0 >= SLICE_MS) break;
  }
  if (queue.length > 0) schedule(pump);
  else running = false;
}

/**
 * Textures du motif `kind` à la taille `size` (puissance de 2), créées et mises en génération à
 * la première demande, avec le filtrage `filtering` (fixé à la création : coûteux en rendu
 * logiciel).
 */
export function proceduralTextures(
  kind: TextureKind,
  size: number,
  filtering: TextureFiltering = DEFAULT_FILTERING,
): MaterialTextures {
  const key = `${kind}@${size}${filtering.mipmaps ? "m" : ""}${filtering.anisotropy}`;
  let t = cache.get(key);
  if (t) return t;
  const data = allocateTexture(kind, size);
  t = {
    kind,
    map: makeTexture(data.color, size, true, kind, filtering),
    roughnessMap: makeTexture(data.roughness, size, false, kind, filtering),
    ready: false,
  };
  cache.set(key, t);
  queue.push({ data, textures: t, next: 0 });
  if (!running) {
    running = true;
    schedule(pump);
  }
  return t;
}

/** S'abonne à la fin de génération d'une texture ; retourne le désabonnement. */
export function onTextureReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Toutes les textures demandées sont-elles générées ? */
export function texturesIdle(): boolean {
  return queue.length === 0;
}

/** Vide le cache (tests). */
export function resetTextureCache(): void {
  for (const t of cache.values()) {
    t.map.dispose();
    t.roughnessMap.dispose();
  }
  cache.clear();
  queue.length = 0;
  running = false;
}
