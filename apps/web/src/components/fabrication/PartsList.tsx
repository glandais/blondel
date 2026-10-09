/**
 * Colonne de gauche du mode Fabrication (wireframe « Parcours libre · Fabrication ») : filtre
 * texte (repère, désignation, matériau, section) et pièces groupées par famille d'atelier
 * (`lib/partGroups.ts`). Chaque groupe montre son nom, son nombre de pièces et un résumé
 * « repères · matériau » ; déplié, un bouton par repère distinct (« ×n » s'il y a plusieurs
 * pièces) sélectionne la première pièce du repère (sélection partagée avec la 3D, la nomenclature
 * et l'inspecteur).
 *
 * Le groupe de la pièce sélectionnée est déplié d'office ; avec un filtre, seuls les groupes qui
 * ont des correspondances sont montrés, dépliés. Dépliage et filtre : état local au composant.
 *
 * Groupe « Visserie » (QUESTIONS A27), après les familles de pièces, seulement si le modèle a de
 * la visserie : une ligne par repère de visserie (lignes de la liste de visserie, `lib/fasteners`)
 * avec repère, désignation et quantité ; un clic sélectionne la première pièce de son assemblage
 * (sélection partagée), le titre de la ligne rappelle ses assemblages et ses pièces.
 */
import { fabricatedParts, type Model, type Part } from "@blondel/core";
import { msg } from "@blondel/i18n";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useT } from "../../i18n/useT.js";
import { fastenerRows, matchesFastenerFilter } from "../../lib/fasteners.js";
import {
  FASTENER_GROUP_ID,
  FASTENER_GROUP_KEY,
  PART_GROUP_KEYS,
  SUMMARY_SEPARATOR,
  groupPartCount,
  groupParts,
  groupSummary,
  marksSummary,
  matchesPartFilter,
  partGroupOf,
  type ListGroupId,
  type PartGroup,
} from "../../lib/partGroups.js";
import { selectedPart } from "../../lib/parts.js";
import { appStore, useApp } from "../../store/appStore.js";
import { Icon } from "../ui/Icon.js";
import "../fasteners.css";

/** Repère distinct d'un groupe : première pièce (sélectionnée au clic) et nombre de pièces. */
export interface MarkEntry {
  readonly mark: string;
  readonly first: Part;
  readonly count: number;
}

/** Repères distincts d'un groupe, dans l'ordre du modèle. */
export function markEntries(group: PartGroup): readonly MarkEntry[] {
  const byMark = new Map<string, { first: Part; count: number }>();
  for (const p of group.parts) {
    const e = byMark.get(p.mark);
    if (e) e.count += 1;
    else byMark.set(p.mark, { first: p, count: 1 });
  }
  return [...byMark].map(([mark, e]) => ({ mark, first: e.first, count: e.count }));
}

/**
 * Groupes dépliés : avec un filtre, tous les groupes montrés (ceux qui ont des correspondances) ;
 * sans filtre, le choix explicite de l'utilisateur (`toggled`), sinon le groupe de la pièce
 * sélectionnée.
 */
export function expandedGroups(
  groups: readonly { readonly id: ListGroupId }[],
  selectedGroup: ListGroupId | undefined,
  toggled: ReadonlyMap<ListGroupId, boolean>,
  filtering: boolean,
): ReadonlySet<ListGroupId> {
  return new Set(
    groups.map((g) => g.id).filter((id) => filtering || (toggled.get(id) ?? id === selectedGroup)),
  );
}

const select = (partId: string): void =>
  appStore.getState().select({ location: { kind: "part", partId } });

export function PartsList({ model }: { model: Pick<Model, "parts" | "fasteners"> }) {
  const t = useT();
  const baseId = useId();
  const selection = useApp((s) => s.selection);
  const [query, setQuery] = useState("");
  const [toggled, setToggled] = useState<ReadonlyMap<ListGroupId, boolean>>(new Map());
  const current = selectedPart(model, selection?.location);
  const filtering = query.trim() !== "";
  const groups = useMemo(
    () => groupParts(model.parts.filter((p) => matchesPartFilter(p, query, t))),
    [model.parts, query, t],
  );
  // Compte des groupes : pièces fabriquées seulement (sans double compte, QUESTIONS A36 (9)).
  const fabricated = useMemo(
    () => new Set(fabricatedParts(model.parts).map((p) => p.id)),
    [model.parts],
  );
  const allFasteners = useMemo(() => fastenerRows(model, t), [model, t]);
  const fasteners = allFasteners.filter((r) => matchesFastenerFilter(r, query));
  const fastenerGroup: { readonly id: ListGroupId } = { id: FASTENER_GROUP_ID };
  const listed: { readonly id: ListGroupId }[] = [
    ...groups,
    ...(fasteners.length > 0 ? [fastenerGroup] : []),
  ];
  const open = expandedGroups(
    listed,
    current ? partGroupOf(current) : undefined,
    toggled,
    filtering,
  );
  const toggle = (id: ListGroupId): void => setToggled((m) => new Map(m).set(id, !open.has(id)));
  const fastenerName = t.t(FASTENER_GROUP_KEY);
  const fastenersId = `${baseId}-${FASTENER_GROUP_ID}`;
  const fastenersOpen = open.has(FASTENER_GROUP_ID);
  const markOf = new Map(model.parts.map((p) => [p.id, p.mark]));

  return (
    <nav className="fab-list" aria-label={t.t("ui.fab.list.label")}>
      <input
        type="search"
        className="fab-list__filter"
        value={query}
        placeholder={t.t("ui.fab.list.filter.placeholder")}
        aria-label={t.t("ui.fab.list.filter.label")}
        onChange={(e) => setQuery(e.target.value)}
      />
      {listed.length === 0 && filtering ? (
        <p className="muted fab-list__empty" role="status">
          {t.t("ui.fab.list.noMatch")}
        </p>
      ) : null}
      <ul className="fab-list__groups">
        {groups.map((g) => {
          const expanded = open.has(g.id);
          const name = t.t(PART_GROUP_KEYS[g.id]);
          const marksId = `${baseId}-${g.id}`;
          const count = groupPartCount(g, fabricated);
          return (
            <li key={g.id} className="fab-group" data-group={g.id}>
              <button
                type="button"
                className="fab-group__head"
                aria-expanded={expanded}
                aria-controls={expanded ? marksId : undefined}
                onClick={() => toggle(g.id)}
              >
                <Icon icon={expanded ? ChevronDown : ChevronRight} size={14} />
                <span className="fab-group__name">{name}</span>
                <span
                  className="fab-group__count num"
                  title={t.t(msg("ui.fab.list.count", { count }))}
                >
                  {count}
                </span>
                <span className="fab-group__summary">{groupSummary(g, t)}</span>
              </button>
              {expanded ? (
                <ul
                  id={marksId}
                  className="fab-group__marks"
                  aria-label={t.t("ui.fab.list.marks", { group: name })}
                >
                  {markEntries(g).map((e) => {
                    const pressed = current?.mark === e.mark && partGroupOf(current) === g.id;
                    return (
                      <li key={e.mark}>
                        <button
                          type="button"
                          className="fab-mark"
                          aria-pressed={pressed}
                          title={t.t(e.first.name)}
                          onClick={() => select(e.first.id)}
                        >
                          <strong>{e.mark}</strong>
                          {e.count > 1 ? (
                            <span className="fab-mark__qty">
                              {t.t("ui.fab.list.quantity", { count: e.count })}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
        {fasteners.length > 0 ? (
          <li className="fab-group" data-group={FASTENER_GROUP_ID}>
            <button
              type="button"
              className="fab-group__head"
              aria-expanded={fastenersOpen}
              aria-controls={fastenersOpen ? fastenersId : undefined}
              onClick={() => toggle(FASTENER_GROUP_ID)}
            >
              <Icon icon={fastenersOpen ? ChevronDown : ChevronRight} size={14} />
              <span className="fab-group__name">{fastenerName}</span>
              <span
                className="fab-group__count num"
                title={t.t(msg("ui.bom.marks", { count: fasteners.length }))}
              >
                {fasteners.length}
              </span>
              <span className="fab-group__summary">
                {marksSummary(fasteners.map((r) => r.mark))}
              </span>
            </button>
            {fastenersOpen ? (
              <ul
                id={fastenersId}
                className="fab-group__marks fab-group__fasteners"
                aria-label={t.t("ui.fab.list.marks", { group: fastenerName })}
              >
                {fasteners.map((r) => {
                  const first = r.partIds.find((id) => markOf.has(id));
                  return (
                    <li key={r.mark}>
                      <button
                        type="button"
                        className="fab-fastener"
                        data-fastener={r.mark}
                        disabled={first === undefined}
                        title={t.t("ui.fab.fastener.title", {
                          joints: r.joints.join(SUMMARY_SEPARATOR),
                          parts: r.partMarks.join(SUMMARY_SEPARATOR),
                        })}
                        onClick={() => first !== undefined && select(first)}
                      >
                        <strong>{r.mark}</strong>
                        <span className="fab-fastener__name">{r.name}</span>
                        <span className="fab-mark__qty">
                          {t.t("ui.fab.list.quantity", { count: r.quantity })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
