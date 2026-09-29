/**
 * Compilation des programmes de shaders **avant** la première image de la vue 3D : sans cela,
 * la première image attend la compilation et l'édition de liens de chaque programme (lecture
 * synchrone de `LINK_STATUS`), soit une tâche de 150 à 700 ms du fil principal à chaque
 * ouverture de l'onglet (mesure e2e, `apps/web/e2e/long-tasks.spec.ts`).
 */
import type { Camera, Material, Mesh, Object3D, Scene, WebGLRenderer } from "three";

/** Partie du moteur de rendu utilisée (injectable dans les tests). */
export type WarmupRenderer = Pick<
  WebGLRenderer,
  "compileAsync" | "render" | "setScissor" | "setScissorTest"
> & {
  readonly extensions: { has(name: string): boolean };
  readonly domElement: Pick<HTMLCanvasElement, "addEventListener" | "removeEventListener">;
  getContext(): { isContextLost(): boolean };
};

/** Rend la main au navigateur (une tâche par programme de shaders compilé). */
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Dessine `target` seul (autres maillages masqués le temps de l'appel) dans un ciseau d'un pixel :
 * programme compilé et lié, et pipeline du pilote construit (SwiftShader compile ses pipelines
 * au premier tracé, pas à l'édition de liens), pour un coût de tracé négligeable. La visibilité
 * des maillages masqués est toujours rétablie, même si le tracé lève.
 */
export function drawAlone(
  gl: WarmupRenderer,
  scene: Scene,
  camera: Camera,
  target: Object3D,
): void {
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (o !== target && o.visible && (o as Partial<Mesh>).isMesh) {
      o.visible = false;
      hidden.push(o);
    }
  });
  gl.setScissorTest(true);
  gl.setScissor(0, 0, 1, 1);
  try {
    gl.render(scene, camera);
  } finally {
    gl.setScissorTest(false);
    for (const o of hidden) o.visible = true;
  }
}

/**
 * Objets représentatifs de la scène visible : un par couple (matériau, ombre reçue) jamais vu,
 * c'est-à-dire un par programme de shaders probable.
 */
export function shaderRepresentatives(scene: Scene): Object3D[] {
  const seen = new Set<string>();
  const representatives: Object3D[] = [];
  scene.traverseVisible((o) => {
    const material = (o as Partial<Mesh>).material;
    if (!material) return;
    const keys = (Array.isArray(material) ? material : [material]).map(
      (m: Material) => `${m.uuid}|${o.receiveShadow}`,
    );
    if (keys.every((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    representatives.push(o);
  });
  return representatives;
}

/**
 * Promesse résolue à la perte du contexte WebGL (ou tout de suite s'il est déjà perdu) ;
 * `dispose` retire l'écouteur.
 */
function contextLoss(gl: WarmupRenderer): { lost: Promise<void>; dispose: () => void } {
  let dispose = (): void => {};
  const lost = new Promise<void>((resolve) => {
    if (gl.getContext().isContextLost()) {
      resolve();
      return;
    }
    const onLost = (): void => resolve();
    gl.domElement.addEventListener("webglcontextlost", onLost);
    dispose = () => gl.domElement.removeEventListener("webglcontextlost", onLost);
  });
  return { lost, dispose };
}

/**
 * Prépare les shaders de la scène avant la première image, sans tâche longue :
 *
 * - avec `KHR_parallel_shader_compile` (GPU matériels) : `compileAsync`, compilation en
 *   parallèle, interrogée sans blocage ;
 * - sans (rendu logiciel SwiftShader, CI, pilotes anciens) : un objet représentatif par couple
 *   (matériau, ombre reçue) est dessiné seul, dans sa propre tâche (`drawAlone`), au lieu de
 *   tout compiler dans la première image.
 *
 * Se termine toujours : une perte du contexte WebGL arrête la préparation (`compileAsync`
 * interrogerait sinon indéfiniment un programme qui ne sera jamais prêt, et la vue ne serait
 * jamais dessinée, même après restauration du contexte).
 */
export async function warmUpShaders(
  gl: WarmupRenderer,
  scene: Scene,
  camera: Camera,
  alive: () => boolean,
): Promise<void> {
  const loss = contextLoss(gl);
  let lost = false;
  void loss.lost.then(() => {
    lost = true;
  });
  try {
    if (gl.extensions.has("KHR_parallel_shader_compile")) {
      await Promise.race([gl.compileAsync(scene, camera), loss.lost]);
      return;
    }
    for (const o of shaderRepresentatives(scene)) {
      await nextTask();
      if (!alive() || lost) return;
      drawAlone(gl, scene, camera, o);
    }
  } finally {
    loss.dispose();
  }
}
