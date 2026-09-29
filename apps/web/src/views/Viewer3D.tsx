/**
 * Onglet 3D : maillages de `@blondel/geometry` calculés avec le modèle dans le worker de calcul
 * (un `BufferGeometry` par empreinte de solide et sens du fil, libéré quand il n'est plus
 * affiché), matériaux PBR par matériau du cœur (`three/pbr.ts` : bois à veinage procédural
 * orienté selon le fil de chaque pièce, acier brut / peint / galvanisé, inox brossé, verre,
 * béton), garde-corps et mains courantes (balayages) compris ; dalle haute translucide percée de
 * la trémie, grille, éclairage d'ambiance procédural (`RoomEnvironment`), ombres, surlignage de
 * la pièce sélectionnée et marqueurs du contrôle de conception (pièces teintées selon la
 * sévérité, repères ponctuels).
 *
 * Outils (jalon 6, `Viewer3DTools`) : vue éclatée (`three/explode.ts`), plan de coupe
 * (`three/section.ts`), mesure point à point (clic sur les pièces), isolation de la pièce
 * sélectionnée, cotes principales H / E / reculement en surimpression (`Viewer3DOverlay`),
 * apparence par famille de pièces (`lib/appearance.ts`, aperçu de rendu seulement), dans une
 * barre d'outils 3D.
 *
 * Repère : le cœur travaille en mm, Z vers le haut ; la scène three.js en mètres, Y vers le
 * haut → groupe racine tourné de −90° autour de X et mis à l'échelle 1/1000.
 *
 * Rendu logiciel (SwiftShader, llvmpipe : navigateur sans accélération matérielle) : sans
 * ombres portées, environnement, matériaux physiques ni haute densité, textures réduites, sinon
 * chaque image bloque la page près d'une seconde (`three/quality.ts`).
 *
 * Rendu à la demande (`frameloop="demand"`) : une image n'est dessinée que lorsqu'une prop de la
 * scène change, que la caméra bouge (OrbitControls) ou qu'une texture procédurale est prête.
 *
 * Programmes de shaders compilés **avant** la première image (`ShaderWarmup`) : sans cela, la
 * première image attend la compilation et l'édition de liens de chaque programme (lecture
 * synchrone de `LINK_STATUS`), soit une tâche de 150 à 700 ms du fil principal à chaque
 * ouverture de l'onglet (mesure e2e, `apps/web/e2e/long-tasks.spec.ts`). Pour la même raison,
 * le plan de coupe est toujours attaché aux matériaux (désactivé = rejeté au loin) et les cotes
 * et mesures sont dessinées en SVG, sans nouveau programme.
 */
import type { MaterialId, Model, Project, Severity, Vec3 } from "@blondel/core";
import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Box3,
  BufferAttribute,
  BufferGeometry as ThreeBufferGeometry,
  DoubleSide,
  NeutralToneMapping,
  PMREMGenerator,
  Plane,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { displayedMaterial, familiesOf, withAppearance } from "../lib/appearance.js";
import { isPartSelected, sameLocation } from "../lib/compliance.js";
import { controlMarkers, type PointMarker } from "../lib/markers.js";
import type { MeshSnapshot, MeshedPartData } from "../model/snapshot.js";
import { appStore, useApp } from "../store/appStore.js";
import type { Selection } from "../store/projectStore.js";
import {
  mainDimensions,
  measureAnnotation,
  pickPoint,
  pickedToMeasure,
  type Annotation,
  type PickedPoint,
} from "../three/annotations.js";
import { explodeOffsets } from "../three/explode.js";
import { toBufferGeometry, upperSlabMesh } from "../three/geometry.js";
import { createGeometryPool, geometryKey, type GeometryPool } from "../three/geometryPool.js";
import { HIGHLIGHT_COLOR, SEVERITY_COLORS } from "../three/materials.js";
import {
  createPartMaterial,
  isTranslucent,
  simpleMaterial,
  type PartMaterial,
} from "../three/pbr.js";
import { browserRenderQuality, type RenderQuality } from "../three/quality.js";
import {
  NO_SECTION,
  isClippedInScene,
  sectionPlane,
  signedDistance,
  type SectionPlane,
} from "../three/section.js";
import { warmUpShaders } from "../three/shaderWarmup.js";
import { onTextureReady } from "../three/textures.js";
import { AnnotationOverlay, AnnotationProjector } from "./Viewer3DOverlay.js";
import { INITIAL_TOOLS, Viewer3DTools, type ToolsState } from "./Viewer3DTools.js";
import "./Viewer3D.css";

const MM = 0.001;
/** Rayon des repères ponctuels du contrôle (mm, présentation). */
const POINT_MARKER_RADIUS = 45;
/** Propriétés du moteur de rendu (constantes : appliquées une fois par react-three-fiber). */
const GL_PROPS = {
  toneMapping: NeutralToneMapping,
  toneMappingExposure: 0.9,
  localClippingEnabled: true,
} as const;
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

interface PartGeometry {
  readonly part: MeshedPartData["mesh"];
  /** Empreinte du solide et sens du fil. */
  readonly key: string;
  readonly geometry: BufferGeometry;
  /** Centre de la boîte englobante (mm, repère du cœur). */
  readonly center: Vec3;
}

/**
 * Géométries des pièces : maillages calculés avec le modèle (worker de calcul), géométries
 * three.js (UV selon le fil de la pièce) partagées par empreinte et libérées quand elles ne sont
 * plus affichées.
 */
function usePartGeometries(
  mesh: MeshSnapshot | null,
  model: Model,
): {
  parts: readonly PartGeometry[];
  failed: readonly MeshedPartData["mesh"][];
} {
  const pool = useRef<GeometryPool | null>(null);
  if (pool.current === null) pool.current = createGeometryPool();
  const grains = useMemo(() => {
    const m = new Map<string, Vec3 | undefined>();
    for (const p of model.parts) m.set(p.id, p.grain);
    return m;
  }, [model]);
  const geometries = useMemo(() => {
    const p = pool.current as GeometryPool;
    return (mesh?.parts ?? [])
      .filter((m) => m.mesh.mesh.indices.length > 0)
      .map((m) => {
        const grain = grains.get(m.mesh.partId);
        const key = geometryKey(m.key, grain);
        const geometry = p.get(key, m.mesh.mesh, grain);
        const c = geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
        return { part: m.mesh, key, geometry, center: { x: c.x, y: c.y, z: c.z } };
      });
  }, [mesh, grains]);
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

type SimpleMaterial = ReturnType<typeof simpleMaterial>;

interface Materials {
  get: (id: MaterialId) => PartMaterial;
  /** Matériau teinté d'une pièce en violation (couleur de la sévérité). */
  flagged: (id: MaterialId, severity: Severity) => PartMaterial;
  marker: (severity: Severity, selected: boolean) => SimpleMaterial;
  highlight: SimpleMaterial;
  slab: SimpleMaterial;
  sphere: SphereGeometry;
  /** Plan de coupe partagé par les matériaux des pièces et de la dalle. */
  clip: Plane;
}

/** Matériaux partagés par identifiant, libérés au démontage de la vue (textures en cache). */
function useMaterials(quality: RenderQuality): Materials {
  const value = useMemo(() => {
    const clip = new Plane(new Vector3(...NO_SECTION.normal), NO_SECTION.constant);
    // Plan toujours attaché (programmes stables), seulement pour la coupe exacte.
    const clipped = <M extends Material>(m: M): M => {
      if (!quality.clipping) return m;
      m.clippingPlanes = [clip];
      m.clipShadows = true;
      return m;
    };
    const cache = new Map<string, Material>();
    const cached = <M extends Material>(key: string, create: () => M): M => {
      let m = cache.get(key) as M | undefined;
      if (!m) {
        m = create();
        cache.set(key, m);
      }
      return m;
    };
    const highlight = clipped(
      simpleMaterial(
        {
          color: HIGHLIGHT_COLOR,
          emissive: HIGHLIGHT_COLOR,
          emissiveIntensity: 0.35,
          roughness: 0.5,
        },
        quality,
      ),
    );
    const slab = clipped(
      simpleMaterial(
        {
          color: "#9aa4ad",
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
          side: DoubleSide,
        },
        quality,
      ),
    );
    const sphere = new SphereGeometry(POINT_MARKER_RADIUS, 20, 14);
    return {
      get: (id: MaterialId) => cached(id, () => clipped(createPartMaterial(id, quality))),
      flagged: (id: MaterialId, severity: Severity) =>
        cached(`${id}|${severity}`, () => clipped(createPartMaterial(id, quality, { severity }))),
      marker: (severity: Severity, selected: boolean) =>
        cached(`marker|${severity}|${selected}`, () => {
          const color = selected ? HIGHLIGHT_COLOR : SEVERITY_COLORS[severity];
          return simpleMaterial(
            { color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 },
            quality,
          );
        }),
      highlight,
      slab,
      sphere,
      clip,
      dispose: () => {
        [...cache.values(), highlight, slab].forEach((m) => m.dispose());
        sphere.dispose();
      },
    };
  }, [quality]);
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
  material: SimpleMaterial;
}) {
  const geometry = useMemo(() => {
    try {
      const mesh = upperSlabMesh(project, model.layout.footprint);
      return mesh ? toBufferGeometry(mesh, null) : undefined;
    } catch {
      return undefined; // trémie hors dalle ou auto-intersectante : dalle non affichée.
    }
  }, [project, model.layout.footprint]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} dispose={null} receiveShadow />;
}

/**
 * Environnement d'éclairage procédural (pièce neutre `RoomEnvironment` préfiltrée par PMREM),
 * posé **avant** la compilation des shaders (effet de mise en page, antérieur aux effets
 * passifs de `ShaderWarmup`) : la présence d'un environnement fait partie des programmes.
 */
function SceneEnvironment({ enabled }: { enabled: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    if (!enabled) return;
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = 0.6;
    return () => {
      if (scene.environment === env) scene.environment = null;
      env.dispose();
    };
  }, [enabled, gl, scene]);
  return null;
}

/**
 * Triangle dégénéré (aire nulle, rien n'est tracé) portant un matériau utilisé plus tard
 * (surlignage de la sélection) : son programme de shaders est ainsi compilé par
 * `ShaderWarmup` avant la première image, et non au premier clic (tâche longue).
 */
function ProgramProxy({ material }: { material: Material }) {
  const geometry = useMemo(() => {
    const g = new ThreeBufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(6), 2));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      material={material}
      frustumCulled={false}
      receiveShadow
      dispose={null}
      raycast={() => undefined}
    />
  );
}

/** Redemande une image quand une texture procédurale est prête. */
function TextureInvalidator() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => onTextureReady(() => invalidate()), [invalidate]);
  return null;
}

/** Applique le plan de coupe au plan partagé des matériaux. */
function SectionUpdater({ clip, plane }: { clip: Plane; plane: SectionPlane }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    clip.normal.set(...plane.normal);
    clip.constant = plane.constant;
    invalidate();
  }, [clip, plane, invalidate]);
  return null;
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

/** Point de la scène (m, Y vers le haut) → repère du cœur (mm, Z vers le haut). */
const fromScene = (p: Vector3): Vec3 => ({ x: p.x / MM, y: -p.z / MM, z: p.y / MM });

export default function Viewer3D({
  model,
  mesh,
  project,
  selection,
  onSelectPart,
  onSelectPoint,
}: Viewer3DProps) {
  const { parts, failed } = usePartGeometries(mesh, model);
  const quality = useMemo(() => browserRenderQuality(), []);
  const materials = useMaterials(quality);
  const [tools, setTools] = useState<ToolsState>(INITIAL_TOOLS);
  const updateTools = useCallback(
    (patch: Partial<ToolsState>) => setTools((t) => ({ ...t, ...patch })),
    [],
  );
  const [isolated, setIsolated] = useState<string | null>(null);
  const appearance = useApp((s) => s.appearance);
  const families = useMemo(() => familiesOf(parts.map((p) => p.part)), [parts]);
  // Points mesurés : pièce et position réelle (hors vue éclatée) ; la position affichée suit
  // l'éclatement courant.
  const [measure, setMeasure] = useState<readonly PickedPoint[]>([]);
  const markers = useMemo(() => controlMarkers(model), [model]);
  const selectedMesh = parts.find(({ part }) =>
    isPartSelected(part.partId, selection?.location),
  )?.part;
  const selectedName = selectedMesh
    ? (model.parts.find((p) => p.id === selectedMesh.partId)?.name ?? "")
    : "";
  const selectedRules = selectedMesh ? markers.rulesByPart.get(selectedMesh.partId) : undefined;
  const flaggedCount = markers.parts.size + markers.points.length;
  const [shadersReady, setShadersReady] = useState(false);
  const onShadersReady = useCallback(() => setShadersReady(true), []);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Pièce isolée disparue du modèle : tout réafficher.
  const isolatedShown = isolated !== null && parts.some((p) => p.part.partId === isolated);
  const shownParts = isolatedShown ? parts.filter((p) => p.part.partId === isolated) : parts;

  // Boîte de l'escalier (mm, repère du cœur), non éclaté.
  const stairBox = useMemo(() => {
    const box = new Box3();
    for (const { geometry } of parts) if (geometry.boundingBox) box.union(geometry.boundingBox);
    if (box.isEmpty())
      box.set(new Vector3(0, 0, 0), new Vector3(1000, 1000, project.site.floorToFloor));
    return box;
  }, [parts, project.site.floorToFloor]);

  const offsets = useMemo(() => {
    const c = stairBox.getCenter(new Vector3());
    return explodeOffsets(
      parts.map((p) => ({ partId: p.part.partId, category: p.part.category, center: p.center })),
      { x: c.x, y: c.y, z: c.z },
      tools.explode,
    );
  }, [parts, stairBox, tools.explode]);

  const plane = useMemo(
    () =>
      tools.section === "none"
        ? NO_SECTION
        : sectionPlane(
            tools.section,
            tools.sectionAt,
            {
              min: { x: stairBox.min.x, y: stairBox.min.y, z: stairBox.min.z },
              max: { x: stairBox.max.x, y: stairBox.max.y, z: stairBox.max.z },
            },
            tools.sectionFlip,
          ),
    [tools.section, tools.sectionAt, tools.sectionFlip, stairBox],
  );

  // Coupe par pièces (rendu logiciel, `quality.clipping` faux) : pièces dont le centre est du
  // côté retiré masquées, dalle masquée.
  const sectionByParts = !quality.clipping && tools.section !== "none";
  const visibleParts = sectionByParts
    ? shownParts.filter(({ part, center }) => {
        const o = offsets.get(part.partId) ?? ZERO;
        return (
          signedDistance(plane, { x: center.x + o.x, y: center.y + o.y, z: center.z + o.z }) >= 0
        );
      })
    : shownParts;

  const measurePoints = useMemo(
    () => measure.map((p) => pickedToMeasure(p, offsets)),
    [measure, offsets],
  );

  const annotations = useMemo(() => {
    const out: Annotation[] = [];
    if (tools.showDimensions && !isolatedShown) out.push(...mainDimensions(model));
    if (tools.measuring) {
      const m = measureAnnotation(measurePoints);
      if (m) out.push(m);
    }
    return out;
  }, [tools.showDimensions, tools.measuring, isolatedShown, model, measurePoints]);

  const measureText = !tools.measuring
    ? null
    : measure.length < 2
      ? measure.length === 0
        ? "Cliquez un premier point sur une pièce."
        : "Cliquez un second point."
      : `Distance : ${measureAnnotation(measurePoints)?.label ?? ""}${tools.explode > 0 ? " (pièces en place)" : ""}`;

  // Cadrage initial sur l'ensemble des pièces (en mètres, repère three.js).
  const frame = useMemo(() => {
    const c = stairBox.getCenter(new Vector3());
    const size = stairBox.getSize(new Vector3()).length() * MM;
    const target: [number, number, number] = [c.x * MM, c.z * MM, -c.y * MM];
    const position: [number, number, number] = [
      target[0] + size * 0.9,
      target[1] + size * 0.7,
      target[2] + size * 1.1,
    ];
    return { target, position, size };
    // Cadrage calculé seulement au montage : l'utilisateur garde son point de vue.
  }, []);

  const onPartClick = (partId: string) => (e: ThreeEvent<MouseEvent>) => {
    // Coupe exacte : le lancer de rayons ignore les plans de coupe ; un point de la partie
    // découpée (invisible) est ignoré et l'événement passe à l'intersection suivante.
    if (quality.clipping && isClippedInScene(plane, e.point)) return;
    e.stopPropagation();
    if (!tools.measuring) {
      onSelectPart(partId);
      return;
    }
    const point = pickPoint(partId, fromScene(e.point), offsets);
    setMeasure((m) => (m.length >= 2 ? [point] : [...m, point]));
  };

  return (
    <div className="viewer3d">
      <Canvas
        // Ombres PCF : three.js (r18x) a retiré PCFSoftShadowMap, que `shadows` demande par
        // défaut, et la remplace à la volée par PCF — les programmes précompilés (type d'ombre
        // 2) ne servaient alors jamais et tout était recompilé dans la première image. Rendu
        // logiciel : ni ombres ni haute densité (`three/quality.ts`).
        shadows={quality.shadows ? "percentage" : false}
        dpr={quality.dpr}
        gl={GL_PROPS}
        frameloop={shadersReady ? "demand" : "never"}
        camera={{ position: frame.position, fov: 40, near: 0.01, far: 200 }}
        onPointerMissed={() => {
          if (!tools.measuring) onSelectPart(null);
        }}
        aria-label="Vue 3D de l'escalier"
      >
        <SceneEnvironment enabled={quality.environment} />
        <hemisphereLight args={["#ffffff", "#8a8f99", quality.environment ? 0.25 : 0.6]} />
        <ambientLight intensity={quality.environment ? 0 : 0.2} />
        <directionalLight
          position={[frame.target[0] + 4, frame.target[1] + 8, frame.target[2] + 5]}
          intensity={quality.environment ? 1.3 : 1.6}
          castShadow
          shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
          shadow-camera-near={0.1}
          shadow-camera-far={40}
          shadow-bias={-0.0005}
          shadow-normalBias={0.02}
        />
        <group rotation={[-Math.PI / 2, 0, 0]} scale={MM}>
          {visibleParts.map(({ part, geometry }) => {
            const selected = isPartSelected(part.partId, selection?.location);
            const severity = tools.showControls ? markers.parts.get(part.partId) : undefined;
            const shown = displayedMaterial(part, appearance);
            const material = selected
              ? materials.highlight
              : severity
                ? materials.flagged(shown, severity)
                : materials.get(shown);
            const o = offsets.get(part.partId) ?? ZERO;
            return (
              <mesh
                key={part.partId}
                geometry={geometry}
                material={material}
                position={[o.x, o.y, o.z]}
                dispose={null}
                castShadow={!isTranslucent(shown)}
                receiveShadow
                onClick={onPartClick(part.partId)}
              />
            );
          })}
          {tools.showControls && !isolatedShown ? (
            <PointMarkers
              markers={markers.points}
              materials={materials}
              selection={selection}
              onSelect={onSelectPoint}
            />
          ) : null}
          {isolatedShown || sectionByParts ? null : (
            <Slab project={project} model={model} material={materials.slab} />
          )}
          <ProgramProxy material={materials.highlight} />
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
        <TextureInvalidator />
        <SectionUpdater clip={materials.clip} plane={plane} />
        <AnnotationProjector annotations={annotations} svgRef={svgRef} />
        <ShaderWarmup ready={shadersReady} onReady={onShadersReady} />
      </Canvas>
      <AnnotationOverlay annotations={annotations} svgRef={svgRef} />
      <Viewer3DTools
        tools={tools}
        onChange={(patch) => {
          if (patch.measuring !== undefined) setMeasure([]);
          updateTools(patch);
        }}
        flaggedCount={flaggedCount}
        measureText={measureText}
        onClearMeasure={() => setMeasure([])}
        canIsolate={selectedMesh !== undefined}
        isolated={isolatedShown}
        onIsolate={() => {
          if (selectedMesh) setIsolated(selectedMesh.partId);
        }}
        onShowAll={() => setIsolated(null)}
        families={families}
        appearance={appearance}
        onAppearance={(family, material) =>
          appStore.getState().setAppearance(withAppearance(appearance, family, material))
        }
      />
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
