export type ChannelId = string;

export type FocusState = 'focused' | 'background' | 'away';

export interface FocusChangeEvent {
  channelId: ChannelId;
  previousChannelId: ChannelId | null;
  timestamp: number;
}

export type FocusListener = (event: FocusChangeEvent) => void;

export class FocusManager {
  private currentFocus: ChannelId | null = null;
  private channelStates = new Map<ChannelId, FocusState>();
  private activityTimestamps = new Map<ChannelId, number>();
  private listeners = new Set<FocusListener>();

  static readonly ACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

  registerChannel(channelId: ChannelId): void {
    this.channelStates.set(channelId, 'background');
  }

  unregisterChannel(channelId: ChannelId): void {
    this.channelStates.delete(channelId);
    this.activityTimestamps.delete(channelId);
    if (this.currentFocus === channelId) {
      this.currentFocus = null;
    }
  }

  setFocus(channelId: ChannelId): void {
    const previous = this.currentFocus;
    if (previous === channelId) return;

    if (this.channelStates.has(channelId)) {
      this.currentFocus = channelId;
      this.channelStates.set(channelId, 'focused');
      this.activityTimestamps.set(channelId, Date.now());
      this.notifyListeners({ channelId, previousChannelId: previous, timestamp: Date.now() });
    }
  }

  onActivity(channelId: ChannelId): void {
    this.activityTimestamps.set(channelId, Date.now());
    if (this.channelStates.get(channelId) === 'focused') return;
    this.channelStates.set(channelId, 'focused');
    const previous = this.currentFocus;
    this.currentFocus = channelId;
    this.notifyListeners({ channelId, previousChannelId: previous, timestamp: Date.now() });
  }

  getFocus(): ChannelId | null {
    return this.currentFocus;
  }

  isFocused(channelId: ChannelId): boolean {
    return this.currentFocus === channelId;
  }

  getChannelState(channelId: ChannelId): FocusState {
    return this.channelStates.get(channelId) ?? 'away';
  }

  getActiveChannels(): ChannelId[] {
    return Array.from(this.channelStates.entries())
      .filter(([_, state]) => state !== 'away')
      .map(([id]) => id);
  }

  getAllChannels(): ChannelId[] {
    return Array.from(this.channelStates.keys());
  }

  hasActiveFocus(): boolean {
    const now = Date.now();
    if (!this.currentFocus) return false;
    const lastActivity = this.activityTimestamps.get(this.currentFocus) ?? 0;
    return (now - lastActivity) < FocusManager.ACTIVITY_TIMEOUT_MS;
  }

  onFocusChange(listener: FocusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getChannelPriority(channelId: ChannelId): number {
    const state = this.channelStates.get(channelId);
    if (state === 'focused') return 3;
    if (state === 'background') return 1;
    return 0;
  }

  private notifyListeners(event: FocusChangeEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch {}
    }
  }
}
