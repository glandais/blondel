/**
 * Cadre « blueprint » du système Industry (ADR-0009) : filet de 1 px et repères « + » aux quatre
 * coins (classe globale `.blueprint` de styles.css). `Corners` rend les repères seuls, pour un
 * élément qui porte lui-même la classe (bouton primaire `.btn .btn-primary .blueprint`).
 */
import type { HTMLAttributes, ReactNode } from "react";

/** Les quatre repères de coin, décoratifs. */
export function Corners() {
  return (
    <>
      <i className="corner tl" aria-hidden="true" />
      <i className="corner tr" aria-hidden="true" />
      <i className="corner bl" aria-hidden="true" />
      <i className="corner br" aria-hidden="true" />
    </>
  );
}

export interface BlueprintProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "section" | "figure";
  readonly className?: string;
  readonly children?: ReactNode;
}

export function Blueprint({ as: Tag = "div", className, children, ...rest }: BlueprintProps) {
  return (
    <Tag {...rest} className={className ? `blueprint ${className}` : "blueprint"}>
      <Corners />
      {children}
    </Tag>
  );
}
