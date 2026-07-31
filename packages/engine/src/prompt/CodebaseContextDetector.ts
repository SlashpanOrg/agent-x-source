import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getLogger } from '@agentx/shared';

export interface BuildSystemInfo {
  system: 'npm' | 'pnpm' | 'yarn' | 'cargo' | 'make' | 'python' | 'go' | 'unknown';
  buildCommand?: string;
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  language: string;
  framework?: string;
}

export interface CodebaseContext {
  buildSystem: BuildSystemInfo;
  projectStructure: string[];
  entryPoints: string[];
  testFramework?: string;
  hasGit: boolean;
}

/**
 * Detects the project's build system, test framework, and entry points
 * by scanning for well-known config files in the workspace root.
 *
 * This context is injected into the prompt so the model knows exactly
 * which commands to run for verification — no guessing.
 */
export class CodebaseContextDetector {
  detect(scopePath: string): CodebaseContext {
    const buildSystem = this.detectBuildSystem(scopePath);
    const projectStructure = this.detectProjectStructure(scopePath);
    const entryPoints = this.detectEntryPoints(scopePath);
    const testFramework = this.detectTestFramework(scopePath, buildSystem);
    const hasGit = existsSync(join(scopePath, '.git'));

    return { buildSystem, projectStructure, entryPoints, testFramework, hasGit };
  }

  private detectBuildSystem(scopePath: string): BuildSystemInfo {
    // Node.js — package.json
    const pkgJsonPath = join(scopePath, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const scripts = pkg.scripts ?? {};
        const hasPnpm = existsSync(join(scopePath, 'pnpm-lock.yaml'));
        const hasYarn = existsSync(join(scopePath, 'yarn.lock'));
        const pm = hasPnpm ? 'pnpm' : hasYarn ? 'yarn' : 'npm';

        const buildCmd = scripts['build'] ? `${pm} run build` : undefined;
        const testCmd = scripts['test'] ? `${pm} test` : undefined;
        const lintCmd = scripts['lint'] ? `${pm} run lint` : undefined;
        const typecheckCmd = scripts['typecheck'] || scripts['tsc'] ? `${pm} run ${scripts['typecheck'] ? 'typecheck' : 'tsc'}` : undefined;

        const framework = pkg.dependencies?.['react'] ? 'react'
          : pkg.dependencies?.['express'] ? 'express'
          : pkg.dependencies?.['next'] ? 'next'
          : pkg.dependencies?.['vue'] ? 'vue'
          : undefined;

        return {
          system: pm as 'npm' | 'pnpm' | 'yarn',
          buildCommand: buildCmd,
          testCommand: testCmd,
          lintCommand: lintCmd,
          typecheckCommand: typecheckCmd,
          language: 'typescript/javascript',
          framework,
        };
      } catch {
        getLogger().warn('CODEBASE_CONTEXT', 'Failed to parse package.json');
      }
    }

    // Rust — Cargo.toml
    if (existsSync(join(scopePath, 'Cargo.toml'))) {
      return {
        system: 'cargo',
        buildCommand: 'cargo build',
        testCommand: 'cargo test',
        language: 'rust',
      };
    }

    // Go — go.mod
    if (existsSync(join(scopePath, 'go.mod'))) {
      return {
        system: 'go',
        buildCommand: 'go build ./...',
        testCommand: 'go test ./...',
        language: 'go',
      };
    }

    // Python — pyproject.toml or setup.py or requirements.txt
    if (existsSync(join(scopePath, 'pyproject.toml')) || existsSync(join(scopePath, 'setup.py')) || existsSync(join(scopePath, 'requirements.txt'))) {
      const hasPytest = existsSync(join(scopePath, 'pytest.ini')) || existsSync(join(scopePath, 'pyproject.toml'));
      return {
        system: 'python',
        buildCommand: undefined,
        testCommand: hasPytest ? 'pytest' : 'python -m unittest',
        language: 'python',
      };
    }

    // Make
    if (existsSync(join(scopePath, 'Makefile'))) {
      return {
        system: 'make',
        buildCommand: 'make',
        testCommand: 'make test',
        language: 'unknown',
      };
    }

    return { system: 'unknown', language: 'unknown' };
  }

  private detectProjectStructure(scopePath: string): string[] {
    const structure: string[] = [];
    const markers = [
      'src', 'lib', 'test', 'tests', '__tests__', 'spec', 'specs',
      'packages', 'apps', 'docs', 'scripts', 'bin', 'cmd',
      'internal', 'pkg', 'config', 'public', 'static', 'assets',
    ];
    for (const marker of markers) {
      if (existsSync(join(scopePath, marker))) {
        structure.push(marker);
      }
    }
    return structure;
  }

  private detectEntryPoints(scopePath: string): string[] {
    const candidates = [
      'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js',
      'src/app.ts', 'src/app.js', 'index.ts', 'index.js',
      'main.go', 'main.py', 'src/main.rs', 'lib/main.rb',
    ];
    return candidates.filter((c) => existsSync(join(scopePath, c)));
  }

  private detectTestFramework(scopePath: string, buildSystem: BuildSystemInfo): string | undefined {
    if (buildSystem.system === 'cargo') return 'cargo test';
    if (buildSystem.system === 'go') return 'go test';

    const pkgJsonPath = join(scopePath, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['jest']) return 'jest';
        if (deps['vitest']) return 'vitest';
        if (deps['mocha']) return 'mocha';
        if (deps['@playwright/test']) return 'playwright';
        if (deps['pytest']) return 'pytest';
      } catch { /* ignore */ }
    }

    if (existsSync(join(scopePath, 'pytest.ini')) || existsSync(join(scopePath, 'conftest.py'))) return 'pytest';

    return undefined;
  }

  formatContextBlock(ctx: CodebaseContext): string {
    const lines: string[] = ['[CODEBASE_CONTEXT]'];

    const bs = ctx.buildSystem;
    lines.push(`Language: ${bs.language}`);
    if (bs.framework) lines.push(`Framework: ${bs.framework}`);
    lines.push(`Build system: ${bs.system}`);
    if (bs.buildCommand) lines.push(`Build: ${bs.buildCommand}`);
    if (bs.testCommand) lines.push(`Test: ${bs.testCommand}`);
    if (bs.lintCommand) lines.push(`Lint: ${bs.lintCommand}`);
    if (bs.typecheckCommand) lines.push(`Typecheck: ${bs.typecheckCommand}`);

    if (ctx.testFramework) lines.push(`Test framework: ${ctx.testFramework}`);
    if (ctx.entryPoints.length > 0) lines.push(`Entry points: ${ctx.entryPoints.join(', ')}`);
    if (ctx.projectStructure.length > 0) lines.push(`Directories: ${ctx.projectStructure.join(', ')}`);
    lines.push(`Git: ${ctx.hasGit ? 'yes' : 'no'}`);

    lines.push('[/CODEBASE_CONTEXT]');
    return lines.join('\n');
  }
}
