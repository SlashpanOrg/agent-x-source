export class AuthProfileManager {
  private credentials = new Map<string, string[]>();
  private cooldowns = new Map<string, number>();
  private currentIndex = new Map<string, number>();
  private readonly COOLDOWN_MS = 60000;
  private readonly MAX_COOLDOWN_MS = 300000;

  addCredential(provider: string, apiKey: string): void {
    const keys = this.credentials.get(provider) ?? [];
    if (!keys.includes(apiKey)) {
      keys.push(apiKey);
      this.credentials.set(provider, keys);
    }
  }

  setCredentials(provider: string, apiKeys: string[]): void {
    this.credentials.set(provider, [...apiKeys]);
    this.currentIndex.set(provider, 0);
  }

  async getCredential(provider: string): Promise<string> {
    const keys = this.credentials.get(provider);
    if (!keys || keys.length === 0) {
      throw new Error(`No credentials available for provider "${provider}"`);
    }

    const now = Date.now();
    const cooldownUntil = this.cooldowns.get(provider) ?? 0;

    if (cooldownUntil > now) {
      throw new Error(
        `Provider "${provider}" is in cooldown until ${new Date(cooldownUntil).toISOString()}`,
      );
    }

    const idx = this.currentIndex.get(provider) ?? 0;
    return keys[idx % keys.length]!;
  }

  rotate(provider: string): string {
    const keys = this.credentials.get(provider);
    if (!keys || keys.length <= 1) {
      throw new Error(
        `Cannot rotate: provider "${provider}" has ${keys?.length ?? 0} profiles`,
      );
    }

    const currentIdx = this.currentIndex.get(provider) ?? 0;
    const nextIdx = (currentIdx + 1) % keys.length;
    this.currentIndex.set(provider, nextIdx);

    const now = Date.now();
    const existingCooldown = this.cooldowns.get(provider) ?? 0;
    const cooldownMs = Math.min(
      this.COOLDOWN_MS * 2 ** (this.rotationCount(provider) - 1),
      this.MAX_COOLDOWN_MS,
    );
    this.cooldowns.set(provider, Math.max(now + cooldownMs, existingCooldown));

    return keys[nextIdx]!;
  }

  canRotate(provider: string): boolean {
    const keys = this.credentials.get(provider);
    return (keys?.length ?? 0) > 1;
  }

  getProviderCount(): number {
    return this.credentials.size;
  }

  getProfileCount(provider: string): number {
    return this.credentials.get(provider)?.length ?? 0;
  }

  isInCooldown(provider: string): boolean {
    const cooldownUntil = this.cooldowns.get(provider) ?? 0;
    return cooldownUntil > Date.now();
  }

  clearCooldown(provider: string): void {
    this.cooldowns.delete(provider);
  }

  private rotationCount(provider: string): number {
    const idx = this.currentIndex.get(provider) ?? 0;
    return idx + 1;
  }
}
