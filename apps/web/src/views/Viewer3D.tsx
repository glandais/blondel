/**
 * Onglet 3D : maillages de `@blondel/geometry` calculés avec le modèle dans le worker de calcul
 * (un `BufferGeometry` par empreinte de solide et sens du fil, libéré quand il n'est plus
 * affiché), matériaux PBR par matériau du cœur (`three/pbr.ts` : bois à veinage procédural
 * orienté selon le fil de chaque pièce, acier brut / peint / galvanisé, inox brossé, verre,
 * béton), garde-corps et mains courantes (balayages) compris ; dalle haute translucide percée de
 * la trémie, grille au sol sans scintillement (`three/groundGrid.ts`), éclairage d'ambiance
 * procédural (`RoomEnvironment`), ombres, surlignage de la pièce sélectionnée et marqueurs du
 * contrôle de conception (pièces teintées selon la sévérité, repères ponctuels).
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
import type { Appearance, MaterialId, Model, Part, Project, Severity, Vec3 } from "@blondel/core";
import { OrbitControls } from "@react-three/drei";
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
import { displayedMaterial, familiesOf, paintZone, withAppearance } from "../lib/appearance.js";
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
  snapToVertex,
  type Annotation,
  type PickedPoint,
} from "../three/annotations.js";
import { explodeOffsets } from "../three/explode.js";
import { toBufferGeometry, upperSlabMesh } from "../three/geometry.js";
import { createGeometryPool, geometryKey, type GeometryPool } from "../three/geometryPool.js";
import {
  GROUND_GRID_RENDER_ORDER,
  SHADOW_PLANE_RENDER_ORDER,
  cameraClipRange,
  createGroundGridMaterial,
  gridFadeDistance,
} from "../three/groundGrid.js";
import { flatteringView } from "../three/framing.js";
import {
  HIGHLIGHT_COLOR,
  SEVERITY_COLORS,
  appearanceKey,
  glassThicknessOf,
  GLASS_THICKNESS_MM,
  paintZoneFor,
  type PaintZone,
} from "../three/materials.js";
import {
  createPartMaterial,
  isTranslucent,
  setGlassThickness,
  simpleMaterial,
  tintPartMaterial,
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
import { useT } from "../i18n/useT.js";
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

/** Maillage d'une pièce et sa famille / son numéro de marche (champs explicites du cœur). */
type ShownPart = MeshedPartData["mesh"] & Pick<Part, "family" | "treadNumber">;

interface PartGeometry {
  readonly part: ShownPart;
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
  const byId = useMemo(() => {
    const m = new Map<string, Part>();
    for (const p of model.parts) m.set(p.id, p);
    return m;
  }, [model]);
  const geometries = useMemo(() => {
    const p = pool.current as GeometryPool;
    return (mesh?.parts ?? [])
      .filter((m) => m.mesh.mesh.indices.length > 0)
      .map((m) => {
        const source = byId.get(m.mesh.partId);
        const grain = source?.grain;
        const key = geometryKey(m.key, grain);
        const geometry = p.get(key, m.mesh.mesh, grain);
        const c = geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
        const part: ShownPart = {
          ...m.mesh,
          ...(source?.family !== undefined ? { family: source.family } : {}),
          ...(source?.treadNumber !== undefined ? { treadNumber: source.treadNumber } : {}),
        };
        return { part, key, geometry, center: { x: c.x, y: c.y, z: c.z } };
      });
  }, [mesh, byId]);
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
  /** Matériau partagé ; `zone` : zone de peinture de la pièce (variante de l'acier peint). */
  get: (id: MaterialId, zone?: PaintZone) => PartMaterial;
  /** Matériau teinté d'une pièce en violation (couleur de la sévérité). */
  flagged: (id: MaterialId, severity: Severity, zone?: PaintZone) => PartMaterial;
  marker: (severity: Severity, selected: boolean) => SimpleMaterial;
  highlight: SimpleMaterial;
  slab: SimpleMaterial;
  sphere: SphereGeometry;
  /** Plan de coupe partagé par les matériaux des pièces et de la dalle. */
  clip: Plane;
  /**
   * Teintes du projet (`Project.appearance`) appliquées sur place aux matériaux des pièces
   * (couleur, opacité) : mêmes objets, mêmes programmes de shader. Vrai si elles ont changé.
   */
  retint: (appearance: Appearance | undefined) => boolean;
  /**
   * Épaisseur du verre (mm) appliquée sur place aux matériaux vitrés (uniforme de transmission,
   * QUESTIONS A25) : celle du remplissage du modèle affiché.
   */
  setGlassThickness: (mm: number) => void;
}

/**
 * Matériaux partagés par identifiant, libérés au démontage de la vue (textures en cache). Les
 * teintes du projet ne les recréent pas (`retint`).
 */
function useMaterials(quality: RenderQuality): Materials {
  const value = useMemo(() => {
    let tints: Appearance | undefined;
    let tintKey = "";
    let glassThickness = GLASS_THICKNESS_MM;
    const clip = new Plane(new Vector3(...NO_SECTION.normal), NO_SECTION.constant);
    // Plan toujours attaché (programmes stables), seulement pour la coupe exacte.
    const clipped = <M extends Material>(m: M): M => {
      if (!quality.clipping) return m;
      m.clippingPlanes = [clip];
      m.clipShadows = true;
      return m;
    };
    const cache = new Map<string, Material>();
    // Clé d'un matériau : identifiant, suivi de la zone de peinture hors ossature (`id~zone`).
    const keyOf = (id: MaterialId, zone: PaintZone): string =>
      zone === "structure" ? id : `${id}~${zone}`;
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
      get: (id: MaterialId, zone: PaintZone = "structure") => {
        const z = paintZoneFor(id, zone);
        return cached(keyOf(id, z), () =>
          clipped(createPartMaterial(id, quality, { appearance: tints, zone: z, glassThickness })),
        );
      },
      flagged: (id: MaterialId, severity: Severity, zone: PaintZone = "structure") => {
        const z = paintZoneFor(id, zone);
        return cached(`${keyOf(id, z)}|${severity}`, () =>
          clipped(
            createPartMaterial(id, quality, {
              severity,
              appearance: tints,
              zone: z,
              glassThickness,
            }),
          ),
        );
      },
      retint: (appearance: Appearance | undefined) => {
        const key = appearanceKey(appearance);
        if (key === tintKey) return false;
        tints = appearance;
        tintKey = key;
        for (const [k, m] of cache) {
          if (k.startsWith("marker|")) continue;
          const [id, zone] = k.split("|")[0]!.split("~") as [MaterialId, PaintZone?];
          tintPartMaterial(m as PartMaterial, id, quality, tints, zone);
        }
        return true;
      },
      setGlassThickness: (mm: number) => {
        if (mm === glassThickness) return;
        glassThickness = mm;
        for (const [k, m] of cache) {
          if (!k.startsWith("marker|")) setGlassThickness(m as PartMaterial, mm);
        }
      },
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

/** Nom de l'objet de la grille (point d'accès de test : grille masquée ou affichée). */
const GROUND_GRID_NAME = "blondel-ground-grid";

/**
 * Grille au sol (y = 0) antialiasée et sans moiré (`three/groundGrid.ts`), recentrée sous la
 * caméra par son shader.
 */
function GroundGrid({ fadeDistance }: { fadeDistance: number }) {
  const material = useMemo(
    () =>
      createGroundGridMaterial({
        cellColor: "#9aa0a6",
        sectionColor: "#6b7178",
        fadeDistance,
      }),
    [fadeDistance],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      name={GROUND_GRID_NAME}
      material={material}
      renderOrder={GROUND_GRID_RENDER_ORDER}
      frustumCulled={false}
      raycast={() => undefined}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
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

/** Nouvelle image quand les teintes du projet changent (matériaux modifiés sur place). */
function TintInvalidator({ tintKey }: { tintKey: string }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [tintKey, invalidate]);
  return null;
}

/**
 * Cadrage de démo (`AppState.frameRequest`) : une fois par demande, quand le modèle affiché est
 * celui du projet demandé (même objet) et maillé, la caméra passe en vue de trois quarts
 * plongeante sur tout l'escalier (`three/framing.ts`).
 */
function DemoFramer({ project, box, ready }: { project: Project; box: Box3; ready: boolean }) {
  const request = useApp((s) => s.frameRequest);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as {
    target?: Vector3;
    update?: () => void;
  } | null;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const done = useRef<number | null>(null);
  useEffect(() => {
    if (!request || done.current === request.seq) return;
    if (request.project !== project || !ready || !controls?.target) return;
    done.current = request.seq;
    const fov = "fov" in camera && typeof camera.fov === "number" ? camera.fov : 40;
    const pose = flatteringView(box, {
      fovDeg: fov,
      aspect: size.height > 0 ? size.width / size.height : 1,
    });
    controls.target.set(...pose.target);
    camera.position.set(...pose.position);
    camera.lookAt(controls.target);
    controls.update?.();
    invalidate();
  }, [request, project, ready, box, camera, controls, size, invalidate]);
  return null;
}

/**
 * Point d'accès de test, installé seulement dans un navigateur piloté (`navigator.webdriver`,
 * Playwright) : place la caméra en orbite autour de la cible des contrôles, à un azimut et une
 * élévation (degrés) relatifs à la pose du premier appel, sans passer par la souris — pose
 * exacte et reproductible pour comparer des images (`apps/web/e2e/grid-flicker.spec.ts`) ;
 * `showGrid` masque ou affiche la grille au sol (le test vérifie qu'elle est bien dessinée) ;
 * `pose` rend la position de la caméra et la cible (cadrage des démos).
 */
function CameraTestHook({ target }: { target: readonly [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target?: Vector3; update?: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.webdriver) return;
    let base: { t: Vector3; offset: Vector3 } | null = null;
    const w = window as Window & { __blondelViewer3D?: unknown };
    w.__blondelViewer3D = {
      orbit(azimuthDeg: number, elevationDeg = 0) {
        if (!base) {
          const t = controls?.target?.clone() ?? new Vector3(...target);
          base = { t, offset: camera.position.clone().sub(t) };
        }
        const t = base.t;
        const offset = base.offset.clone();
        const r = offset.length();
        const theta = Math.atan2(offset.x, offset.z) + (azimuthDeg * Math.PI) / 180;
        const phi = Math.acos(offset.y / r) - (elevationDeg * Math.PI) / 180;
        offset.set(
          r * Math.sin(phi) * Math.sin(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.cos(theta),
        );
        camera.position.copy(t).add(offset);
        camera.lookAt(t);
        controls?.update?.();
        invalidate();
      },
      showGrid(visible: boolean) {
        const grid = scene.getObjectByName(GROUND_GRID_NAME);
        if (!grid) throw new Error("grille au sol absente de la scène");
        grid.visible = visible;
        invalidate();
      },
      /** Pose courante (m, repère three.js) : cadrage des démos (`e2e/demos.spec.ts`). */
      pose() {
        const t = controls?.target ?? new Vector3(...target);
        return { position: camera.position.toArray(), target: t.toArray() };
      },
      /**
       * Couleur (sRVB, `#rrggbb`) du matériau de pièce `name` (identifiant du cœur) dessiné dans
       * la scène, `null` s'il n'y est pas : teintes du projet (`Project.appearance`).
       */
      materialColor(name: string) {
        let hex: string | null = null;
        scene.traverse((o) => {
          const m = (o as { material?: { name?: string; color?: { getHexString(): string } } })
            .material;
          if (hex === null && o.visible && m?.name === name && m.color) {
            hex = `#${m.color.getHexString()}`;
          }
        });
        return hex;
      },
    };
    return () => {
      delete w.__blondelViewer3D;
    };
  }, [camera, controls, invalidate, scene, target]);
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

/**
 * Point de mesure d'un clic (repère de la scène) : sommet du triangle touché le plus proche à
 * l'écran (`snapToVertex`, rayon `SNAP_RADIUS_PX`), sinon le point touché.
 */
function snappedPoint(e: ThreeEvent<MouseEvent>): Vector3 {
  const face = e.face;
  const position = (e.object as { geometry?: BufferGeometry }).geometry?.getAttribute("position");
  const canvas = e.nativeEvent.target;
  if (!face || !position || !(canvas instanceof Element)) return e.point;
  const rect = canvas.getBoundingClientRect();
  const toScreen = (v: Vector3): { x: number; y: number } => {
    const n = v.clone().project(e.camera);
    return { x: ((n.x + 1) / 2) * rect.width, y: ((1 - n.y) / 2) * rect.height };
  };
  const vertices = [face.a, face.b, face.c].map((i) =>
    new Vector3().fromBufferAttribute(position, i).applyMatrix4(e.object.matrixWorld),
  );
  const s = snapToVertex(
    { x: e.point.x, y: e.point.y, z: e.point.z },
    toScreen(e.point),
    vertices.map((v) => ({ point: { x: v.x, y: v.y, z: v.z }, screen: toScreen(v) })),
  );
  return s.snapped ? new Vector3(s.point.x, s.point.y, s.point.z) : e.point;
}

export default function Viewer3D({
  model,
  mesh,
  project,
  selection,
  onSelectPart,
  onSelectPoint,
}: Viewer3DProps) {
  const tr = useT();
  const { parts, failed } = usePartGeometries(mesh, model);
  const quality = useMemo(() => browserRenderQuality(), []);
  const materials = useMaterials(quality);
  // Teintes du projet affiché, appliquées sur place avant le rendu des pièces (idempotent : sans
  // effet si elles n'ont pas changé).
  const tintKey = appearanceKey(project.appearance);
  materials.retint(project.appearance);
  // Épaisseur du verre : celle du remplissage du modèle (QUESTIONS A25), idempotent.
  materials.setGlassThickness(glassThicknessOf(model));
  // Cotes principales et contrôles sur les pièces : dans le store (masqués au choix d'une démo,
  // rétablis par un autre projet, conservés d'un onglet à l'autre) ; le reste, local à la vue.
  const overlays = useApp((s) => s.overlays);
  const [localTools, setTools] = useState<ToolsState>(INITIAL_TOOLS);
  const tools = useMemo<ToolsState>(() => ({ ...localTools, ...overlays }), [localTools, overlays]);
  const updateTools = useCallback((patch: Partial<ToolsState>) => {
    const { showControls, showDimensions, ...rest } = patch;
    if (showControls !== undefined || showDimensions !== undefined) {
      appStore.getState().setOverlays({
        ...(showControls !== undefined ? { showControls } : {}),
        ...(showDimensions !== undefined ? { showDimensions } : {}),
      });
    }
    if (Object.keys(rest).length > 0) setTools((t) => ({ ...t, ...rest }));
  }, []);
  const [isolated, setIsolated] = useState<string | null>(null);
  const appearance = useApp((s) => s.appearance);
  const families = useMemo(() => familiesOf(parts.map((p) => p.part)), [parts]);
  // Points mesurés : pièce et position réelle (hors vue éclatée) ; la position affichée suit
  // l'éclatement courant.
  const [measure, setMeasure] = useState<readonly PickedPoint[]>([]);
  const hiddenFamilies = tools.hiddenFamilies;
  const markers = useMemo(
    () => controlMarkers(model, new Set(hiddenFamilies)),
    [model, hiddenFamilies],
  );
  const selectedMesh = parts.find(({ part }) => isPartSelected(part, selection?.location))?.part;
  const selectedPartName = selectedMesh
    ? model.parts.find((p) => p.id === selectedMesh.partId)?.name
    : undefined;
  const selectedName = selectedPartName ? tr.t(selectedPartName) : "";
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
    if (tools.showDimensions && !isolatedShown) out.push(...mainDimensions(model, tr));
    if (tools.measuring) {
      const m = measureAnnotation(measurePoints, tr.locale);
      if (m) out.push(m);
    }
    return out;
  }, [tools.showDimensions, tools.measuring, isolatedShown, model, measurePoints, tr]);

  const measureText = !tools.measuring
    ? null
    : measure.length < 2
      ? measure.length === 0
        ? tr.t("ui.viewer3d.measure.first")
        : tr.t("ui.viewer3d.measure.second")
      : tr.t(
          tools.explode > 0
            ? "ui.viewer3d.measure.distance.inPlace"
            : "ui.viewer3d.measure.distance",
          {
            distance: measureAnnotation(measurePoints, tr.locale)?.label ?? "",
          },
        );

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
  // Plage de profondeur adaptée à la scène (précision de profondeur, `three/groundGrid.ts`).
  const clip = cameraClipRange(frame.size);

  const onPartClick = (partId: string) => (e: ThreeEvent<MouseEvent>) => {
    // Coupe exacte : le lancer de rayons ignore les plans de coupe ; un point de la partie
    // découpée (invisible) est ignoré et l'événement passe à l'intersection suivante.
    if (quality.clipping && isClippedInScene(plane, e.point)) return;
    e.stopPropagation();
    if (!tools.measuring) {
      onSelectPart(partId);
      return;
    }
    const point = pickPoint(partId, fromScene(snappedPoint(e)), offsets);
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
        camera={{ position: frame.position, fov: 40, near: clip.near, far: clip.far }}
        onPointerMissed={() => {
          if (!tools.measuring) onSelectPart(null);
        }}
        aria-label={tr.t("ui.viewer3d.label")}
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
            const selected = isPartSelected(part, selection?.location);
            const severity = tools.showControls ? markers.parts.get(part.partId) : undefined;
            const shown = displayedMaterial(part, appearance);
            const zone = paintZone(part);
            const material = selected
              ? materials.highlight
              : severity
                ? materials.flagged(shown, severity, zone)
                : materials.get(shown, zone);
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
          renderOrder={SHADOW_PLANE_RENDER_ORDER}
          receiveShadow
        >
          <planeGeometry args={[40, 40]} />
          {/* Sans écriture de profondeur : aucun conflit avec la grille (`three/groundGrid.ts`). */}
          <shadowMaterial opacity={0.18} depthWrite={false} />
        </mesh>
        <GroundGrid fadeDistance={gridFadeDistance(frame.size)} />
        <OrbitControls makeDefault target={frame.target} maxDistance={clip.far / 2} />
        <TextureInvalidator />
        <CameraTestHook target={frame.target} />
        <DemoFramer project={project} box={stairBox} ready={parts.length > 0} />
        <TintInvalidator tintKey={tintKey} />
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
        familyCounts={markers.byFamily}
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
          {tr.t("ui.viewer3d.selection")}
          <strong>{selectedMesh.mark}</strong>
          {tr.t("ui.viewer3d.selection.name", { name: selectedName })}
          {selectedRules && selectedRules.length > 0 ? ` · ${selectedRules.join(", ")}` : ""}
        </p>
      ) : null}
      {parts.length === 0 ? (
        <p className="viewer3d__empty muted">
          {tr.t(mesh ? "ui.viewer3d.noParts" : "ui.viewer3d.noMesh")}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <ul className="viewer3d__errors" role="status">
          {failed.map((f) => (
            <li key={f.partId}>
              {tr.t("ui.viewer3d.partError", {
                mark: f.mark,
                error: f.error !== undefined ? tr.t(f.error) : "",
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
