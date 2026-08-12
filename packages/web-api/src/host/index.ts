export { createHostRouter, mergeHostConfigPreservingSecrets } from './routes.js';
export {
  HostGateway,
  getHostGateway,
  tryGetHostGateway,
  initHostGateway,
  setHostGateway,
  redactHostConfigForSnapshot,
} from './HostGateway.js';
export type { HostGatewayOptions } from './HostGateway.js';
export {
  PublicEdgeRegistry,
  getPublicEdgeRegistry,
  setPublicEdgeRegistry,
  idleTunnelStatus,
} from './PublicEdgeGateway.js';
export type { PublicEdgeProvider, EdgeStartRequest } from './PublicEdgeGateway.js';
export { FakeEdgeProvider } from './providers/FakeEdgeProvider.js';
export { NgrokEdgeProvider } from './providers/NgrokEdgeProvider.js';
export {
  buildNetworkSnapshot,
  collectHostAddresses,
  classifyIPv4,
  classifyIPv6,
  deriveExposureState,
  fetchPublicIp,
  redactAddressesForRemote,
} from './discovery.js';
export {
  isPublicEdgePathAllowed,
  looksLikePublicEdgeRequest,
  publicEdgeGuard,
  edgeMetricPathLabel,
  PUBLIC_EDGE_ALLOWLIST,
  PUBLIC_EDGE_DENYLIST,
} from './middleware/public-edge-policy.js';
export {
  createRateLimiter,
  publicApiRateLimit,
  loginRateLimit,
  accountRateLimit,
  webhookRateLimit,
  resetHostRateLimiters,
  clientIp,
} from './middleware/rate-limit.js';
export type { RateLimitOptions, RateLimiter } from './middleware/rate-limit.js';
export { csrfOriginGuard } from './middleware/csrf-origin.js';
export { recordHostEvent, listHostEvents, clearHostEvents } from './audit.js';
export type { HostAuditEvent, HostEventCategory } from './audit.js';
export { buildDiagnosticBundle } from './diagnostics.js';
export type { DiagnosticBundle } from './diagnostics.js';
export {
  applyHostConfig,
  ensureHostAndTelephonyBootstrapped,
  writeHostCleanShutdownMarker,
} from './apply-host-config.js';
