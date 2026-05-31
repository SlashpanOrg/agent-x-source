export interface Document {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

export interface Embedding {
  vector: number[];
  model: string;
  dimensions: number;
}

export interface ChunkedDocument {
  id: string;
  chunks: Array<{ text: string; index: number; embedding?: number[] }>;
  metadata?: Record<string, unknown>;
}

export interface VectorStore {
  readonly name: string;
  readonly dimensions: number;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  insert(documents: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void>;
  search(query: number[], topK?: number): Promise<Document[]>;
  delete(ids: string[]): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface RAGConfig {
  enabled: boolean;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  minScore: number;
}
