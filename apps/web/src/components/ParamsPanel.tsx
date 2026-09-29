/**
 * Panneau de paramètres : édite le `Project` (site, tracé, découpage, balancement, marches,
 * structure, garde-corps, contexte de contrôle). Aucune valeur n'est calculée ici : les valeurs proposées au sortir
 * d'un mode automatique sont lues dans le modèle rendu par le cœur.
 */
import {
  RULE_TABLE,
  type InnerCorner,
  type Leg,
  type Opening,
  type Project,
  type Turn,
} from "@blondel/core";
import { useRef, type ReactNode } from "react";
import { appStore, useApp, useModel } from "../store/appStore.js";
import type { Path } from "../store/setIn.js";
import { addLeg, legAutoAllowed, removeLastLeg } from "../lib/layoutEdit.js";
import {
  LAYOUT_KIND_LABELS,
  layoutKindOf,
  switchLayoutKind,
  type LayoutKind,
} from "../lib/layoutKind.js";
import { AutoIntField, CheckField, IntField, SelectField, TextField } from "./fields.js";
import { GuardsSection } from "./GuardsSection.js";
import { HelicalEditor } from "./HelicalEditor.js";
import { StructureSection } from "./StructureSection.js";

const set = (path: Path) => (value: unknown) => appStore.getState().setField(path, value);
const update = (recipe: (p: Project) => Project, groupKey?: string) =>
  appStore.getState().update(recipe, groupKey);

function Section({
  title,
  children,
  open = true,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        <h2>{title}</h2>
      </summary>
      <div className="section__body">{children}</div>
    </details>
  );
}

// ------------------------------------------------------------------ Site

function SiteSection() {
  const site = useApp((s) => s.project.site);
  const layout = useApp((s) => s.project.stair.layout);
  const origin = useApp((s) => s.project.stair.placement.origin);
  // Dernière trémie retirée : restaurée si l'on réactive la trémie.
  const lastOpening = useRef<Opening | null>(null);
  const o = site.opening;
  return (
    <Section title="Site">
      <IntField
        label="Hauteur à monter H"
        hint="Sol fini bas → sol fini haut"
        value={site.floorToFloor}
        min={1}
        onCommit={set(["site", "floorToFloor"])}
      />
      <IntField
        label="Épaisseur du plancher haut"
        hint="Sol fini → sous-face"
        value={site.upperSlabThickness}
        min={1}
        onCommit={set(["site", "upperSlabThickness"])}
      />
      <IntField
        label="Revêtement du sol bas"
        value={site.lowerFinish}
        min={0}
        onCommit={set(["site", "lowerFinish"])}
      />
      <IntField
        label="Revêtement du sol haut"
        value={site.upperFinish}
        min={0}
        onCommit={set(["site", "upperFinish"])}
      />
      <CheckField
        label="Trémie dans le plancher haut"
        checked={o !== undefined}
        onCommit={(checked) => {
          if (!checked) {
            lastOpening.current = o ?? null;
            return set(["site", "opening"])(undefined);
          }
          // Valeur provisoire à ajuster par l'utilisateur (aucune règle n'est appliquée ici) :
          // carré de côté E au départ, ou carré circonscrit au cercle R_e d'un hélicoïdal.
          const r = layout.kind === "helical" ? layout.outerRadius : 0;
          const restored: Opening = lastOpening.current ?? {
            kind: "rect",
            x: layout.kind === "helical" ? Math.round(origin.x) - r : 0,
            y: layout.kind === "helical" ? Math.round(origin.y) - r : 0,
            sizeX: layout.kind === "helical" ? 2 * r : layout.width,
            sizeY: layout.kind === "helical" ? 2 * r : layout.width,
          };
          return set(["site", "opening"])(restored);
        }}
      />
      {o?.kind === "rect" ? (
        <fieldset className="grid-2">
          <legend>Trémie rectangulaire</legend>
          <IntField label="X (coin)" value={o.x} onCommit={set(["site", "opening", "x"])} />
          <IntField label="Y (coin)" value={o.y} onCommit={set(["site", "opening", "y"])} />
          <IntField
            label="Largeur (X)"
            value={o.sizeX}
            min={1}
            onCommit={set(["site", "opening", "sizeX"])}
          />
          <IntField
            label="Longueur (Y)"
            value={o.sizeY}
            min={1}
            onCommit={set(["site", "opening", "sizeY"])}
          />
        </fieldset>
      ) : null}
      {o?.kind === "polygon" ? (
        <p className="muted">
          Trémie polygonale ({o.points.length} sommets) : modifiable par import de fichier
          seulement.
        </p>
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------ Tracé

const INNER_KINDS = [
  { value: "sharp", label: "Angle vif" },
  { value: "arc", label: "Arrondi" },
  { value: "newel", label: "Poteau" },
] as const;

function TurnEditor({ turn, index }: { turn: Turn; index: number }) {
  const base: Path = ["stair", "layout", "turns", index];
  const inner = turn.inner;
  return (
    <fieldset className="turn">
      <legend>Tournant {index + 1}</legend>
      <SelectField
        label="Sens"
        value={turn.direction}
        options={[
          { value: "left", label: "À gauche" },
          { value: "right", label: "À droite" },
        ]}
        onCommit={set([...base, "direction"])}
      />
      <SelectField
        label="Type"
        value={turn.mode}
        options={[
          { value: "winders", label: "Marches balancées" },
          { value: "landing", label: "Palier" },
        ]}
        onCommit={set([...base, "mode"])}
      />
      <SelectField
        label="Jour"
        value={inner.kind}
        options={INNER_KINDS}
        onCommit={(kind) => {
          if (kind === inner.kind) return { ok: true };
          const size =
            inner.kind === "arc" ? inner.radius : inner.kind === "newel" ? inner.size : 100;
          const next: InnerCorner =
            kind === "sharp"
              ? { kind: "sharp" }
              : kind === "arc"
                ? { kind: "arc", radius: size }
                : { kind: "newel", size };
          return set([...base, "inner"])(next);
        }}
      />
      {inner.kind === "arc" ? (
        <IntField
          label="Rayon du jour"
          value={inner.radius}
          min={1}
          onCommit={set([...base, "inner", "radius"])}
        />
      ) : null}
      {inner.kind === "newel" ? (
        <IntField
          label="Côté du poteau"
          value={inner.size}
          min={1}
          onCommit={set([...base, "inner", "size"])}
        />
      ) : null}
    </fieldset>
  );
}

/**
 * Longueur proposée quand une volée quitte le mode automatique : longueur d'une autre volée
 * saisie, sinon reculement du modèle (escalier droit), sinon 1 mm (à saisir).
 */
function legFallback(legs: readonly Leg[], i: number, run: number | undefined): number {
  const other = legs.find((l, j) => j !== i && l.length !== "auto");
  if (other && other.length !== "auto") return other.length;
  return Math.max(1, Math.round(run ?? 1));
}

function LayoutSection() {
  const layout = useApp((s) => s.project.stair.layout);
  const walkline = useApp((s) => s.project.stair.walkline);
  const { model } = useModel();
  const legs = layout.legs;
  const kind = useApp((s) => layoutKindOf(s.project));
  return (
    <Section title="Tracé">
      <SelectField<LayoutKind>
        label="Type de tracé"
        value={kind}
        options={(["flights", "helical"] as const).map((k) => ({
          value: k,
          label: LAYOUT_KIND_LABELS[k],
        }))}
        hint="Changer de type remplace le tracé et la trémie (préréglage du cœur, annulable)"
        onCommit={(k) => {
          let note: string | undefined;
          const r = update((p) => {
            const s = switchLayoutKind(p, k);
            note = s.note;
            return s.project;
          });
          if (r.ok && note !== undefined)
            appStore.setState({ notice: { kind: "info", text: note } });
          return r;
        }}
      />
      {layout.kind === "helical" ? (
        <HelicalEditor layout={layout} />
      ) : (
        <IntField
          label="Emmarchement E"
          value={layout.width}
          min={1}
          onCommit={set(["stair", "layout", "width"])}
        />
      )}
      <SelectField
        label="Ligne de foulée"
        value={walkline.mode}
        options={[
          { value: "dtu", label: "Selon le DTU" },
          { value: "fromInner", label: "Distance au jour imposée" },
        ]}
        onCommit={(mode) =>
          set(["stair", "walkline"])(
            mode === "dtu"
              ? { mode: "dtu" }
              : {
                  mode: "fromInner",
                  distance: Math.max(1, Math.round(model?.layout.walklineOffset ?? 1)),
                },
          )
        }
      />
      {walkline.mode === "fromInner" ? (
        <IntField
          label="Distance au jour"
          value={walkline.distance}
          min={1}
          onCommit={set(["stair", "walkline", "distance"])}
        />
      ) : null}
      {layout.kind === "helical" ? null : (
        <FlightsEditor legs={legs} turns={layout.turns} run={model?.stepping.run} />
      )}
    </Section>
  );
}

function FlightsEditor({
  legs,
  turns,
  run,
}: {
  legs: readonly Leg[];
  turns: readonly Turn[];
  run: number | undefined;
}) {
  return (
    <>
      {legs.map((leg: Leg, i: number) => (
        <div key={i} className="leg">
          <AutoIntField
            label={`Volée ${i + 1} (bord extérieur)`}
            value={leg.length}
            fallback={legFallback(legs, i, run)}
            autoAllowed={legAutoAllowed(legs.length)}
            autoHint="Automatique : escalier droit seulement"
            min={1}
            onCommit={set(["stair", "layout", "legs", i, "length"])}
          />
          {i < turns.length ? <TurnEditor turn={turns[i] as Turn} index={i} /> : null}
        </div>
      ))}
      <div className="button-row">
        <button type="button" onClick={() => update(addLeg)}>
          Ajouter une volée
        </button>
        <button type="button" disabled={legs.length <= 1} onClick={() => update(removeLastLeg)}>
          Retirer la dernière volée
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Découpage

function SteppingSection() {
  const st = useApp((s) => s.project.stair.stepping);
  const helical = useApp((s) => s.project.stair.layout.kind === "helical");
  const { model } = useModel();
  return (
    <Section title="Découpage">
      <AutoIntField
        label="Nombre de hauteurs n"
        unit=""
        value={st.riserCount}
        fallback={model?.stepping.riserCount ?? 2}
        min={2}
        max={60}
        onCommit={set(["stair", "stepping", "riserCount"])}
      />
      <IntField
        label="Hauteur de marche cible"
        value={st.targetRise}
        min={1}
        onCommit={set(["stair", "stepping", "targetRise"])}
      />
      <AutoIntField
        label="Giron cible"
        value={st.targetGoing}
        fallback={Math.max(1, Math.round(model?.stepping.going ?? 1))}
        min={1}
        hint={
          helical
            ? "Sans effet sur un hélicoïdal (giron = rayon de la ligne de foulée × angle par marche)"
            : "Utilisé seulement pour une volée de longueur automatique"
        }
        onCommit={set(["stair", "stepping", "targetGoing"])}
      />
      <IntField
        label="Correction de la 1re hauteur"
        hint="Compensation de revêtement, signée"
        value={st.firstRiseOffset}
        onCommit={set(["stair", "stepping", "firstRiseOffset"])}
      />
    </Section>
  );
}

// ------------------------------------------------------------------ Balancement

function BalancingSection() {
  const b = useApp((s) => s.project.stair.balancing);
  const hasTurns = useApp((s) => s.project.stair.layout.turns.length > 0);
  const helical = useApp((s) => s.project.stair.layout.kind === "helical");
  return (
    <Section title="Balancement" open={hasTurns}>
      {!hasTurns ? (
        <p className="muted">
          {helical
            ? "Sans objet pour un hélicoïdal (marches rayonnantes, girons égaux)."
            : "Sans objet pour un escalier droit."}
        </p>
      ) : null}
      <SelectField
        label="Méthode"
        value={b.method}
        options={[
          { value: "M3", label: "M3 — développement du limon" },
          { value: "M1", label: "M1 — progression arithmétique" },
          { value: "M0", label: "M0 — sans balancement" },
        ]}
        onCommit={set(["stair", "balancing", "method"])}
      />
      <SelectField
        label="Variante M3"
        value={b.variant}
        options={[
          { value: "auto", label: "Automatique (selon la structure)" },
          { value: "cubic", label: "Cubique (C1)" },
          { value: "quintic", label: "Quintique (C2)" },
        ]}
        onCommit={set(["stair", "balancing", "variant"])}
      />
      <AutoIntField
        label="Marches balancées par côté"
        unit=""
        value={b.windersPerSide}
        fallback={1}
        min={1}
        max={8}
        onCommit={set(["stair", "balancing", "windersPerSide"])}
      />
      <IntField
        label="Collet cible (corde)"
        value={b.targetCollet}
        min={1}
        onCommit={set(["stair", "balancing", "targetCollet"])}
      />
    </Section>
  );
}

// ------------------------------------------------------------------ Marches

function TreadsSection() {
  const t = useApp((s) => s.project.stair.treads);
  return (
    <Section title="Marches">
      <IntField
        label="Épaisseur de marche"
        value={t.thickness}
        min={1}
        onCommit={set(["stair", "treads", "thickness"])}
      />
      <IntField
        label="Débord de nez"
        value={t.nosing}
        min={0}
        onCommit={set(["stair", "treads", "nosing"])}
      />
      <SelectField
        label="Contremarches"
        value={t.risers}
        options={[
          { value: "full", label: "Pleines" },
          { value: "open", label: "Ajourées" },
          { value: "none", label: "Aucune" },
        ]}
        onCommit={set(["stair", "treads", "risers"])}
      />
      {t.risers !== "none" ? (
        <IntField
          label="Épaisseur de contremarche"
          value={t.riserThickness}
          min={1}
          onCommit={set(["stair", "treads", "riserThickness"])}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------ Contrôle

/** Contextes déduits automatiquement par le moteur de règles (non saisis). */
const DEDUCED_CONTEXTS = new Set(["tous", "tournant"]);

function ComplianceSection() {
  const c = useApp((s) => s.project.compliance);
  const contexts = Object.entries(RULE_TABLE.contextes).filter(([k]) => !DEDUCED_CONTEXTS.has(k));
  return (
    <Section title="Contexte de contrôle" open={false}>
      <fieldset>
        <legend>Contextes</legend>
        {contexts.map(([key, description]) => (
          <CheckField
            key={key}
            label={key.replace(/_/g, " ")}
            title={description}
            checked={c.contexts.includes(key)}
            onCommit={(checked) =>
              set(["compliance", "contexts"])(
                checked ? [...c.contexts, key] : c.contexts.filter((x) => x !== key),
              )
            }
          />
        ))}
      </fieldset>
      <SelectField
        label="Profil"
        value={c.profile}
        options={[
          { value: "strict", label: "Strict" },
          { value: "souple", label: "Souple" },
        ]}
        onCommit={set(["compliance", "profile"])}
      />
      <TextField
        label="Date de référence (PC/DP ou marché)"
        type="date"
        value={c.referenceDate ?? ""}
        hint="Pilote le régime garde-corps"
        onCommit={(v) => set(["compliance", "referenceDate"])(v === "" ? undefined : v)}
      />
      {c.overrides.length > 0 ? (
        <p className="muted">{c.overrides.length} surcharge(s) de règle justifiée(s).</p>
      ) : null}
    </Section>
  );
}

export function ParamsPanel() {
  return (
    <div className="params">
      <SiteSection />
      <LayoutSection />
      <SteppingSection />
      <BalancingSection />
      <TreadsSection />
      <Section title="Structure">
        <StructureSection />
      </Section>
      <Section title="Garde-corps" open={false}>
        <GuardsSection />
      </Section>
      <ComplianceSection />
    </div>
  );
}
