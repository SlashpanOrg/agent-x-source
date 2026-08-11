// pdfjs-dist (used by pdf-parse and @agentx/engine) requires DOMMatrix and
// Path2D to be defined as globals before it loads. @napi-rs/canvas normally
// provides these, but its native binding is not always available in CI/release
// tarballs, so install a minimal stub before any server code runs.
if (typeof globalThis !== 'undefined' && !('DOMMatrix' in globalThis)) {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;
    constructor(init?: string | number[]) {
      if (typeof init === 'string') {
        const parts = init.split(/[,\s]+/).map(Number).filter((n) => !Number.isNaN(n));
        if (parts.length >= 6) {
          this.a = parts[0]!; this.b = parts[1]!; this.c = parts[2]!;
          this.d = parts[3]!; this.e = parts[4]!; this.f = parts[5]!;
        }
      } else if (Array.isArray(init)) {
        if (init.length >= 6) {
          this.a = init[0]!; this.b = init[1]!; this.c = init[2]!;
          this.d = init[3]!; this.e = init[4]!; this.f = init[5]!;
        }
      }
    }
    translate(_x?: number, _y?: number, _z?: number): DOMMatrix { return this; }
    scale(_x?: number, _y?: number, _z?: number): DOMMatrix { return this; }
    rotate(_x?: number, _y?: number, _z?: number): DOMMatrix { return this; }
    rotateAxisAngle(_x?: number, _y?: number, _z?: number, _angle?: number): DOMMatrix { return this; }
    skewX(_angle?: number): DOMMatrix { return this; }
    skewY(_angle?: number): DOMMatrix { return this; }
    multiply(_other?: DOMMatrix): DOMMatrix { return this; }
    flipX(): DOMMatrix { return this; }
    flipY(): DOMMatrix { return this; }
    inverse(): DOMMatrix { return this; }
    setMatrixValue(_value: string): DOMMatrix { return this; }
    transformPoint(_point?: any): any { return { x: 0, y: 0, z: 0, w: 1 }; }
    toString(): string { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
  } as any;
}
if (typeof globalThis !== 'undefined' && !('Path2D' in globalThis)) {
  (globalThis as any).Path2D = class Path2D {
    addPath() { return this; }
    closePath() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    bezierCurveTo() { return this; }
    quadraticCurveTo() { return this; }
    arc() { return this; }
    arcTo() { return this; }
    ellipse() { return this; }
    rect() { return this; }
    roundRect() { return this; }
  } as any;
}

export {
  PostgresLifecycleManager,
  default as PostgresLifecycleManagerDefault,
} from './PostgresLifecycleManager.js';
export type {
  PostgresLifecycleOptions,
  PostgresBinaries,
} from './PostgresLifecycleManager.js';

export {
  RedisLifecycleManager,
  RedisBinaryResolver,
} from './RedisLifecycleManager.js';
export type {
  RedisLifecycleOptions,
} from './RedisLifecycleManager.js';

export {
  getSkillsVenvManager,
  SkillsVenvManager,
  resolveSkillsVenvPath,
  resolveSkillsVenvPython,
  applySkillsVenvEnv,
} from './skills-venv.js';

export {
  AgentRuntime,
  createDesktopRuntimeOptions,
  createServerRuntimeOptions,
  resolveRuntimePaths,
  setupPythonEnv,
  setupFfmpegEnv,
  resolvePublicUrl,
  resolveDefaultServerDataDir,
  readConfiguredPostgresPreference,
  isEmbeddedPostgresConnectionString,
  shouldStartEmbeddedPostgresAtBoot,
  DEFAULT_PORT,
  DEFAULT_EMBEDDED_PG_PORT,
} from './agent-runtime.js';
export type {
  AgentRuntimeOptions,
  AgentRuntimePaths,
  VaultStorageAdapter,
} from './agent-runtime.js';
