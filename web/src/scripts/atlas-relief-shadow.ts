import {
  Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene,
  ShaderMaterial, WebGLRenderTarget, type WebGLRenderer,
} from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

/** Empreinte douce du volume calculée une seule fois ; aucun flou coûteux pendant les gestes. */
export function createContactShadow(renderer: WebGLRenderer, scene: Scene) {
  const target = new WebGLRenderTarget(512, 512);
  const buffer = new WebGLRenderTarget(512, 512);
  const silhouette = new MeshBasicMaterial({ color: 0x30291d, toneMapped: false });
  const horizontal = new ShaderMaterial(HorizontalBlurShader);
  const vertical = new ShaderMaterial(VerticalBlurShader);
  const screenGeometry = new PlaneGeometry(2, 2);
  const screen = new Mesh(screenGeometry, horizontal);
  const screenCamera = new OrthographicCamera(-1, 1, 1, -1, .1, 2);
  screenCamera.position.z = 1;
  const camera = new OrthographicCamera(-7, 7, 7, -7, .1, 30);
  camera.position.set(0, 12, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const previousTarget = renderer.getRenderTarget();
  const previousOverride = scene.overrideMaterial;
  const previousShadow = renderer.shadowMap.enabled;
  try {
    renderer.shadowMap.enabled = false;
    scene.overrideMaterial = silhouette;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    scene.overrideMaterial = previousOverride;
    // Deux rayons donnent une pénombre continue, sans contour dur de projecteur.
    for (const radius of [6, 2.5]) {
      screen.material = horizontal;
      horizontal.uniforms.tDiffuse.value = target.texture;
      horizontal.uniforms.h.value = radius / 512;
      renderer.setRenderTarget(buffer);
      renderer.render(screen, screenCamera);
      screen.material = vertical;
      vertical.uniforms.tDiffuse.value = buffer.texture;
      vertical.uniforms.v.value = radius / 512;
      renderer.setRenderTarget(target);
      renderer.render(screen, screenCamera);
    }
  } catch (error) {
    target.dispose();
    throw error;
  } finally {
    scene.overrideMaterial = previousOverride;
    renderer.shadowMap.enabled = previousShadow;
    renderer.setRenderTarget(previousTarget);
    buffer.dispose(); silhouette.dispose(); horizontal.dispose(); vertical.dispose(); screenGeometry.dispose();
  }
  const ground = new Mesh(new PlaneGeometry(14, 14), new MeshBasicMaterial({
    map: target.texture, transparent: true, opacity: .42, depthWrite: false, toneMapped: false,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(.14, -.55, .16);
  return {
    ground,
    dispose() { ground.geometry.dispose(); ground.material.dispose(); target.dispose(); },
  };
}
