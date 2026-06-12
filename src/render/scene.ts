/**
 * World scene: engine (WebGPU→WebGL2), sun + cascaded shadows, sky, splatted
 * terrain + water, post pipeline (bloom/FXAA/tonemap/SSAO2), team-colored
 * entity orbs, and the GLTF animation pipeline proof. KICKOFF §4 standards.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Culling/ray"; // scene.pick silently no-ops without this
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";
import type { Terrain } from "../sim";
import { buildTerrainMesh, sampleHeight, type TerrainView } from "./terrainMesh";
import { createRtsCamera, type RtsCamera } from "./camera";

export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  // WebGL2 by default. iOS 18 Safari reports WebGPU support but renders our
  // materials-library + RawTexture stack black; WebGL2 is the battle-tested
  // path everywhere. WebGPU stays available behind ?webgpu for testing.
  if (new URLSearchParams(location.search).has("webgpu") && (await WebGPUEngine.IsSupportedAsync)) {
    const engine = new WebGPUEngine(canvas, { antialias: true });
    await engine.initAsync();
    return engine;
  }
  const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
  // Phones: full native DPR (3× on iPhones) is wasted on a bloom+SSAO+CSM
  // pipeline — cap the backing store at 2× CSS pixels.
  if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && devicePixelRatio > 2) {
    engine.setHardwareScalingLevel(1 / 2);
  }
  return engine;
}

export interface WorldScene {
  scene: Scene;
  rtsCamera: RtsCamera;
  terrainView: TerrainView;
  shadows: CascadedShadowGenerator;
  groundHeightAt: (x: number, z: number) => number;
  updateUnits: (units: ReadonlyArray<{ x: number; y: number; playerId: number }>) => void;
}

export function createWorldScene(engine: AbstractEngine, canvas: HTMLCanvasElement, terrain: Terrain): WorldScene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.04, 0.05, 0.08, 1);

  const rtsCamera = createRtsCamera(scene, canvas, terrain.size);

  const sun = new DirectionalLight("sun", new Vector3(-0.45, -0.85, 0.3), scene);
  sun.position = new Vector3(terrain.size / 2 + 60, 90, terrain.size / 2 - 60);
  sun.intensity = 2.4;
  sun.diffuse = new Color3(1.0, 0.94, 0.84);
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.5;
  ambient.groundColor = new Color3(0.25, 0.23, 0.2);

  const shadows = new CascadedShadowGenerator(2048, sun);
  shadows.lambda = 0.92;
  shadows.stabilizeCascades = true;
  shadows.shadowMaxZ = 220;
  shadows.bias = 0.012;

  // Sky dome (also feeds water reflections).
  const skybox = MeshBuilder.CreateBox("sky", { size: 900 }, scene);
  skybox.position = new Vector3(terrain.size / 2, 0, terrain.size / 2);
  const sky = new SkyMaterial("skyMat", scene);
  sky.backFaceCulling = false;
  sky.inclination = 0.28;
  sky.azimuth = 0.22;
  sky.turbidity = 6;
  sky.luminance = 0.9;
  skybox.material = sky;

  const terrainView = buildTerrainMesh(scene, terrain);
  terrainView.waterMaterial.addToRenderList(skybox);

  const groundHeightAt = (x: number, z: number) => sampleHeight(terrain, x, z);

  // Post pipeline (bloom is a standing gate requirement).
  const pipeline = new DefaultRenderingPipeline("default", true, scene, [rtsCamera.camera]);
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.85;
  pipeline.bloomWeight = 0.4;
  pipeline.bloomKernel = 64;
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessingEnabled = true;
  if (pipeline.imageProcessing) {
    pipeline.imageProcessing.toneMappingEnabled = true;
    // per-biome grading (data/maps postProcessing.colorGrading) — warm plains default
    pipeline.imageProcessing.contrast = 1.16;
    pipeline.imageProcessing.exposure = 1.04;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.35;
    const curves = new ColorCurves();
    curves.globalSaturation = 12;
    curves.shadowsHue = 30;
    curves.shadowsDensity = 12;
    curves.highlightsHue = 45;
    curves.highlightsDensity = 14;
    pipeline.imageProcessing.colorCurvesEnabled = true;
    pipeline.imageProcessing.colorCurves = curves;
  }
  const enableSsao = !new URLSearchParams(globalThis.location?.search ?? "").has("nossao");
  if (enableSsao) {
    try {
      // forceGeometryBuffer: the PREPASS path injects defines that break
      // StandardMaterial-family shaders (TerrainMaterial) on some GL stacks.
      const ssao = new SSAO2RenderingPipeline("ssao", scene, 0.75, [rtsCamera.camera], true);
      ssao.totalStrength = 0.8;
      ssao.radius = 2.0;
    } catch {
      /* WebGL1 fallback — bloom remains the gated requirement */
    }
  }

  // Team-colored orbs for sim entities (placeholder units until Phase 2 rigs).
  const teamColors = [new Color3(0.95, 0.75, 0.2), new Color3(0.2, 0.7, 0.75)];
  const protos: Mesh[] = teamColors.map((c, i) => {
    const p = MeshBuilder.CreateSphere(`unitProto${i}`, { diameter: 1.1, segments: 14 }, scene);
    const m = new PBRMaterial(`unitMat${i}`, scene);
    m.albedoColor = c;
    m.emissiveColor = c.scale(0.55);
    m.metallic = 0.15;
    m.roughness = 0.5;
    p.material = m;
    p.isVisible = false;
    return p;
  });
  const instances: InstancedMesh[] = [];
  const updateUnits: WorldScene["updateUnits"] = (units) => {
    while (instances.length < units.length) {
      const i = instances.length;
      const inst = protos[units[i]!.playerId % protos.length]!.createInstance(`unit${i}`);
      shadows.addShadowCaster(inst);
      instances.push(inst);
    }
    units.forEach((u, i) => {
      const inst = instances[i]!;
      inst.position.set(u.x, groundHeightAt(u.x, u.y) + 0.55, u.y);
      inst.isVisible = true;
    });
    for (let i = units.length; i < instances.length; i++) instances[i]!.isVisible = false;
  };

  scene.onBeforeRenderObservable.add(() => rtsCamera.update(groundHeightAt));

  return { scene, rtsCamera, terrainView, shadows, groundHeightAt, updateUnits };
}

/**
 * GLTF pipeline proof (KICKOFF §12): load one animated CC0 character, play its
 * run cycle, walk it in a circle on the terrain. Returns once visible.
 */
export async function addShowcaseCharacter(world: WorldScene, terrain: Terrain): Promise<void> {
  const result = await SceneLoader.ImportMeshAsync("", `${import.meta.env.BASE_URL}models/`, "fox.glb", world.scene);
  const root = result.meshes[0]!;
  // Normalize to ~1.4 tiles tall regardless of source units.
  const bounds = root.getHierarchyBoundingVectors();
  const height = bounds.max.y - bounds.min.y || 1;
  const scale = 1.4 / height;
  root.scaling.setAll(scale);
  for (const m of result.meshes) {
    if (m.getTotalVertices() > 0) world.shadows.addShadowCaster(m);
  }
  const run = result.animationGroups.find((g) => /run|walk/i.test(g.name)) ?? result.animationGroups[0];
  run?.start(true, 1.0);

  const cx = terrain.size / 2;
  const cz = terrain.size / 2;
  let angle = 0;
  world.scene.onBeforeRenderObservable.add(() => {
    angle += world.scene.getEngine().getDeltaTime() * 0.00035;
    const x = cx + Math.cos(angle) * 9;
    const z = cz + Math.sin(angle) * 9;
    root.position.set(x, world.groundHeightAt(x, z), z);
    root.rotationQuaternion = null;
    root.rotation.y = -angle - Math.PI / 2;
  });
}
