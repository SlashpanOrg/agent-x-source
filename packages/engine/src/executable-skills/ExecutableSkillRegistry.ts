import type { ExecutableSkillManifest, SkillPackageRef } from '@agentx/shared';
import { isExecutableSkillsEnabled } from '@agentx/shared';
import {
  discoverSkillPackages,
  formatSkillMetadataForPrompt,
  loadSkillMarkdown,
  type SkillDiscoveryOptions,
} from './SkillDiscovery.js';

export class ExecutableSkillRegistry {
  private readonly skills = new Map<string, ExecutableSkillManifest>();
  private lastDiscoveryOptions: SkillDiscoveryOptions | null = null;

  isEnabled(): boolean {
    return isExecutableSkillsEnabled();
  }

  discover(options: SkillDiscoveryOptions = {}): ExecutableSkillManifest[] {
    if (!this.isEnabled()) return [];
    this.lastDiscoveryOptions = options;
    this.skills.clear();
    const manifests = discoverSkillPackages(options);
    for (const m of manifests) {
      this.skills.set(m.name, m);
    }
    return manifests;
  }

  register(manifest: ExecutableSkillManifest): void {
    if (!this.isEnabled()) return;
    this.skills.set(manifest.name, manifest);
  }

  list(): ExecutableSkillManifest[] {
    return [...this.skills.values()];
  }

  get(id: string): ExecutableSkillManifest | undefined {
    return this.skills.get(id);
  }

  resolve(ref: SkillPackageRef): ExecutableSkillManifest | undefined {
    return this.skills.get(ref.name);
  }

  getMetadataPromptBlock(): string {
    if (!this.isEnabled()) return '';
    if (this.skills.size === 0 && this.lastDiscoveryOptions) {
      this.discover(this.lastDiscoveryOptions);
    }
    return formatSkillMetadataForPrompt(this.list());
  }

  loadSkillMd(name: string): string | undefined {
    const manifest = this.get(name);
    if (!manifest) return undefined;
    return loadSkillMarkdown(manifest);
  }

  refresh(workspacePath?: string): ExecutableSkillManifest[] {
    return this.discover({ workspacePath });
  }
}

let registry: ExecutableSkillRegistry | null = null;

export function getExecutableSkillRegistry(): ExecutableSkillRegistry {
  if (!registry) registry = new ExecutableSkillRegistry();
  return registry;
}
