import {
  AmbientLight, Box3, DirectionalLight, Group, HemisphereLight, Matrix4, Mesh,
  OrthographicCamera, PCFSoftShadowMap, Quaternion, Scene, SRGBColorSpace,
  Vector3, WebGLRenderer, ACESFilmicToneMapping, type Material,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Vrai volume fermé, rendu local et rotations sans limites ni service tiers. */
export async function mountRelief(art: HTMLElement): Promise<void> {
  const stage = art.querySelector<HTMLElement>('[data-relief-stage]');
  const status = art.querySelector<HTMLElement>('[data-relief-status]');
  const actions = art.querySelector<HTMLElement>('[data-relief-actions]');
  const touch = art.querySelector<HTMLButtonElement>('[data-relief-touch]');
  const site = art.closest<HTMLElement>('.atlas-site');
  if (!stage || !status || !actions || !touch || !site) throw new Error('Relief incomplet');
  const lifecycle = new AbortController();
  const request = new AbortController();
  const timer = window.setTimeout(() => request.abort(), 18000);
  let renderer: WebGLRenderer | undefined;
  let model: Group | undefined;
  let shadow: DirectionalLight['shadow'] | undefined;
  let disposed = false;
  let frame = 0;
  let resizeObserver: ResizeObserver | undefined;
  let visibilityObserver: IntersectionObserver | undefined;
  let motionObserver: MutationObserver | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    request.abort();
    lifecycle.abort();
    resizeObserver?.disconnect();
    visibilityObserver?.disconnect();
    motionObserver?.disconnect();
    model?.traverse(node => {
      if (!(node instanceof Mesh)) return;
      node.geometry.dispose();
      const materials: Material[] = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => material.dispose());
    });
    shadow?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
  };
  const fallback = () => {
    dispose();
    stage.hidden = true;
    actions.hidden = true;
    art.querySelector<HTMLElement>('[data-relief-hint]')!.hidden = true;
    art.dataset.reliefState = 'fallback';
    art.dataset.touchActive = 'false';
    touch.setAttribute('aria-pressed', 'false');
    touch.textContent = touch.dataset.labelOff || '';
    status.textContent = art.dataset.error || '';
    art.dispatchEvent(new Event('atlas-relief-failed'));
  };
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      fallback();
    }, { signal: lifecycle.signal });
    const url = new URL(art.dataset.modelUrl || '', location.href);
    if (url.origin !== location.origin) throw new Error('Origine du relief invalide');
    const response = await fetch(url, { credentials: 'omit', signal: request.signal, cache: 'force-cache' });
    if (!response.ok || !response.body) throw new Error('Relief indisponible');
    const bytes = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if (bytes.byteLength > 24 * 1024 * 1024) throw new Error('Relief trop volumineux');
    const gltf = await new GLTFLoader().parseAsync(bytes, '');
    model = gltf.scene;
    if (disposed) {
      model.traverse(node => { if (node instanceof Mesh) { node.geometry.dispose(); const materials = Array.isArray(node.material) ? node.material : [node.material]; materials.forEach(material => material.dispose()); } });
      throw new Error('Chargement interrompu');
    }
    const box = new Box3().setFromObject(model);
    if (!Number.isFinite(box.max.x) || box.getSize(new Vector3()).length() > 20) throw new Error('Géométrie invalide');
    // Le relief est éclairé par ses normales ; les ombres portées soulignent la frappe du socle.
    model.traverse(node => {
      if (node instanceof Mesh) { node.castShadow = true; node.receiveShadow = typeof node.userData.inscription === 'string'; }
    });
    const scene = new Scene();
    const pivot = new Group();
    pivot.add(model);
    scene.add(pivot);
    scene.add(new HemisphereLight(0xfffaef, 0x536958, 1.05));
    scene.add(new AmbientLight(0xfff7eb, .12));
    const key = new DirectionalLight(0xffefcf, 2.8);
    key.position.set(-5, 5, 6);
    key.castShadow = true;
    shadow = key.shadow;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -7;
    key.shadow.camera.right = key.shadow.camera.top = 7;
    key.shadow.camera.near = .1;
    key.shadow.camera.far = 40;
    key.shadow.normalBias = .014;
    key.shadow.bias = -.0001;
    scene.add(key);
    const fill = new DirectionalLight(0xeaf4ff, .7);
    fill.position.set(6, 4, -4);
    scene.add(fill);
    const front = new DirectionalLight(0xfffaf2, .3);
    front.position.set(1, 2, 8);
    scene.add(front);
    const camera = new OrthographicCamera(-6.25, 6.25, 6.25, -6.25, .1, 100);
    camera.position.set(-3.8, 11, 7);
    camera.lookAt(0, .25, 0);
    const screenRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const screenUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const rotation = new Quaternion();
    const orientation = new Quaternion();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true;
    let manual = false;
    let touchEnabled = false;
    let pointer: { id: number; x: number; y: number } | undefined;
    let tween: { start: number; from: Quaternion; to: Quaternion } | undefined;
    let lastAmbientFrame = 0;
    const automatic = () => !manual && !reduced.matches && site.dataset.motion !== 'off';

    function requestFrame() {
      if (!disposed && visible && !document.hidden && !frame) frame = requestAnimationFrame(draw);
    }
    function draw(now: number) {
      frame = 0;
      if (disposed || !visible || document.hidden) return;
      if (automatic() && !tween && now - lastAmbientFrame < 33) { requestFrame(); return; }
      lastAmbientFrame = now;
      if (tween) {
        const progress = Math.min(1, (now - tween.start) / 700);
        orientation.slerpQuaternions(tween.from, tween.to, 1 - Math.pow(1 - progress, 3));
        if (progress === 1) tween = undefined;
      }
      pivot.quaternion.copy(orientation);
      if (automatic()) {
        pivot.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.sin(now / 4000) * .022));
        pivot.position.y = Math.sin(now / 1900) * .035;
      } else pivot.position.y = 0;
      renderer!.render(scene, camera);
      if (tween || automatic()) requestFrame();
    }
    const resize = () => {
      const width = stage.clientWidth, height = stage.clientHeight;
      if (!width || !height || disposed) return;
      const aspect = width / height;
      const halfHeight = Math.max(6.05, 6.05 / aspect);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      renderer!.setPixelRatio(Math.min(devicePixelRatio, 1.6));
      renderer!.setSize(width, height, false);
      requestFrame();
    };
    const setOrientation = (to: Quaternion, message: string) => {
      manual = true;
      if (reduced.matches || site.dataset.motion === 'off') { orientation.copy(to); tween = undefined; }
      else tween = { start: performance.now(), from: orientation.clone(), to };
      status.textContent = message;
      requestFrame();
    };
    const rotate = (dx: number, dy: number) => {
      manual = true;
      tween = undefined;
      orientation.premultiply(rotation.setFromAxisAngle(screenUp, dx));
      orientation.premultiply(rotation.setFromAxisAngle(screenRight, dy));
      orientation.normalize();
      art.dataset.reliefView = 'custom';
      requestFrame();
    };
    const release = () => {
      if (pointer && stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id);
      pointer = undefined;
      stage.classList.remove('is-dragging');
    };
    stage.addEventListener('pointerdown', event => {
      if (event.button !== 0 || pointer || (event.pointerType === 'touch' && !touchEnabled)) return;
      manual = true;
      tween = undefined;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add('is-dragging');
      stage.focus({ preventScroll: true });
    }, { signal: lifecycle.signal });
    stage.addEventListener('pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      rotate((event.clientX - pointer.x) * .008, (event.clientY - pointer.y) * .008);
      pointer.x = event.clientX; pointer.y = event.clientY;
    }, { signal: lifecycle.signal });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => stage.addEventListener(type, release, { signal: lifecycle.signal }));
    stage.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const step = event.shiftKey ? .35 : .15;
      if (event.key === 'ArrowLeft') rotate(-step, 0);
      else if (event.key === 'ArrowRight') rotate(step, 0);
      else if (event.key === 'ArrowUp') rotate(0, -step);
      else if (event.key === 'ArrowDown') rotate(0, step);
      else if (event.key === 'Home') { setOrientation(new Quaternion(), art.dataset.frontState || ''); art.dataset.reliefView = 'front'; }
      else if (event.key === 'Escape' && touchEnabled) { touch.click(); touch.focus(); }
      else return;
      event.preventDefault();
    }, { signal: lifecycle.signal });
    touch.addEventListener('click', () => {
      touchEnabled = !touchEnabled;
      art.dataset.touchActive = String(touchEnabled);
      touch.setAttribute('aria-pressed', String(touchEnabled));
      touch.textContent = touchEnabled ? touch.dataset.labelOn || '' : touch.dataset.labelOff || '';
      if (touchEnabled) stage.focus({ preventScroll: true });
      else release();
    }, { signal: lifecycle.signal });
    art.querySelector('[data-relief-back]')?.addEventListener('click', () => {
      setOrientation(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(screenRight, new Vector3(0, 0, -1).applyQuaternion(camera.quaternion), screenUp)).premultiply(new Quaternion().setFromAxisAngle(screenRight, .18)), art.dataset.backState || '');
      art.dataset.reliefView = 'back';
    }, { signal: lifecycle.signal });
    art.querySelector('[data-relief-reset]')?.addEventListener('click', () => {
      setOrientation(new Quaternion(), art.dataset.frontState || '');
      art.dataset.reliefView = 'front';
    }, { signal: lifecycle.signal });
    const syncMotion = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (reduced.matches || site.dataset.motion === 'off') {
        if (tween) orientation.copy(tween.to);
        tween = undefined;
      }
      requestFrame();
    };
    reduced.addEventListener('change', syncMotion, { signal: lifecycle.signal });
    document.addEventListener('visibilitychange', syncMotion, { signal: lifecycle.signal });
    motionObserver = new MutationObserver(syncMotion);
    motionObserver.observe(site, { attributes: true, attributeFilter: ['data-motion'] });
    if ('IntersectionObserver' in window) {
      visibilityObserver = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        syncMotion();
      });
      visibilityObserver.observe(art);
    }
    window.addEventListener('pagehide', event => {
      cancelAnimationFrame(frame); frame = 0;
      if (!event.persisted) dispose();
    }, { signal: lifecycle.signal });
    window.addEventListener('pageshow', requestFrame, { signal: lifecycle.signal });
    stage.append(renderer.domElement);
    stage.hidden = false;
    actions.hidden = false;
    art.querySelector<HTMLElement>('[data-relief-hint]')!.hidden = false;
    art.dataset.reliefState = 'ready';
    art.dataset.reliefView = 'front';
    status.textContent = art.dataset.ready || '';
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    resize();
  } catch (error) {
    dispose();
    throw error;
  } finally { clearTimeout(timer); }
}
