export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  error?: string;
}

export interface SandboxOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  allowedPaths?: string[];
  deniedPaths?: string[];
  memoryLimit?: number;
  networkAccess?: boolean;
}

export interface Sandbox {
  readonly name: string;
  readonly available: boolean;

  exec(command: string, options?: SandboxOptions): Promise<SandboxResult>;
  execBackground(command: string, options?: SandboxOptions): Promise<{ pid: number }>;
  kill(pid: number): Promise<boolean>;
  list(): Promise<Array<{ pid: number; command: string }>>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  dispose(): Promise<void>;
}
