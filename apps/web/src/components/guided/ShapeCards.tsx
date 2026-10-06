/**
 * Cartes de forme de l'étape « Forme » du parcours guidé (maquette 1a, spécification de contenu
 * § 2, étape 2) : droit, ¼ gauche, ¼ droite, U, S, ½ tournant, hélicoïdal. Choisir une carte
 * applique le tracé type du cœur à la hauteur, la dalle et l'emmarchement du projet
 * (`applyShape`), en une seule entrée d'historique ; la carte pressée est déduite des tournants
 * saisis (`pressedShapes`). Les pictogrammes sont des tracés schématiques fixes, décoratifs :
 * aucun calcul ici.
 */
import { PRESET_LABELS } from "@blondel/core";
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import { useMemo, type JSX } from "react";
import { listMessages } from "../../i18n/text.js";
import { useT } from "../../i18n/useT.js";
import {
  SHAPE_IDS,
  SHAPE_PRESETS,
  applyShape,
  pressedShapes,
  type ShapeId,
} from "../../lib/layoutKind.js";
import { appStore, useApp } from "../../store/appStore.js";
import { ChoiceCards, type ChoiceCard } from "../ui/ChoiceCards.js";

/** Libellés courts des cartes (le nom complet est celui du préréglage, en infobulle). */
export const SHAPE_LABELS: Readonly<Record<ShapeId, MessageKey>> = {
  straight: "ui.guided.cards.shape.straight",
  "quarter-left": "ui.guided.cards.shape.quarterLeft",
  "quarter-right": "ui.guided.cards.shape.quarterRight",
  u: "ui.guided.cards.shape.u",
  s: "ui.guided.cards.shape.s",
  "half-turn": "ui.guided.cards.shape.halfTurn",
  helical: "ui.guided.cards.shape.helical",
};

/** Contours schématiques vus en plan (départ en bas, montée vers le haut), viewBox 40 × 40. */
const SHAPE_PATHS: Readonly<Record<Exclude<ShapeId, "helical">, string>> = {
  straight: "M15 37V3h10v34z",
  "quarter-left": "M27 37V5H3v10h14v22z",
  "quarter-right": "M13 37V5h24v10H23v22z",
  u: "M37 37V3H3v34h10V13h14v24z",
  s: "M35 38V20H18V2H8v26h17v10z",
  "half-turn": "M37 37V3H3v34h14V11h6v26z",
};

function ShapeIcon({ shape }: { shape: ShapeId }): JSX.Element {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape === "helical" ? (
        <>
          <circle cx="20" cy="20" r="17" />
          <circle cx="20" cy="20" r="3" />
          <path d="M20 3v14M37 20H23M20 37V23M3 20h14M8 8l10 10M32 8L22 18" />
        </>
      ) : (
        <path d={SHAPE_PATHS[shape]} />
      )}
    </svg>
  );
}

export function ShapeCards(): JSX.Element {
  const t = useT();
  const project = useApp((s) => s.project);
  const pressed = useMemo(() => pressedShapes(project), [project]);
  const cards: ChoiceCard<ShapeId>[] = SHAPE_IDS.map((id) => ({
    value: id,
    label: t.t(SHAPE_LABELS[id]),
    title: t.t(PRESET_LABELS[SHAPE_PRESETS[id]]),
    icon: <ShapeIcon shape={id} />,
  }));
  const onChoose = (id: ShapeId): void => {
    // Forme déjà retenue (seule à correspondre au projet) : rien à faire.
    if (pressed.has(id) && pressed.size === 1) return;
    let note: Message | undefined;
    // Préréglage impossible (RangeError du cœur) : refusé par `update`, projet inchangé, message
    // du cœur en notice d'erreur.
    const r = appStore.getState().update((p) => {
      const s = applyShape(p, id);
      note = s.note;
      return s.project;
    });
    if (!r.ok) {
      appStore.setState({
        notice: { kind: "error", msg: listMessages(r.issues) ?? msg("ui.common.input.refused") },
      });
    } else if (note !== undefined) {
      appStore.setState({ notice: { kind: "info", msg: note } });
    }
  };
  return (
    <ChoiceCards
      label={t.t("ui.guided.cards.shape.group")}
      cards={cards}
      isPressed={(id) => pressed.has(id)}
      onChoose={onChoose}
      columns={4}
    />
  );
}
