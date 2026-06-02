export const PROVIDER_OVERLAYS: Record<string, string> = {
  openai:
    '## Provider: OpenAI\n' +
    '- You have access to native function calling with streaming.\n' +
    '- Tool use should be persistent across conversation turns.\n' +
    '- Verify tool results before proceeding with dependent actions.\n' +
    '- When using structured outputs, ensure JSON is valid and complete.',

  anthropic:
    '## Provider: Anthropic\n' +
    '- You have access to tool use with thinking/reasoning capabilities.\n' +
    '- Preserve thinking signatures when replaying tool results.\n' +
    '- Use prompt caching markers for optimal performance.\n' +
    '- Prefer concise tool responses within the cache boundary.',

  google:
    '## Provider: Google Gemini\n' +
    '- Be concise in responses.\n' +
    '- Use strict tool argument discipline — provide complete, valid JSON arguments.\n' +
    '- Avoid ambiguous tool call patterns.\n' +
    '- Follow API constraints for message ordering (user/assistant alternation).',

  deepseek:
    '## Provider: DeepSeek\n' +
    '- Strong coding and reasoning capabilities.\n' +
    '- Use function calling for tool operations.\n' +
    '- Provide detailed code analysis when requested.',

  'openai-compatible':
    '## Provider: OpenAI-Compatible\n' +
    '- This is a generic OpenAI-compatible API endpoint.\n' +
    '- Use strict JSON formatting for all tool arguments.\n' +
    '- Expect standard OpenAI function-calling behavior.\n' +
    '- Handle edge cases gracefully — the API may have quirks.\n' +
    '- Fall back to text responses if tool calling is unreliable.',

  ollama:
    '## Provider: Ollama (Local)\n' +
    '- Local model — may have limited context windows.\n' +
    '- Tool calling support varies by model.\n' +
    '- If tool calling fails, use plain-text patterns: `[tool_name] { json } [/tool_name]`.\n' +
    '- Be more explicit in instructions since local models may be less capable.',

  lmstudio:
    '## Provider: LM Studio (Local)\n' +
    '- Local model running on this machine.\n' +
    '- Context window may be smaller than cloud providers.\n' +
    '- Use explicit tool call formatting.\n' +
    '- Be patient with slower response times for local inference.',
};

export const DEFAULT_PROVIDER_OVERLAY =
  'Generic provider overlay — use standard tool calling conventions.';
