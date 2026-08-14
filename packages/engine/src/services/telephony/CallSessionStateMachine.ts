/**
 * Provider-neutral call session lifecycle:
 *   created → ringing → connected → disclosing → active → transferring → completed/failed/cancelled
 *
 * Adapters/webhooks report provider-specific statuses; everything above the
 * adapter boundary only ever sees these states.
 */
export type CallSessionState =
  | 'created'
  | 'ringing'
  | 'connected'
  | 'disclosing'
  | 'active'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'cancelled';

const TRANSITIONS: Record<CallSessionState, readonly CallSessionState[]> = {
  created: ['ringing', 'connected', 'failed', 'cancelled'],
  ringing: ['connected', 'failed', 'cancelled'],
  connected: ['disclosing', 'active', 'completed', 'failed', 'cancelled'],
  disclosing: ['active', 'completed', 'failed', 'cancelled'],
  active: ['transferring', 'completed', 'failed', 'cancelled'],
  transferring: ['active', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_CALL_SESSION_STATES: ReadonlySet<CallSessionState> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export class IllegalCallSessionTransitionError extends Error {
  constructor(
    public readonly from: CallSessionState,
    public readonly to: CallSessionState,
  ) {
    super(`Illegal call session transition: ${from} -> ${to}`);
    this.name = 'IllegalCallSessionTransitionError';
  }
}

export class CallSessionStateMachine {
  static isTerminal(state: CallSessionState): boolean {
    return TERMINAL_CALL_SESSION_STATES.has(state);
  }

  static allowedTransitions(from: CallSessionState): readonly CallSessionState[] {
    return TRANSITIONS[from] ?? [];
  }

  static canTransition(from: CallSessionState, to: CallSessionState): boolean {
    if (from === to) return false;
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  /** Returns `to` on a legal transition, throws IllegalCallSessionTransitionError otherwise. */
  static transition(from: CallSessionState, to: CallSessionState): CallSessionState {
    if (!CallSessionStateMachine.canTransition(from, to)) {
      throw new IllegalCallSessionTransitionError(from, to);
    }
    return to;
  }
}

/** Standalone convenience export mirroring `CallSessionStateMachine.transition`. */
export function transition(from: CallSessionState, to: CallSessionState): CallSessionState {
  return CallSessionStateMachine.transition(from, to);
}
