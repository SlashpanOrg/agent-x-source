import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

async function tryImport<T>(path: string, exportName: string): Promise<T | null> {
  try {
    const mod = await import(path);
    return mod[exportName] as T;
  } catch {
    return null;
  }
}

export async function aiComplete(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const prompt = args['prompt'] as string;
  const maxTokens = (args['maxTokens'] as number) ?? 256;

  if (!prompt) {
    return { success: false, output: 'prompt is required', error: 'MISSING_INPUT' };
  }

  try {
    const executeCompletion = await tryImport<(...args: unknown[]) => Promise<string>>('../../llm/completion.js', 'executeCompletion');
    if (!executeCompletion) {
      return { success: false, output: 'LLM completion module not available', error: 'MODULE_NOT_FOUND' };
    }
    const result = await executeCompletion({ messages: [{ role: 'user', content: `Complete this code:\n${prompt}` }], maxTokens, temperature: 0.2 });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, output: `AI completion failed: ${(error as Error).message}`, error: 'AI_ERROR' };
  }
}

export async function aiEmbed(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const text = args['text'] as string;
  if (!text) {
    return { success: false, output: 'text is required', error: 'MISSING_INPUT' };
  }

  try {
    const generateEmbedding = await tryImport<(...args: unknown[]) => Promise<number[]>>('../../llm/embeddings.js', 'generateEmbedding');
    if (!generateEmbedding) {
      return { success: false, output: 'Embeddings module not available', error: 'MODULE_NOT_FOUND' };
    }
    const embedding = await generateEmbedding(text);
    return { success: true, output: JSON.stringify(embedding), metadata: { dimensions: (embedding as number[]).length } };
  } catch (error) {
    return { success: false, output: `Embedding failed: ${(error as Error).message}`, error: 'AI_ERROR' };
  }
}

export async function aiSummarize(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const text = args['text'] as string;
  const maxLength = (args['maxLength'] as number) ?? 200;

  if (!text) {
    return { success: false, output: 'text is required', error: 'MISSING_INPUT' };
  }

  try {
    const executeCompletion = await tryImport<(...args: unknown[]) => Promise<string>>('../../llm/completion.js', 'executeCompletion');
    if (!executeCompletion) {
      return { success: false, output: `Summary: ${text.slice(0, maxLength)}... (LLM module not available, returning truncated text)` };
    }
    const result = await executeCompletion({ messages: [{ role: 'user', content: `Summarize in ${maxLength} chars:\n\n${text.slice(0, 10000)}` }], maxTokens: maxLength, temperature: 0.3 });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, output: `Summarization failed: ${(error as Error).message}`, error: 'AI_ERROR' };
  }
}

export async function aiClassify(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const text = args['text'] as string;
  const categories = args['categories'] as string;

  if (!text || !categories) {
    return { success: false, output: 'text and categories are required', error: 'MISSING_INPUT' };
  }

  try {
    const executeCompletion = await tryImport<(...args: unknown[]) => Promise<string>>('../../llm/completion.js', 'executeCompletion');
    if (!executeCompletion) {
      return { success: false, output: 'LLM module not available, cannot classify', error: 'MODULE_NOT_FOUND' };
    }
    const result = await executeCompletion({ messages: [{ role: 'user', content: `Classify this text: ${text.slice(0, 5000)}\nCategories: ${categories}\nAnswer (one category):` }], maxTokens: 50, temperature: 0.1 });
    return { success: true, output: result.trim() };
  } catch (error) {
    return { success: false, output: `Classification failed: ${(error as Error).message}`, error: 'AI_ERROR' };
  }
}

export async function aiExtract(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const text = args['text'] as string;
  const schema = args['schema'] as string;

  if (!text || !schema) {
    return { success: false, output: 'text and schema are required', error: 'MISSING_INPUT' };
  }

  try {
    const executeCompletion = await tryImport<(...args: unknown[]) => Promise<string>>('../../llm/completion.js', 'executeCompletion');
    if (!executeCompletion) {
      return { success: false, output: 'LLM module not available, cannot extract', error: 'MODULE_NOT_FOUND' };
    }
    const result = await executeCompletion({ messages: [{ role: 'user', content: `Extract from text per schema: ${schema}\n\nText: ${text.slice(0, 10000)}\n\nReturn JSON.` }], maxTokens: 1000, temperature: 0.1 });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, output: `Extraction failed: ${(error as Error).message}`, error: 'AI_ERROR' };
  }
}

export async function memoryStore(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const key = args['key'] as string;
  const value = args['value'] as string;

  if (!key || value === undefined) {
    return { success: false, output: 'key and value are required', error: 'MISSING_INPUT' };
  }

  try {
    const storeMemory = await tryImport<(key: string, value: string) => Promise<void>>('../../memory/index.js', 'storeMemory');
    if (!storeMemory) {
      return { success: false, output: 'Memory module not available', error: 'MODULE_NOT_FOUND' };
    }
    await storeMemory(key, value);
    return { success: true, output: `Stored: ${key} = ${value.length > 50 ? value.slice(0, 50) + '...' : value}` };
  } catch (error) {
    return { success: false, output: `Memory store failed: ${(error as Error).message}`, error: 'MEMORY_ERROR' };
  }
}

export async function memoryRecall(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const key = args['key'] as string;

  if (!key) {
    return { success: false, output: 'key is required', error: 'MISSING_INPUT' };
  }

  try {
    const recallMemory = await tryImport<(key: string) => Promise<string | null>>('../../memory/index.js', 'recallMemory');
    if (!recallMemory) {
      return { success: false, output: 'Memory module not available', error: 'MODULE_NOT_FOUND' };
    }
    const value = await recallMemory(key);
    if (value === null || value === undefined) {
      return { success: true, output: `No value found for key: ${key}` };
    }
    return { success: true, output: value };
  } catch (error) {
    return { success: false, output: `Memory recall failed: ${(error as Error).message}`, error: 'MEMORY_ERROR' };
  }
}
