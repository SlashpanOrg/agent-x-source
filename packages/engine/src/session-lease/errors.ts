export class SessionAlreadyActiveError extends Error {
  readonly code = 'session_already_active';
  readonly holderOwnerId?: string;

  constructor(holderOwnerId?: string, message?: string) {
    super(message ?? (holderOwnerId
      ? `Session already active (holder: ${holderOwnerId})`
      : 'Session already has an active lease or run'));
    this.name = 'SessionAlreadyActiveError';
    this.holderOwnerId = holderOwnerId;
  }
}
