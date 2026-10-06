/**
 * Répartition des champs d'une section selon leur niveau (dictionnaire `lib/paramTiers.ts`) et
 * le mode d'affichage (`Display`) :
 *
 * - `main` : à la suite, dans l'ordre donné ;
 * - `more` : dans un `<details>` replié « Plus de réglages » ;
 * - `workshop` : dans un `<details>` replié « Réglages d'atelier » ;
 * - `hidden` : rien.
 *
 * Le résumé d'une zone repliée porte le compteur ◆ des champs « à valider » qu'elle contient.
 * En mode `all` (ancienne interface), tout est rendu à la suite, sans repli ni marque ajoutée :
 * le rendu est celui d'avant l'extraction des sections. En `free` et `guided`, un champ ◆ porte
 * la marque `.tv-mark` à côté de lui (élément `aria-hidden`, le nom accessible du champ ne
 * change pas). Un champ ◆ dont la valeur est validée (`Project.validatedValues`, ADR-0009
 * point 9) perd sa marque et n'est plus compté dans le compteur de son repli.
 *
 * Usage :
 *
 * ```tsx
 * const g: TieredGroup = { id: "flight", render: (c) => <fieldset>…{c}</fieldset> };
 * <Tiered display={display} items={[
 *   { key: "guards.flight.enabled", group: g, node: <CheckField … /> },
 *   cond ? { key: "guards.infill.spacing", node: <IntField … /> } : null,
 * ]} />
 * ```
 *
 * Un groupe (fieldset, poteau, supports…) est rendu dans chaque zone où il a des champs, à la
 * place de son premier champ dans cette zone. Un champ conditionnel n'est pas passé (`null`)
 * quand il ne s'applique pas. Une clé absente du dictionnaire est visible en `all` et `free`,
 * masquée dans le guidé.
 */
import { Fragment, type ReactNode } from "react";
import { useT } from "../../i18n/useT.js";
import {
  placementOf,
  tierEntry,
  type Display,
  type ParamTierEntry,
  type Placement,
} from "../../lib/paramTiers.js";
import { useValidatedKeys } from "../fabrication/useToValidate.js";
import "./sections.css";

/** Regroupement de champs (fieldset, sous-groupe repliable…) rendu par zone. */
export interface TieredGroup {
  /** Identifiant unique dans la section (clé React). */
  readonly id: string;
  /** Enveloppe des champs du groupe présents dans une zone. */
  readonly render: (children: ReactNode) => ReactNode;
}

export interface TieredItem {
  /** Clé du dictionnaire des niveaux (`paramKey`, `ui:…`). */
  readonly key: string;
  /** Clé React si plusieurs éléments partagent la même clé du dictionnaire (défaut : `key`). */
  readonly id?: string;
  /** Entrée imposée (paramètres de plugin : `structureParamEntry`) ; défaut : `tierEntry(key)`. */
  readonly entry?: ParamTierEntry;
  readonly group?: TieredGroup;
  readonly node: ReactNode;
}

/** Éléments d'une section : `null`, `false` ou `undefined` pour un champ qui ne s'applique pas. */
export type TieredItems = readonly (TieredItem | null | false | undefined)[];

/** Props communes des composants de section (réexportées par `sections/index.ts`). */
export interface SectionProps {
  readonly display: Display;
}

/** Mode « tout afficher » (ancienne interface). */
export const DISPLAY_ALL: Display = { kind: "all" };

function present(items: TieredItems): TieredItem[] {
  return items.filter((i): i is TieredItem => i !== null && i !== false && i !== undefined);
}

function entryOf(item: TieredItem): ParamTierEntry | undefined {
  return item.entry ?? tierEntry(item.key);
}

/** Emplacement d'un élément (clé hors dictionnaire : visible hors du guidé). */
export function tieredPlacement(item: TieredItem, display: Display): Placement {
  const e = entryOf(item);
  if (e !== undefined) return placementOf(e, display);
  return display.kind === "guided" ? "hidden" : "main";
}

/** Au moins un élément est-il affiché dans ce mode ? */
export function hasVisibleItems(items: TieredItems, display: Display): boolean {
  return present(items).some((i) => tieredPlacement(i, display) !== "hidden");
}

/** L'élément porte-t-il une valeur ◆ restante (non validée) ? */
function remainsToValidate(item: TieredItem, validated: ReadonlySet<string>): boolean {
  return entryOf(item)?.toValidate === true && !validated.has(item.key);
}

/**
 * Rendu d'une zone : éléments dans l'ordre, groupes à la place de leur premier élément.
 * `marks` : clés validées (marque ◆ sur les autres champs ◆), `null` : aucune marque.
 */
function renderZone(items: readonly TieredItem[], marks: ReadonlySet<string> | null): ReactNode[] {
  const out: ReactNode[] = [];
  const done = new Set<string>();
  const one = (i: TieredItem): ReactNode => {
    // Champ ◆ : repéré par `data-param` (lien « Ouvrir » de la liste des valeurs à valider,
    // `focusParamField`) ; marque ◆ tant qu'il n'est pas validé.
    const tv = marks !== null && entryOf(i)?.toValidate === true;
    const node = !tv ? (
      i.node
    ) : remainsToValidate(i, marks) ? (
      <div className="tiered__item tiered__item--tv" data-param={i.key}>
        {i.node}
        <span className="tv-mark tiered__mark" aria-hidden="true">
          ◆
        </span>
      </div>
    ) : (
      <div className="tiered__item" data-param={i.key}>
        {i.node}
      </div>
    );
    return <Fragment key={i.id ?? i.key}>{node}</Fragment>;
  };
  for (const i of items) {
    const g = i.group;
    if (g === undefined) {
      out.push(one(i));
      continue;
    }
    if (done.has(g.id)) continue;
    done.add(g.id);
    const members = items.filter((x) => x.group?.id === g.id);
    out.push(<Fragment key={`group:${g.id}`}>{g.render(members.map(one))}</Fragment>);
  }
  return out;
}

function Folded({
  kind,
  items,
  validated,
}: {
  kind: "more" | "workshop";
  items: readonly TieredItem[];
  validated: ReadonlySet<string>;
}) {
  const t = useT();
  const count = items.filter((i) => remainsToValidate(i, validated)).length;
  const label = t.t("ui.sections.toValidateCount", { count });
  return (
    <details className={`tiered__fold tiered__fold--${kind}`}>
      <summary>
        <span className="tiered__fold-title">
          {kind === "more" ? t.t("ui.sections.more") : t.t("ui.sections.workshop")}
        </span>
        {count > 0 ? (
          <span className="tiered__count" title={label}>
            <span className="tv-mark num" aria-hidden="true">
              ◆ {count}
            </span>
            <span className="visually-hidden">{label}</span>
          </span>
        ) : null}
      </summary>
      <div className="tiered__fold-body">{renderZone(items, validated)}</div>
    </details>
  );
}

/** Champs d'une section répartis par niveau (voir l'en-tête du module). */
export function Tiered({ display, items }: { display: Display; items: TieredItems }) {
  const validated = useValidatedKeys();
  const all = present(items);
  if (display.kind === "all") return <>{renderZone(all, null)}</>;
  const zone = (p: Placement): TieredItem[] => all.filter((i) => tieredPlacement(i, display) === p);
  const main = zone("main");
  const moreItems = zone("more");
  const workshopItems = zone("workshop");
  return (
    <>
      {renderZone(main, validated)}
      {moreItems.length > 0 ? <Folded kind="more" items={moreItems} validated={validated} /> : null}
      {workshopItems.length > 0 ? (
        <Folded kind="workshop" items={workshopItems} validated={validated} />
      ) : null}
    </>
  );
}
