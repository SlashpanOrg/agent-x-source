import { describe, it, expect } from 'vitest';

describe('ConfigManager', () => {
  it('module can be imported', async () => {
    const { ConfigManager } = await import('../src/config/ConfigManager.js');
    expect(ConfigManager).toBeDefined();
  });
});

describe('SecretSauceManager', () => {
  it('module can be imported', async () => {
    const { SecretSauceManager } = await import('../src/secret-sauce/index.js');
    expect(SecretSauceManager).toBeDefined();
  });
});

describe('CrewManager', () => {
  it('module can be imported', async () => {
    const { CrewManager } = await import('../src/secret-sauce/CrewManager.js');
    expect(CrewManager).toBeDefined();
  });
});

describe('SoulManager', () => {
  it('module can be imported', async () => {
    const { SoulManager } = await import('../src/secret-sauce/SoulManager.js');
    expect(SoulManager).toBeDefined();
  });
});

describe('MemoryManager', () => {
  it('module can be imported', async () => {
    const { MemoryManager } = await import('../src/secret-sauce/MemoryManager.js');
    expect(MemoryManager).toBeDefined();
  });
});

describe('EnhancedToolExecutor', () => {
  it('module can be imported', async () => {
    const { EnhancedToolExecutor } = await import('../src/tools/EnhancedToolExecutor.js');
    expect(EnhancedToolExecutor).toBeDefined();
  });
});
