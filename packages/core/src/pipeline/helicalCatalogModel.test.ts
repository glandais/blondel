/**
 * `Model` figé du catalogue hélicoïdal (F10, sous-lot P3, correcteur) : reprend, sous forme
 * d'instantanés, la garantie que donnait `pipeline/helicalSwitch.parity.test.ts` (retiré en P3)
 * sur les formes synthétiques du catalogue (`helical-parity-cases-helpers.ts` : trémies, deux
 * tours, N = 60, palier qui recouvre, débord proche de r_i…), que `helicalOutputs.test.ts`
 * ne couvre pas (exemples, préréglage et démos seulement).
 *
 * - Par cas du catalogue, `buildModel(p, { memo: false })` résumé : erreurs et remarques, une
 *   ligne par pièce (repère, catégorie, empreinte à 1e-6 de la pièce entière, solide et
 *   développé compris), une ligne par résultat du contrôle (statut, sévérité, mesure, bornes,
 *   emplacement), et les empreintes de l'échappée et des sous-faces.
 * - Cas ajoutés pour la décision (8) : les deux exemples à limon central bois avec
 *   contremarches pleines (marches prolongées sous contremarche à Δθ usuel, sans coupure par la
 *   ligne du nez k + 2), et le cas CUT de `structures/woodCentralBeam.helicalCut.test.ts`.
 * - Cas d'erreur : `buildModel` ne lève pas et `Model.errors` porte la clé attendue.
 *
 * Enregistrés sur l'état P2 (5a1e407, copie hors dépôt), puis relus sur l'état P3 : seul écart,
 * les 14 marches prolongées (`tread-1` à `tread-14`) du cas CUT, construites depuis P3 avec la
 * coupe de la marche de base (décision (8)) ; justifié au journal du chantier. Mise à jour : `-u` ciblé sur ce fichier, jamais global,
 * justifié ligne à ligne au ledger.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Model } from "../model/derived.js";
import type { Project } from "../model/project.js";
import {
  HELICAL_PARITY_CASES,
  HELICAL_PARITY_ERROR_CASES,
  loadExample,
  withHelical,
  withStair,
} from "../layout/cage/helical-parity-cases-helpers.js";
import { buildModel } from "./build.js";

/** Nombres arrondis à 1e-6, −0 confondu avec 0, champs indéfinis omis. */
const r6 = (v: unknown): unknown =>
  typeof v === "number"
    ? Number.isFinite(v)
      ? Math.round(v * 1e6) / 1e6 + 0
      : String(v)
    : Array.isArray(v)
      ? v.map(r6)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .map(([k, x]) => [k, r6(x)]),
          )
        : v;

const sha = (v: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(r6(v)))
    .digest("hex")
    .slice(0, 16);

const j = (v: unknown): string => JSON.stringify(r6(v));

/**
 * Sous-faces de l'étape d'échappée (`Model.soffits`, décision (10a)). À l'enregistrement (état
 * P2), elles étaient lues aussi dans `Stepping.soffits`, depuis retiré : mêmes valeurs.
 */
const soffitsOf = (m: Model): unknown => m.soffits ?? [];

function modelSummary(m: Model): string {
  return [
    `errors ${j(m.errors)}`,
    `notes ${j(m.notes ?? [])}`,
    `headroom ${sha([m.headroom, m.headroomWidth, m.headroomAtNosings])}`,
    `soffits ${sha(soffitsOf(m))}`,
    `pièces ${m.parts.length}`,
    ...m.parts.map((p) => `pièce ${p.id} ${p.mark} ${p.category} ${sha(p)}`),
    `contrôle ${j(m.compliance.summary)}`,
    ...m.compliance.results.map(
      (r) =>
        `règle ${r.ruleId} ${r.status} ${r.severity} ${j({
          measured: r.measured,
          min: r.min,
          max: r.max,
          location: r.location,
        })}`,
    ),
  ].join("\n");
}

/** Décision (8) : limon central bois, contremarches pleines. */
const fullRisers = (name: string) => (): Project => {
  const p = loadExample(name);
  return withStair(p, { treads: { ...p.stair.treads, risers: "full" } });
};

const EXTRA: readonly { readonly name: string; readonly project: () => Project }[] = [
  {
    name: "(8) j5c-limon-central-bois-helicoidal, contremarches pleines",
    project: fullRisers("j5c-limon-central-bois-helicoidal"),
  },
  {
    name: "(8) demo-central-glulam, contremarches pleines",
    project: fullRisers("demo-central-glulam"),
  },
  {
    name: "(8) CUT : j5c bois, 60 marches par tour, débord 40, contremarches pleines",
    project: () => {
      const tuned = withHelical(loadExample("j5c-limon-central-bois-helicoidal"), {
        sweep: { mode: "treadsPerTurn", count: 60 },
      });
      return withStair(tuned, { treads: { ...tuned.stair.treads, nosing: 40, risers: "full" } });
    },
  },
];

describe("Model du catalogue hélicoïdal (F10, P3)", () => {
  it.each([...HELICAL_PARITY_CASES, ...EXTRA].map((c) => [c.name, c] as const))(
    "%s",
    (_name, c) => {
      const m = buildModel(c.project(), { memo: false });
      expect(modelSummary(m)).toMatchSnapshot();
    },
  );

  it.each(HELICAL_PARITY_ERROR_CASES.map((c) => [c.name, c] as const))(
    "erreur : %s",
    (_name, c) => {
      let m: Model | undefined;
      expect(() => {
        m = buildModel(c.project(), { memo: false });
      }).not.toThrow();
      expect(JSON.stringify(m!.errors)).toContain(c.key);
      expect(j(m!.errors)).toMatchSnapshot();
    },
  );
});
