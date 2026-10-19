import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Post-processing: bloom for lanterns and jutsu, then a grading pass with
// vignette, cool shadows / warm highlights, film grain and the red-tinted
// "Crimson Eye" view. Runs in linear HDR before tone mapping.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSense: { value: 0 },
    uHurt: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.55 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSense, uHurt, uGrain, uVignette;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Split tone: blue-teal shadows, warm highlights.
      vec3 shadowTint = vec3(0.86, 0.95, 1.18);
      vec3 highTint = vec3(1.08, 1.0, 0.9);
      c *= mix(shadowTint, highTint, smoothstep(0.02, 0.6, lum));
      // Crimson Eye: desaturate, push reds.
      vec3 grey = vec3(lum);
      vec3 sense = grey * vec3(1.5, 0.45, 0.4) + max(c - grey, 0.0) * vec3(2.0, 0.3, 0.3);
      c = mix(c, sense, uSense);
      // Vignette (stronger and red when hurt)
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d) * (1.0 + uVignette * 0.6));
      c *= mix(1.0, v, uVignette + uSense * 0.3);
      c = mix(c, c * vec3(1.0, 0.3, 0.3) + vec3(0.12, 0.0, 0.0) * (1.0 - v), uHurt * (1.0 - v));
      // Grain
      float n = hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5;
      c += n * uGrain * (0.3 + lum);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export const QUALITY = {
  low: { pixelRatio: 1, bloom: false, samples: 0, label: 'Low' },
  medium: { pixelRatio: 1.25, bloom: true, samples: 2, label: 'Medium' },
  high: { pixelRatio: 1.75, bloom: true, samples: 4, label: 'High' },
};

export class PostFX {
  constructor(renderer, scene, camera, quality = 'high') {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.build(quality);
  }

  build(quality) {
    this.quality = quality;
    const q = QUALITY[quality] || QUALITY.high;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.composer) this.composer.dispose();
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.samples });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = null;
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.7, 0.55, 0.92);
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.setSize(window.innerWidth, window.innerHeight);
  }

  setScene(scene) {
    this.scene = scene;
    this.renderPass.scene = scene;
  }

  setSize(w, h) {
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(t, { sense = 0, hurt = 0 } = {}) {
    const u = this.grade.uniforms;
    u.uTime.value = t;
    u.uSense.value += (sense - u.uSense.value) * 0.1;
    u.uHurt.value = hurt;
    this.composer.render();
  }
}
