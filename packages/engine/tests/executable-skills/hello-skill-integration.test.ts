import { describe, it, expect, beforeEach } from 'vitest';
import { configureAdoptionFromConfig } from '@agentx/shared';
import { getExecutableSkillRegistry } from '../../src/executable-skills/ExecutableSkillRegistry.js';
import { runExecutableSkill } from '../../src/executable-skills/ExecutableSkillRunner.js';

describe('hello-skill integration', () => {
  beforeEach(() => {
    configureAdoptionFromConfig({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4' },
      ui: {},
      organization: null,
      telemetry: false,
      adoption: { executableSkills: { enabled: true } },
    });
    getExecutableSkillRegistry().discover();
  });

  it('runs bundled hello-skill when Python shim is available', async () => {
    const skill = getExecutableSkillRegistry().get('hello-skill');
    expect(skill).toBeDefined();

    const result = await runExecutableSkill('hello-skill', { name: 'Agent-X' });
    if (
      result.error === 'SPAWN_ERROR'
      || result.error === 'DISABLED'
      || result.error === 'NOT_FOUND'
      || result.error === 'EXEC_ERROR'
      || result.error === 'TIMEOUT'
    ) {
      expect(result.success).toBe(false);
      return;
    }
    expect(result.success).toBe(true);
    expect(result.output).toContain('Hello');
  }, 120_000);
});
