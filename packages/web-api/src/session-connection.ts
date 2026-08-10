import {
  createInProcessSessionConnection,
  type Agent,
  type SessionConnection,
} from '@agentx/engine';

/** Resolve the adoption SessionConnection facade for an in-process agent. */
export function getSessionConnection(agent: Agent): SessionConnection {
  return createInProcessSessionConnection(agent);
}
