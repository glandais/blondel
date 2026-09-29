/**
 * Surimpression 2D de la vue 3D (jalon 6) : cotes principales et mesure, dessinées en SVG
 * au-dessus du canevas. Aucune géométrie three.js supplémentaire (donc aucun programme de
 * shaders à compiler : pas de tâche longue) ; les points sont projetés à chaque image rendue
 * (`AnnotationProjector`, monté dans le `Canvas`).
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import { Vector3 } from "three";
import { polylineMidpoint, type Annotation } from "../three/annotations.js";
import { toSceneVector } from "../three/section.js";

const MM = 0.001;

export function AnnotationOverlay({
  annotations,
  svgRef,
}: {
  annotations: readonly Annotation[];
  svgRef: RefObject<SVGSVGElement | null>;
}) {
  return (
    <svg className="viewer3d__overlay" ref={svgRef} aria-hidden="true">
      {annotations.map((a) => (
        <g key={a.id} data-annotation={a.id} className={`viewer3d__annotation--${a.kind}`}>
          <polyline fill="none" />
          <circle r={3} data-end="a" />
          <circle r={3} data-end="b" />
          {a.label ? <text textAnchor="middle">{a.label}</text> : null}
        </g>
      ))}
    </svg>
  );
}

/** Projette les annotations à chaque image rendue ; redemande une image quand elles changent. */
export function AnnotationProjector({
  annotations,
  svgRef,
}: {
  annotations: readonly Annotation[];
  svgRef: RefObject<SVGSVGElement | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const v = useRef(new Vector3());
  useEffect(() => {
    invalidate();
  }, [annotations, invalidate]);
  useFrame(({ camera, size }) => {
    const svg = svgRef.current;
    if (!svg) return;
    const project = (p: { x: number; y: number; z: number }): [number, number] | null => {
      const [x, y, z] = toSceneVector(p);
      v.current.set(x * MM, y * MM, z * MM).project(camera);
      if (v.current.z > 1 || v.current.z < -1) return null;
      return [((v.current.x + 1) / 2) * size.width, ((1 - v.current.y) / 2) * size.height];
    };
    for (const a of annotations) {
      const g = svg.querySelector<SVGGElement>(`[data-annotation="${a.id}"]`);
      if (!g) continue;
      const pts = a.points.map(project);
      if (pts.some((p) => p === null)) {
        g.style.display = "none";
        continue;
      }
      g.style.display = "";
      const xy = pts as [number, number][];
      g.querySelector("polyline")?.setAttribute("points", xy.map((p) => p.join(",")).join(" "));
      const ends = g.querySelectorAll("circle");
      const first = xy[0]!;
      const last = xy[xy.length - 1]!;
      ends[0]?.setAttribute("cx", String(first[0]));
      ends[0]?.setAttribute("cy", String(first[1]));
      ends[1]?.setAttribute("cx", String(last[0]));
      ends[1]?.setAttribute("cy", String(last[1]));
      const text = g.querySelector("text");
      if (text) {
        const m = project(polylineMidpoint(a.points));
        if (m) {
          text.setAttribute("x", String(m[0]));
          text.setAttribute("y", String(m[1] - 6));
        }
      }
    }
  });
  return null;
}
