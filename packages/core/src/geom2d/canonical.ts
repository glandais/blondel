/**
 * Départ canonique d'un contour : un sommet choisi sans dépendre du bruit d'arrondi des
 * coordonnées ni de l'ordre de départ des sommets (chantier `stable-tiebreaks`, F10 (7) et
 * (11)). Sert de critère secondaire aux départages « au premier dans l'ordre du contour ».
 */
import type { Vec2 } from "../model/primitives.js";

/**
 * Indice du sommet canonique : parmi les sommets d'abscisse minimale **à `eps` près**
 * (`x ≤ xmin + eps`), celui d'ordonnée minimale (le premier rencontré en cas d'égalité exacte).
 * Sur des données exactes, c'est le plus petit sommet dans l'ordre lexicographique (x, y),
 * départ de la chaîne monotone d'Andrew ; deux sommets d'un bord quasi vertical ne sont plus
 * départagés par le bruit de leurs abscisses. `-1` pour une liste vide.
 */
export function lowestVertexIndex(pts: readonly Vec2[], eps: number): number {
  let xmin = Infinity;
  for (const p of pts) if (p.x < xmin) xmin = p.x;
  let best = -1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.x > xmin + eps) continue;
    if (best < 0 || p.y < pts[best]!.y) best = i;
  }
  return best;
}

/** Copie du contour cyclique commencée à l'indice `start` (copie simple hors bornes). */
export function rotateToStart<T>(ring: readonly T[], start: number): T[] {
  if (start <= 0 || start >= ring.length) return [...ring];
  return [...ring.slice(start), ...ring.slice(0, start)];
}

/** Distance du point `p` au segment [a, b] (au point `a` si le segment est nul). */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/**
 * Retire d'un contour cyclique chaque sommet à au plus `eps` du segment joignant ses deux
 * voisins (sommet quasi aligné, ou quasi confondu avec un voisin), jusqu'à stabilité, sans
 * descendre sous 2 sommets. Un sommet de part et d'autre d'un tel seuil serait gardé ou retiré
 * selon le signe du bruit d'arrondi ; à `eps` près, il ne l'est plus. Le contour peut s'écarter
 * de plus de `eps` d'un sommet retiré seulement par des retraits en cascade, c.-à-d. pour une
 * suite de sommets dont chacun est à moins de `eps` de la corde de ses voisins : arc de rayon R
 * échantillonné au pas de √(8 · eps · R) ou moins (flèche ≤ `eps`), soit environ 0,09 mm pour
 * R = 1 m à `eps` = 1e-6 mm. Le contour rendu commence au sommet canonique du contour reçu (ou au
 * suivant, s'il a été retiré) : recalculer le départ après l'élagage. Limite : si deux sommets
 * quasi confondus sont tous deux candidats au départ canonique et ne diffèrent en y que du bruit,
 * le survivant (à au plus `eps` de l'autre) dépend encore du bruit.
 */
export function pruneFlatVertices<T extends Vec2>(ring: readonly T[], eps: number): T[] {
  // Parcours depuis le sommet canonique, et non depuis le premier sommet reçu : dans une paire
  // de sommets quasi confondus, le premier visité est retiré et l'autre reste ; si le départ
  // était le premier du tri exact (x, y) (chaîne monotone), le bruit d'un bord gauche quasi
  // vertical déciderait du survivant, et l'arête voisine s'inclinerait de jusqu'à eps / c rad
  // (assez pour retourner `minAreaRect` d'un demi-tour). L'ordre cyclique d'un contour convexe
  // ne dépend pas, lui, du bruit (sommets à plus du bruit les uns des autres), sauf entre
  // sommets quasi confondus (ordre de la chaîne monotone). La suite de sommets quasi confondus
  // (à ≤ `eps` de proche en proche) qui contient le sommet canonique est donc réduite d'abord,
  // sans dépendre de son ordre : le sommet canonique est retiré et le plus bas des autres
  // (`lowestVertexIndex`) reste ; pour une paire, c'est l'autre sommet, comme en la parcourant
  // depuis le sommet canonique. Sans cela, une cascade sur trois sommets (copies d'un même sommet
  // de part et d'autre d'un coin, dont le bruit choisit la canonique) garde le coin ou une copie.
  const n0 = ring.length;
  const c = lowestVertexIndex(ring, eps);
  const near = (i: number, j: number): boolean =>
    Math.hypot(ring[i]!.x - ring[j]!.x, ring[i]!.y - ring[j]!.y) <= eps;
  const run = new Set<number>(c < 0 ? [] : [c]);
  for (let i = c; run.size < n0 && near(i, (i + n0 - 1) % n0); i = (i + n0 - 1) % n0)
    run.add((i + n0 - 1) % n0);
  for (let i = c; run.size < n0 && near(i, (i + 1) % n0); i = (i + 1) % n0) run.add((i + 1) % n0);
  let out = rotateToStart(ring, c);
  if (run.size >= 2 && run.size < n0) {
    const others = [...run].filter((i) => i !== c);
    const pts = others.map((i) => ring[i]!);
    const keep = others[lowestVertexIndex(pts, eps)]!;
    out = rotateToStart([...ring.keys()], (c + 1) % n0)
      .filter((i) => i === keep || !run.has(i))
      .map((i) => ring[i]!);
  }
  let changed = true;
  while (changed && out.length >= 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length >= 3;) {
      const n = out.length;
      if (distanceToSegment(out[i]!, out[(i + n - 1) % n]!, out[(i + 1) % n]!) <= eps) {
        out.splice(i, 1);
        changed = true;
      } else i++;
    }
  }
  return out;
}
