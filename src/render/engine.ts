import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/**
 * Rendering engine wrapper: WebGPURenderer (WebGPU with automatic WebGL2
 * fallback), HDR pipeline with ACES tone mapping and bloom.
 */
export class Engine {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private postProcessing!: THREE.PostProcessing;

  private constructor(container: HTMLElement) {
    // `?webgl` forces the WebGL2 backend (also used by headless test runs
    // where SwiftShader's WebGPU implementation is unreliable).
    const forceWebGL = new URLSearchParams(location.search).has('webgl');
    this.renderer = new THREE.WebGPURenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      forceWebGL,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      1, // km; near/far are generous thanks to the logarithmic depth buffer
      1e12,
    );

    window.addEventListener('resize', () => this.onResize(container));
  }

  static async create(container: HTMLElement): Promise<Engine> {
    const engine = new Engine(container);
    await engine.renderer.init();
    engine.setupPostProcessing();
    return engine;
  }

  get backend(): 'webgpu' | 'webgl2' {
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean };
    return backend.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
  }

  private setupPostProcessing(): void {
    this.postProcessing = new THREE.PostProcessing(this.renderer);
    const scenePass = pass(this.scene, this.camera);
    const color = scenePass.getTextureNode('output');
    // threshold 1.0: only HDR values above 1 bloom (the Sun, bright limbs)
    const bloomPass = bloom(color, 0.7, 0.4, 1.0);
    this.postProcessing.outputNode = color.add(bloomPass);
  }

  private onResize(container: HTMLElement): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  async render(): Promise<void> {
    await this.postProcessing.renderAsync();
  }

  /** 0 = low, 1 = medium, 2 = high */
  setQuality(level: number): void {
    const ratios = [0.75, 1, Math.min(window.devicePixelRatio, 2)];
    this.renderer.setPixelRatio(ratios[Math.max(0, Math.min(2, level))]);
  }
}
