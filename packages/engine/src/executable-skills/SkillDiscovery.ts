import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ExecutableSkillManifest, SkillPackageRef } from '@agentx/shared';

export type SkillDiscoveryScope = SkillPackageRef['scope'];

export interface SkillDiscoveryOptions {
  workspacePath?: string;
  extraPaths?: string[];
}

/** Precedence (low → high): bundled < global < project < settings paths < CLI paths. */
export const SKILL_PRECEDENCE_ORDER: SkillDiscoveryScope[] = ['bundled', 'global', 'project'];

function parseFrontmatter(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
    if (!m) continue;
    out[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

export function parseSkillMd(skillMdPath: string): {
  meta: Record<string, string>;
  body: string;
} {
  const text = readFileSync(skillMdPath, 'utf-8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: text };
  }
  return { meta: parseFrontmatter(match[1]!), body: match[2] ?? '' };
}

function listSkillDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(root, d.name))
    .filter((p) => existsSync(join(p, 'SKILL.md')));
}

export function resolveBundledSkillsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', 'skills'),
    join(here, '..', 'skills'),
    join(process.cwd(), 'packages/engine/skills'),
    join(process.cwd(), 'packages/engine/dist/skills'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return candidates[0]!;
}

export function discoverSkillPackages(options: SkillDiscoveryOptions = {}): ExecutableSkillManifest[] {
  const byName = new Map<string, ExecutableSkillManifest>();
  const layers: Array<{ scope: SkillDiscoveryScope; paths: string[] }> = [
    { scope: 'bundled', paths: [resolveBundledSkillsRoot()] },
    { scope: 'global', paths: [join(homedir(), '.agent-x', 'skills')] },
    { scope: 'project', paths: [] },
  ];

  if (options.workspacePath) {
    layers.find((l) => l.scope === 'project')!.paths.push(join(options.workspacePath, '.agent-x', 'skills'));
  }
  if (options.extraPaths?.length) {
    layers.push({ scope: 'project', paths: options.extraPaths });
  }

  for (const layer of layers) {
    for (const root of layer.paths) {
      for (const pkgPath of listSkillDirs(root)) {
        const skillMdPath = join(pkgPath, 'SKILL.md');
        const { meta } = parseSkillMd(skillMdPath);
        const folderName = pkgPath.split(/[/\\]/).pop() ?? pkgPath;
        const name = meta.name || folderName;
        const description = meta.description || name;
        const triggers = meta.triggers
          ? meta.triggers.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined;
        const entrypoint = meta.entrypoint || 'run.py';
        const highRisk = meta.risk === 'high' || meta.high_risk === 'true';
        byName.set(name, {
          name,
          description,
          version: meta.version,
          triggers,
          entrypoint,
          packagePath: pkgPath,
          skillMdPath,
          scope: layer.scope,
          highRisk,
        });
      }
    }
  }

  return [...byName.values()];
}

export function formatSkillMetadataForPrompt(skills: ExecutableSkillManifest[]): string {
  if (!skills.length) return '';
  const lines = [
    'EXECUTABLE SKILLS (metadata only — use executable_skill_run or load SKILL.md on demand):',
    'Precedence: project > global > bundled.',
  ];
  for (const s of skills.slice(0, 24)) {
    lines.push(`- ${s.name} (${s.scope}): ${s.description}`);
    if (s.triggers?.length) lines.push(`  triggers: ${s.triggers.join(', ')}`);
    if (s.highRisk) lines.push('  risk: high (permission required)');
  }
  if (skills.length > 24) lines.push(`… ${skills.length - 24} more skills omitted`);
  return lines.join('\n');
}

export function loadSkillMarkdown(manifest: ExecutableSkillManifest): string {
  const path = manifest.skillMdPath ?? join(manifest.packagePath, 'SKILL.md');
  return readFileSync(path, 'utf-8');
}
