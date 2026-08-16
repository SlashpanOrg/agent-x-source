export { KnowledgeBaseService } from './KnowledgeBaseService.js';
export type { KnowledgeBaseServiceOptions, KnowledgeBaseStatusListener } from './KnowledgeBaseService.js';
export { KnowledgeBaseSourceStore } from './KnowledgeBaseSourceStore.js';
export { DocumentIngestPipeline } from './DocumentIngestPipeline.js';
export type { DocumentIngestPipelineOptions } from './DocumentIngestPipeline.js';
export {
  extractKnowledgeSource,
  isScannedPdfExtractError,
  parseOcrPageText,
} from './ingest-extract.js';
export {
  OCR_STACK_TOOL_ID,
  detectOcrInstaller,
  errorNeedsOcrTools,
  getOcrInstallJob,
  getOcrToolStatus,
  startOcrStackInstall,
} from './ocr-tools.js';
export type { OcrInstallJob, OcrInstallerId, OcrToolProbe, OcrToolStatus } from './ocr-tools.js';
export { searchKnowledgeBaseDocuments } from './document-search.js';
export { getKnowledgeBaseService, setKnowledgeBaseService } from './global-manager.js';
