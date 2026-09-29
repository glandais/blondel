/**
 * Onglet 3D : maillages de `@blondel/geometry` calculés avec le modèle dans le worker de calcul
 * (un `BufferGeometry` par empreinte de solide, libéré quand il n'est plus affiché), un
 * `MeshStandardMaterial` par matériau (bois, acier brut / peint / galvanisé, inox, verre),
 * garde-corps et mains courantes (balayages) compris ; dalle haute translucide percée de la
 * trémie, grille, lumières et ombres simples, surlignage de la pièce sélectionnée et marqueurs
 * du contrôle de conception (pièces teintées selon la sévérité, repères ponctuels).
 *
 * Repère : le cœur travaille en mm, Z vers le haut ; la scène three.js en mètres, Y vers le
 * haut → groupe racine tourné de −90° autour de X et mis à l'échelle 1/1000.
 *
 * Rendu logiciel (SwiftShader, llvmpipe : navigateur sans accélération matérielle) : sans
 * ombres portées ni haute densité, sinon chaque image bloque la page près d'une seconde
 * (`three/quality.ts`).
 *
 * Rendu à la demande (`frameloop="demand"`) : une image n'est dessinée que lorsqu'une prop de la
 * scène change ou que la caméra bouge (OrbitControls), et non 60 fois par seconde avec ombres
 * portées — la boucle continue occupait le GPU et le fil principal en permanence.
 *
 * Programmes de shaders compilés **avant** la première image (`ShaderWarmup`) : sans cela, la
 * première image attend la compilation et l'édition de liens de chaque programme (lecture
 * synchrone de `LINK_STATUS`), soit une tâche de 150 à 700 ms du fil principal à chaque
 * ouverture de l'onglet (mesure e2e, `apps/web/e2e/long-tasks.spec.ts`).
 */
import type { MaterialId, Model, Project, Severity } from "@blondel/core";
import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box3,
  DoubleSide,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import { SEVERITY_LABELS, isPartSelected, sameLocation } from "../lib/compliance.js";
import { controlMarkers, type PointMarker } from "../lib/markers.js";
import type { MeshSnapshot, MeshedPartData } from "../model/snapshot.js";
import type { Selection } from "../store/projectStore.js";
import { toBufferGeometry, upperSlabMesh } from "../three/geometry.js";
import { createGeometryPool, type GeometryPool } from "../three/geometryPool.js";
import { HIGHLIGHT_COLOR, SEVERITY_COLORS, materialLook } from "../three/materials.js";
import { browserRenderQuality } from "../three/quality.js";
import { warmUpShaders } from "../three/shaderWarmup.js";

const MM = 0.001;
/** Rayon des repères ponctuels du contrôle (mm, présentation). */
const POINT_MARKER_RADIUS = 45;

interface PartGeometry {
  readonly part: MeshedPartData["mesh"];
  /** Empreinte du solide. */
  readonly key: string;
  readonly geometry: BufferGeometry;
}

/**
 * Géométries des pièces : maillages calculés avec le modèle (worker de calcul), géométries
 * three.js partagées par empreinte de solide et libérées quand elles ne sont plus affichées.
 */
function usePartGeometries(mesh: MeshSnapshot | null): {
  parts: readonly PartGeometry[];
  failed: readonly MeshedPartData["mesh"][];
} {
  const pool = useRef<GeometryPool | null>(null);
  if (pool.current === null) pool.current = createGeometryPool();
  const geometries = useMemo(() => {
    const p = pool.current as GeometryPool;
    return (mesh?.parts ?? [])
      .filter((m) => m.mesh.mesh.indices.length > 0)
      .map((m) => ({ part: m.mesh, key: m.key, geometry: p.get(m.key, m.mesh.mesh) }));
  }, [mesh]);
  useEffect(() => {
    pool.current?.retain(geometries.map((g) => g.key));
  }, [geometries]);
  useEffect(() => () => pool.current?.disposeAll(), []);
  const failed = useMemo(
    () => (mesh?.parts ?? []).map((m) => m.mesh).filter((m) => m.error !== undefined),
    [mesh],
  );
  return { parts: geometries, failed };
}

interface Materials {
  get: (id: MaterialId) => MeshStandardMaterial;
  /** Matériau teinté d'une pièce en violation (couleur de la sévérité). */
  flagged: (id: MaterialId, severity: Severity) => MeshStandardMaterial;
  marker: (severity: Severity, selected: boolean) => MeshStandardMaterial;
  highlight: MeshStandardMaterial;
  slab: MeshStandardMaterial;
  sphere: SphereGeometry;
}

/** Matériaux partagés par identifiant, libérés au démontage de la vue. */
function useMaterials(): Materials {
  const value = useMemo(() => {
    const cache = new Map<string, MeshStandardMaterial>();
    const make = (id: MaterialId, severity?: Severity): MeshStandardMaterial => {
      const look = materialLook(id);
      const transparent = look.opacity !== undefined;
      return new MeshStandardMaterial({
        color: look.color,
        roughness: look.roughness,
        metalness: look.metalness,
        transparent,
        opacity: look.opacity ?? 1,
        // Verre : visible des deux côtés, sans masquer les pièces situées derrière.
        ...(transparent ? { depthWrite: false, side: DoubleSide } : {}),
        ...(severity ? { emissive: SEVERITY_COLORS[severity], emissiveIntensity: 0.55 } : {}),
      });
    };
    const cached = (key: string, create: () => MeshStandardMaterial): MeshStandardMaterial => {
      let m = cache.get(key);
      if (!m) {
        m = create();
        cache.set(key, m);
      }
      return m;
    };
    const highlight = new MeshStandardMaterial({
      color: HIGHLIGHT_COLOR,
      emissive: HIGHLIGHT_COLOR,
      emissiveIntensity: 0.35,
      roughness: 0.5,
    });
    const slab = new MeshStandardMaterial({
      color: "#9aa4ad",
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      side: DoubleSide,
    });
    const sphere = new SphereGeometry(POINT_MARKER_RADIUS, 20, 14);
    return {
      get: (id: MaterialId) => cached(id, () => make(id)),
      flagged: (id: MaterialId, severity: Severity) =>
        cached(`${id}|${severity}`, () => make(id, severity)),
      marker: (severity: Severity, selected: boolean) =>
        cached(`marker|${severity}|${selected}`, () => {
          const color = selected ? HIGHLIGHT_COLOR : SEVERITY_COLORS[severity];
          return new MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.6,
            roughness: 0.4,
          });
        }),
      highlight,
      slab,
      sphere,
      dispose: () => {
        [...cache.values(), highlight, slab].forEach((m) => m.dispose());
        sphere.dispose();
      },
    };
  }, []);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

function Slab({
  project,
  model,
  material,
}: {
  project: Project;
  model: Model;
  material: MeshStandardMaterial;
}) {
  const geometry = useMemo(() => {
    try {
      const mesh = upperSlabMesh(project, model.layout.footprint);
      return mesh ? toBufferGeometry(mesh) : undefined;
    } catch {
      return undefined; // trémie hors dalle ou auto-intersectante : dalle non affichée.
    }
  }, [project, model.layout.footprint]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} dispose={null} receiveShadow />;
}

/**
 * Compile les shaders de la scène (`warmUpShaders`), puis autorise le rendu (`onReady`) et
 * demande la première image. Monté en dernier enfant du `Canvas` : les objets de la scène y
 * sont déjà ajoutés quand l'effet s'exécute.
 */
function ShaderWarmup({ ready, onReady }: { ready: boolean; onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    const done = () => {
      if (alive) onReady();
    };
    // Échec ou contexte perdu (`compileAsync` n'aboutirait jamais) : le rendu reprend, quitte à
    // compiler à la volée.
    warmUpShaders(gl, scene, camera, () => alive).then(done, done);
    return () => {
      alive = false;
    };
  }, [gl, scene, camera, ready, onReady]);
  useEffect(() => {
    if (ready) invalidate();
  }, [ready, invalidate]);
  return null;
}

export interface Viewer3DProps {
  readonly model: Model;
  /** Maillage des pièces de `model` (calculé avec lui). */
  readonly mesh: MeshSnapshot | null;
  readonly project: Project;
  readonly selection: Selection | null;
  readonly onSelectPart: (partId: string | null) => void;
  /** Sélection d'un repère ponctuel du contrôle de conception. */
  readonly onSelectPoint: (marker: PointMarker) => void;
}

function PointMarkers({
  markers,
  materials,
  selection,
  onSelect,
}: {
  markers: readonly PointMarker[];
  materials: Materials;
  selection: Selection | null;
  onSelect: (m: PointMarker) => void;
}) {
  return (
    <>
      {markers.map((m, i) => {
        const selected =
          selection !== null &&
          selection.ruleId === m.ruleId &&
          sameLocation(selection.location, m.location);
        return (
          <mesh
            key={`${m.ruleId}-${i}`}
            geometry={materials.sphere}
            material={materials.marker(m.severity, selected)}
            position={[m.at.x, m.at.y, m.at.z]}
            dispose={null}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onSelect(m);
            }}
          />
        );
      })}
    </>
  );
}

export default function Viewer3D({
  model,
  mesh,
  project,
  selection,
  onSelectPart,
  onSelectPoint,
}: Viewer3DProps) {
  const { parts, failed } = usePartGeometries(mesh);
  const materials = useMaterials();
  const [showControls, setShowControls] = useState(true);
  const markers = useMemo(() => controlMarkers(model), [model]);
  const selectedMesh = parts.find(({ part }) =>
    isPartSelected(part.partId, selection?.location),
  )?.part;
  const selectedName = selectedMesh
    ? (model.parts.find((p) => p.id === selectedMesh.partId)?.name ?? "")
    : "";
  const selectedRules = selectedMesh ? markers.rulesByPart.get(selectedMesh.partId) : undefined;
  const flaggedCount = markers.parts.size + markers.points.length;
  const quality = useMemo(() => browserRenderQuality(), []);
  const [shadersReady, setShadersReady] = useState(false);
  const onShadersReady = useCallback(() => setShadersReady(true), []);

  // Cadrage initial sur l'ensemble des pièces (en mètres, repère three.js).
  const frame = useMemo(() => {
    const box = new Box3();
    for (const { geometry } of parts) if (geometry.boundingBox) box.union(geometry.boundingBox);
    if (box.isEmpty())
      box.set(new Vector3(0, 0, 0), new Vector3(1000, 1000, project.site.floorToFloor));
    const c = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length() * MM;
    const target: [number, number, number] = [c.x * MM, c.z * MM, -c.y * MM];
    const position: [number, number, number] = [
      target[0] + size * 0.9,
      target[1] + size * 0.7,
      target[2] + size * 1.1,
    ];
    return { target, position, size };
    // Cadrage calculé seulement au montage : l'utilisateur garde son point de vue.
  }, []);

  return (
    <div className="viewer3d">
      <Canvas
        // Ombres PCF : three.js (r18x) a retiré PCFSoftShadowMap, que `shadows` demande par
        // défaut, et la remplace à la volée par PCF — les programmes précompilés (type d'ombre
        // 2) ne servaient alors jamais et tout était recompilé dans la première image. Rendu
        // logiciel : ni ombres ni haute densité (`three/quality.ts`).
        shadows={quality.shadows ? "percentage" : false}
        dpr={quality.dpr}
        frameloop={shadersReady ? "demand" : "never"}
        camera={{ position: frame.position, fov: 40, near: 0.01, far: 200 }}
        onPointerMissed={() => onSelectPart(null)}
        aria-label="Vue 3D de l'escalier"
      >
        <hemisphereLight args={["#ffffff", "#8a8f99", 0.6]} />
        <ambientLight intensity={0.2} />
        <directionalLight
          position={[frame.target[0] + 4, frame.target[1] + 8, frame.target[2] + 5]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
          shadow-camera-near={0.1}
          shadow-camera-far={40}
          shadow-bias={-0.0005}
        />
        <group rotation={[-Math.PI / 2, 0, 0]} scale={MM}>
          {parts.map(({ part, geometry }) => {
            const selected = isPartSelected(part.partId, selection?.location);
            const severity = showControls ? markers.parts.get(part.partId) : undefined;
            const material = selected
              ? materials.highlight
              : severity
                ? materials.flagged(part.material, severity)
                : materials.get(part.material);
            return (
              <mesh
                key={part.partId}
                geometry={geometry}
                material={material}
                dispose={null}
                castShadow={materialLook(part.material).opacity === undefined}
                receiveShadow
                onClick={(e: ThreeEvent<MouseEvent>) => {
                  e.stopPropagation();
                  onSelectPart(part.partId);
                }}
              />
            );
          })}
          {showControls ? (
            <PointMarkers
              markers={markers.points}
              materials={materials}
              selection={selection}
              onSelect={onSelectPoint}
            />
          ) : null}
          <Slab project={project} model={model} material={materials.slab} />
        </group>
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[frame.target[0], -0.001, frame.target[2]]}
          receiveShadow
        >
          <planeGeometry args={[40, 40]} />
          <shadowMaterial opacity={0.18} />
        </mesh>
        <Grid
          args={[20, 20]}
          position={[frame.target[0], 0, frame.target[2]]}
          cellSize={0.1}
          sectionSize={1}
          cellColor="#9aa0a6"
          sectionColor="#6b7178"
          fadeDistance={25}
          infiniteGrid
        />
        <OrbitControls makeDefault target={frame.target} />
        <ShaderWarmup ready={shadersReady} onReady={onShadersReady} />
      </Canvas>
      <div className="viewer3d__controls">
        <label>
          <input
            type="checkbox"
            checked={showControls}
            onChange={(e) => setShowControls(e.target.checked)}
          />{" "}
          Contrôles sur les pièces
        </label>
        {showControls && flaggedCount > 0 ? (
          <ul className="viewer3d__legend" aria-label="Légende des contrôles">
            {(["bloquant", "avertissement", "conseil"] as const).map((sev) => (
              <li key={sev}>
                <span
                  className="viewer3d__swatch"
                  style={{ background: SEVERITY_COLORS[sev] }}
                  aria-hidden="true"
                />
                {SEVERITY_LABELS[sev]}
              </li>
            ))}
          </ul>
        ) : null}
        {showControls && flaggedCount === 0 ? (
          <span className="muted">Aucune violation localisée.</span>
        ) : null}
      </div>
      {selectedMesh ? (
        <p className="viewer3d__selected" role="status">
          Sélection : <strong>{selectedMesh.mark}</strong> — {selectedName}
          {selectedRules && selectedRules.length > 0 ? ` · ${selectedRules.join(", ")}` : ""}
        </p>
      ) : null}
      {parts.length === 0 ? (
        <p className="viewer3d__empty muted">
          {mesh ? "Aucune pièce à afficher (structure non renseignée)." : "Maillage indisponible."}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <ul className="viewer3d__errors" role="status">
          {failed.map((f) => (
            <li key={f.partId}>
              {f.mark} : {f.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
