/**
 * Onglet 3D : maillages de `@blondel/geometry` (un `BufferGeometry` par pièce, libéré à chaque
 * régénération), un `MeshStandardMaterial` par matériau, dalle haute translucide percée de la
 * trémie, grille, lumières et ombres simples, surlignage de la pièce sélectionnée.
 *
 * Repère : le cœur travaille en mm, Z vers le haut ; la scène three.js en mètres, Y vers le
 * haut → groupe racine tourné de −90° autour de X et mis à l'échelle 1/1000.
 */
import type { MaterialId, Model, Project } from "@blondel/core";
import { meshParts, type PartMesh } from "@blondel/geometry";
import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { Box3, DoubleSide, MeshStandardMaterial, Vector3, type BufferGeometry } from "three";
import { isPartSelected } from "../lib/compliance.js";
import type { Selection } from "../store/projectStore.js";
import { toBufferGeometry, upperSlabMesh } from "../three/geometry.js";
import { HIGHLIGHT_COLOR, materialLook } from "../three/materials.js";

const MM = 0.001;

interface PartGeometry {
  readonly part: PartMesh;
  readonly geometry: BufferGeometry;
}

/** Géométries des pièces, recréées quand les pièces changent et libérées ensuite. */
function usePartGeometries(model: Model): {
  parts: readonly PartGeometry[];
  failed: readonly PartMesh[];
} {
  const meshes = useMemo(() => meshParts(model.parts), [model.parts]);
  const geometries = useMemo(
    () =>
      meshes
        .filter((m) => m.mesh.indices.length > 0)
        .map((part) => ({ part, geometry: toBufferGeometry(part.mesh) })),
    [meshes],
  );
  useEffect(() => () => geometries.forEach((g) => g.geometry.dispose()), [geometries]);
  const failed = useMemo(() => meshes.filter((m) => m.error !== undefined), [meshes]);
  return { parts: geometries, failed };
}

/** Matériaux partagés par identifiant, libérés au démontage de la vue. */
function useMaterials(): {
  get: (id: MaterialId) => MeshStandardMaterial;
  highlight: MeshStandardMaterial;
  slab: MeshStandardMaterial;
} {
  const value = useMemo(() => {
    const cache = new Map<MaterialId, MeshStandardMaterial>();
    const get = (id: MaterialId): MeshStandardMaterial => {
      let m = cache.get(id);
      if (!m) {
        const look = materialLook(id);
        m = new MeshStandardMaterial({
          color: look.color,
          roughness: look.roughness,
          metalness: look.metalness,
          transparent: look.opacity !== undefined,
          opacity: look.opacity ?? 1,
        });
        cache.set(id, m);
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
    return {
      get,
      highlight,
      slab,
      dispose: () => [...cache.values(), highlight, slab].forEach((m) => m.dispose()),
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

export interface Viewer3DProps {
  readonly model: Model;
  readonly project: Project;
  readonly selection: Selection | null;
  readonly onSelectPart: (partId: string | null) => void;
}

export default function Viewer3D({ model, project, selection, onSelectPart }: Viewer3DProps) {
  const { parts, failed } = usePartGeometries(model);
  const materials = useMaterials();

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
        shadows
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
            return (
              <mesh
                key={part.partId}
                geometry={geometry}
                material={selected ? materials.highlight : materials.get(part.material)}
                dispose={null}
                castShadow
                receiveShadow
                onClick={(e: ThreeEvent<MouseEvent>) => {
                  e.stopPropagation();
                  onSelectPart(part.partId);
                }}
              />
            );
          })}
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
      </Canvas>
      {parts.length === 0 ? (
        <p className="viewer3d__empty muted">Aucune pièce à afficher (structure non renseignée).</p>
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
