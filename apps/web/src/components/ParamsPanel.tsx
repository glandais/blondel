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
  flightsTypologyLabel,
  hasOppositeTurns,
  layoutKindOf,
  switchLayoutKind,
  withTurnSequence,
  type LayoutKind,
  type TurnSequence,
} from "../lib/layoutKind.js";
import { balancingMethodOptions, herseAngleRange, rotationRanges } from "../lib/balancingForm.js";
import {
  AutoIntField,
  CheckField,
  IntField,
  RangeField,
  SelectField,
  TextField,
} from "./fields.js";
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
          Trémie polygonale ({o.points.length} sommets) : à retracer ou relever dans Plan 2D › «
          Site et saisie ».
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
        <>
          <IntField
            label="Côté du poteau"
            value={inner.size}
            min={1}
            onCommit={set([...base, "inner", "size"])}
          />
          <IntField
            label="Décalage du poteau vers le jour"
            value={inner.offset ?? 0}
            min={0}
            hint="0 : poteau centré sur l'angle du jour ; poteau élargi des profilés décalé vers le jour"
            onCommit={set([...base, "inner", "offset"])}
          />
        </>
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
          {...(layout.kind !== "helical" && hasOppositeTurns(layout.turns)
            ? { hint: "Mesurée depuis le jour du tournant le plus proche (S / Z)" }
            : {})}
          onCommit={set(["stair", "walkline", "distance"])}
        />
      ) : null}
      {layout.kind === "helical" ? null : (
        <>
          <TypologyInfo turns={layout.turns} transitions={transitionsOf(model)} />
          <FlightsEditor legs={legs} turns={layout.turns} run={model?.stepping.run} />
        </>
      )}
    </Section>
  );
}

interface TransitionInfo {
  readonly leg: number;
  readonly angle: number;
}

/** Transitions de la ligne de foulée d'un tracé S / Z (vides ailleurs), lues dans le modèle. */
function transitionsOf(
  model: { readonly layout: { readonly walklineTransitions?: readonly TransitionInfo[] } } | null,
): readonly TransitionInfo[] {
  return model?.layout.walklineTransitions ?? [];
}

const deg = (rad: number): string =>
  ((rad * 180) / Math.PI).toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/**
 * Typologie du tracé à volées (déduite des tournants) et enchaînement des deux premiers
 * tournants : même sens (U) ou sens opposés (S / Z).
 */
function TypologyInfo({
  turns,
  transitions,
}: {
  turns: readonly Turn[];
  transitions: readonly TransitionInfo[];
}) {
  const opposite = hasOppositeTurns(turns);
  return (
    <div className="typology">
      <p className="typology__label">
        Typologie : <strong>{flightsTypologyLabel(turns)}</strong>
      </p>
      {turns.length >= 2 ? (
        <SelectField<TurnSequence>
          label="Enchaînement des tournants 1 et 2"
          value={turns[0]!.direction === turns[1]!.direction ? "same" : "opposite"}
          options={[
            { value: "same", label: "Même sens (U, demi-tournant)" },
            { value: "opposite", label: "Sens opposés (S / Z)" },
          ]}
          hint="Garde le sens du premier tournant"
          onCommit={(seq) => update((p) => withTurnSequence(p, seq))}
        />
      ) : null}
      {opposite ? (
        <p className="muted typology__note">
          Tournants de sens opposés : le jour change de côté ; la ligne de foulée passe d'un côté à
          l'autre dans la volée intermédiaire, qui doit garder au moins un giron de partie droite.
          {transitions.map((t) => (
            <span key={t.leg}>
              {" "}
              Volée {t.leg + 1} : ligne de foulée oblique de {deg(t.angle)}° (profondeur entre nez
              réduite à g·cos θ).
            </span>
          ))}
        </p>
      ) : null}
    </div>
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
  const { model } = useModel();
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
        options={balancingMethodOptions()}
        onCommit={set(["stair", "balancing", "method"])}
      />
      {b.method === "M3" ? (
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
      ) : null}
      {b.method === "M2" ? <HerseControls model={model} /> : null}
      {b.method === "M6" ? <RotationControls /> : null}
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

/** Valeur d'un curseur de balancement (geste continu : une entrée d'historique). */
const setBalancing =
  (key: "herseAngle" | "rotationReach" | "rotationSteepness") =>
  (value: number, groupKey: string) =>
    appStore
      .getState()
      .update(
        (p) => ({ ...p, stair: { ...p.stair, balancing: { ...p.stair.balancing, [key]: value } } }),
        groupKey,
        { sticky: true },
      );

/** Retire la valeur saisie : le cœur reprend sa valeur par défaut. */
const resetBalancing = (key: "herseAngle" | "rotationReach" | "rotationSteepness") => () =>
  update((p) => {
    const { [key]: _removed, ...balancing } = p.stair.balancing;
    return { ...p, stair: { ...p.stair, balancing } };
  });

function HerseControls({ model }: { model: ReturnType<typeof useModel>["model"] }) {
  const b = useApp((s) => s.project.stair.balancing);
  const r = herseAngleRange(b, model);
  return (
    <RangeField
      label="Angle α de la herse"
      unit="°"
      value={r.value}
      min={r.min}
      max={r.max}
      step={r.step}
      isDefault={r.isDefault}
      hint={
        r.modelBound !== null
          ? `Borné à ]0 ; ${r.modelBound.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}°[ par la zone retenue (au-delà, collets croissants vers l'angle)`
          : "Borne de la zone indisponible (aucune zone M2 retenue) : réduire α si le découpage échoue"
      }
      onChange={setBalancing("herseAngle")}
      onReset={resetBalancing("herseAngle")}
    />
  );
}

function RotationControls() {
  const b = useApp((s) => s.project.stair.balancing);
  const { reach, steepness } = rotationRanges(b);
  return (
    <>
      <RangeField
        label="Portée λ de la rotation"
        unit="girons"
        value={reach.value}
        min={reach.min}
        max={reach.max}
        step={reach.step}
        isDefault={reach.isDefault}
        hint="Défaut du cœur à valider (sans source)"
        onChange={setBalancing("rotationReach")}
        onReset={resetBalancing("rotationReach")}
      />
      <RangeField
        label="Raideur p de la rotation"
        value={steepness.value}
        min={steepness.min}
        max={steepness.max}
        step={steepness.step}
        isDefault={steepness.isDefault}
        hint="Défaut du cœur à valider (sans source)"
        onChange={setBalancing("rotationSteepness")}
        onReset={resetBalancing("rotationSteepness")}
      />
    </>
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
