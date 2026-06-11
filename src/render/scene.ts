/**
 * Phase 0 render layer: lit PBR test scene with the full post pipeline
 * (bloom + FXAA + tone mapping + SSAO2) per KICKOFF §4. WebGPU first,
 * WebGL2 fallback. Sim entities are visualized as team-colored orbs.
 */
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/instancedMesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
import { Scene } from "@babylonjs/core/scene";

/** World scale: 1 Babylon unit = 1 tile = 1 meter. Map center for the test scene. */
const CENTER = 100;

export interface GameRenderer {
  engine: AbstractEngine;
  scene: Scene;
  /** Move/show up to maxUnits team-colored orbs. positions in tiles (floats OK here). */
  updateUnits: (units: ReadonlyArray<{ x: number; y: number; playerId: number }>) => void;
  beacon: Mesh;
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  if (await WebGPUEngine.IsSupportedAsync) {
    const engine = new WebGPUEngine(canvas, { antialias: true });
    await engine.initAsync();
    return engine;
  }
  return new Engine(canvas, true, { adaptToDeviceRatio: true });
}

export function createTestScene(engine: AbstractEngine): GameRenderer {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.04, 0.05, 0.08, 1);

  const camera = new ArcRotateCamera("camera", -Math.PI / 3, Math.PI / 3.4, 46, new Vector3(CENTER, 0, CENTER), scene);
  camera.lowerRadiusLimit = 18;
  camera.upperRadiusLimit = 90;
  camera.upperBetaLimit = Math.PI / 2.2;
  camera.wheelPrecision = 12;
  camera.attachControl(true);

  const sun = new DirectionalLight("sun", new Vector3(-0.45, -0.9, 0.35), scene);
  sun.position = new Vector3(CENTER + 40, 60, CENTER - 40);
  sun.intensity = 2.6;
  sun.diffuse = new Color3(1.0, 0.93, 0.82);
  const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.55;
  ambient.groundColor = new Color3(0.22, 0.2, 0.18);

  const shadows = new CascadedShadowGenerator(2048, sun);
  shadows.lambda = 0.9;
  shadows.transparencyShadow = false;
  shadows.stabilizeCascades = true;

  const ground = MeshBuilder.CreateGround("ground", { width: 240, height: 240, subdivisions: 4 }, scene);
  ground.position = new Vector3(CENTER, 0, CENTER);
  const groundMat = new PBRMaterial("groundMat", scene);
  groundMat.albedoColor = new Color3(0.23, 0.32, 0.16);
  groundMat.metallic = 0;
  groundMat.roughness = 0.95;
  ground.material = groundMat;
  ground.receiveShadows = true;

  // Ring of weathered columns — silhouette + shadow test.
  const columnMat = new PBRMaterial("columnMat", scene);
  columnMat.albedoColor = new Color3(0.82, 0.78, 0.68);
  columnMat.metallic = 0.05;
  columnMat.roughness = 0.6;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const col = MeshBuilder.CreateCylinder(`column${i}`, { height: 7, diameter: 1.6, tessellation: 12 }, scene);
    col.position = new Vector3(CENTER + Math.cos(a) * 14, 3.5, CENTER + Math.sin(a) * 14);
    col.material = columnMat;
    shadows.addShadowCaster(col);
    const cap = MeshBuilder.CreateBox(`cap${i}`, { width: 2.2, depth: 2.2, height: 0.5 }, scene);
    cap.position = col.position.add(new Vector3(0, 3.75, 0));
    cap.material = columnMat;
    shadows.addShadowCaster(cap);
  }

  // Bronze altar — metallic PBR test.
  const altar = MeshBuilder.CreateBox("altar", { width: 4, depth: 4, height: 2 }, scene);
  altar.position = new Vector3(CENTER, 1, CENTER);
  const bronzeMat = new PBRMaterial("bronzeMat", scene);
  bronzeMat.albedoColor = new Color3(0.55, 0.36, 0.18);
  bronzeMat.metallic = 0.9;
  bronzeMat.roughness = 0.35;
  altar.material = bronzeMat;
  shadows.addShadowCaster(altar);

  // The god-power beacon: strongly emissive so the bloom pipeline visibly glows.
  const beacon = MeshBuilder.CreateSphere("beacon", { diameter: 2.4, segments: 24 }, scene);
  beacon.position = new Vector3(CENTER, 4.4, CENTER);
  const beaconMat = new PBRMaterial("beaconMat", scene);
  beaconMat.emissiveColor = new Color3(1.0, 0.72, 0.25);
  beaconMat.emissiveIntensity = 6;
  beaconMat.albedoColor = Color3.Black();
  beaconMat.metallic = 0;
  beaconMat.roughness = 1;
  beacon.material = beaconMat;
  let elapsed = 0;
  scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime() / 1000;
    beacon.position.y = 4.4 + Math.sin(elapsed * 1.4) * 0.5;
    beaconMat.emissiveIntensity = 5 + Math.sin(elapsed * 2.2) * 1.5;
  });

  // Post pipeline — Phase 0 gate requires bloom active.
  const pipeline = new DefaultRenderingPipeline("default", true, scene, [camera]);
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.8;
  pipeline.bloomWeight = 0.5;
  pipeline.bloomKernel = 64;
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessingEnabled = true;
  if (pipeline.imageProcessing) {
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.contrast = 1.15;
    pipeline.imageProcessing.exposure = 1.05;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.4;
  }
  try {
    // SSAO2 needs WebGL2/WebGPU; skip silently on anything older.
    const ssao = new SSAO2RenderingPipeline("ssao", scene, 0.75, [camera]);
    ssao.totalStrength = 0.9;
    ssao.radius = 2.0;
  } catch {
    // WebGL1 fallback — acceptable, bloom remains the gated requirement.
  }

  // Team-colored orbs visualizing live sim entities.
  const teamColors = [new Color3(0.95, 0.75, 0.2), new Color3(0.2, 0.7, 0.75)];
  const unitProto = MeshBuilder.CreateSphere("unitProto", { diameter: 1.2, segments: 16 }, scene);
  unitProto.isVisible = false;
  const protoMats = teamColors.map((c, i) => {
    const m = new PBRMaterial(`unitMat${i}`, scene);
    m.albedoColor = c;
    m.emissiveColor = c.scale(0.6);
    m.metallic = 0.2;
    m.roughness = 0.45;
    return m;
  });
  const instances: InstancedMesh[] = [];
  const protos: Mesh[] = protoMats.map((m, i) => {
    const p = unitProto.clone(`unitProtoTeam${i}`);
    p.material = m;
    p.isVisible = false;
    return p;
  });

  const updateUnits: GameRenderer["updateUnits"] = (units) => {
    while (instances.length < units.length) {
      const i = instances.length;
      const team = units[i]!.playerId % protos.length;
      const inst = protos[team]!.createInstance(`unit${i}`);
      shadows.addShadowCaster(inst);
      instances.push(inst);
    }
    units.forEach((u, i) => {
      const inst = instances[i]!;
      inst.position.set(u.x, 0.6, u.y);
      inst.isVisible = true;
    });
    for (let i = units.length; i < instances.length; i++) instances[i]!.isVisible = false;
  };

  return { engine, scene, updateUnits, beacon };
}
