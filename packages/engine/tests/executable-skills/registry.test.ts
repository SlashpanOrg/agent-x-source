import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { discoverSkillPackages, parseSkillMd } from '../../src/executable-skills/SkillDiscovery.js';
import { getExecutableSkillRegistry } from '../../src/executable-skills/ExecutableSkillRegistry.js';

describe('ExecutableSkillRegistry', () => {
  const workspace = join(tmpdir(), `agentx-skills-test-${Date.now()}`);

  beforeEach(() => {
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4' },
      ui: {},
      organization: null,
      telemetry: false,
      adoption: { executableSkills: { enabled: true } },
    });
    mkdirSync(join(workspace, '.agent-x', 'skills', 'demo-skill'), { recursive: true });
    writeFileSync(
      join(workspace, '.agent-x', 'skills', 'demo-skill', 'SKILL.md'),
      `---
name: demo-skill
description: Demo skill for tests
triggers: demo, test
entrypoint: run.py
---
Body`,
      'utf-8',
    );
    writeFileSync(join(workspace, '.agent-x', 'skills', 'demo-skill', 'run.py'), 'def run(a): return a', 'utf-8');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('discovers project skills with precedence metadata', () => {
    const found = discoverSkillPackages({ workspacePath: workspace });
    const demo = found.find((s) => s.name === 'demo-skill');
    expect(demo).toBeDefined();
    expect(demo?.scope).toBe('project');
    expect(demo?.description).toBe('Demo skill for tests');
  });

  it('registers skills and exposes metadata-only prompt block', () => {
    const registry = getExecutableSkillRegistry();
    registry.discover({ workspacePath: workspace });
    const block = registry.getMetadataPromptBlock();
    expect(block).toContain('demo-skill');
    expect(block).not.toContain('Body');
  });

  it('parses SKILL.md frontmatter', () => {
    const path = join(workspace, '.agent-x', 'skills', 'demo-skill', 'SKILL.md');
    const { meta, body } = parseSkillMd(path);
    expect(meta.name).toBe('demo-skill');
    expect(body.trim()).toBe('Body');
  });
});
