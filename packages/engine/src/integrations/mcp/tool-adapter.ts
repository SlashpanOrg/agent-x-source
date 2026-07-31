import type { IntegrationProvider } from '@agentx/shared';
import type { ToolDefinition, ToolParameter } from '@agentx/shared';
import { ParallelMode } from '@agentx/shared';
import { integrationToolId, integrationToolRiskLevel, isReadOnlyIntegrationTool } from '../action-classifier.js';

interface McpToolShape {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

function mapParameterType(type: unknown): string {
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return String(type[0] ?? 'string');
  return 'string';
}

/**
 * Recursively convert a raw JSON Schema property (from the MCP server's
 * inputSchema) into our ToolParameter type, preserving nested structure
 * (items for arrays, properties for objects, enum values, etc.).
 *
 * This is critical — without preserving the nested schema, the LLM doesn't
 * know the structure of array/object parameters and generates malformed
 * arguments (e.g. cartItems=[object Object] instead of proper item objects).
 */
function mapParameter(value: Record<string, unknown>): ToolParameter {
  const param: ToolParameter = {
    type: mapParameterType(value.type),
    description: typeof value.description === 'string' ? value.description : undefined,
  };

  // Preserve enum values — but drop empty arrays. Some MCP servers return
  // enum: [] for optional filters (e.g. Swiggy's vegFilter), which is invalid
  // per JSON Schema (enums must have ≥1 item) and causes xAI's API to reject
  // the entire session.update with a schema validation error.
  if (Array.isArray(value.enum)) {
    const filtered = value.enum.filter((v): v is string => typeof v === 'string');
    if (filtered.length > 0) {
      param.enum = filtered;
    }
  }

  // Preserve default value
  if (value.default !== undefined) {
    param.default = value.default;
  }

  // Preserve maxItems for arrays
  if (typeof value.maxItems === 'number') {
    param.maxItems = value.maxItems;
  }

  // Recursively map array item schema
  if (value.items && typeof value.items === 'object' && !Array.isArray(value.items)) {
    param.items = mapParameter(value.items as Record<string, unknown>);
  }

  // Recursively map nested object properties
  if (value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)) {
    const nestedProps: Record<string, ToolParameter> = {};
    for (const [k, v] of Object.entries(value.properties as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        nestedProps[k] = mapParameter(v as Record<string, unknown>);
      }
    }
    param.properties = nestedProps;

    // Preserve required fields for nested objects
    if (Array.isArray(value.required)) {
      param.required = value.required.filter((r): r is string => typeof r === 'string');
    }
  }

  return param;
}

export function adaptMcpTool(
  provider: IntegrationProvider,
  tool: McpToolShape,
): ToolDefinition {
  const properties: Record<string, ToolParameter> = {};
  const schema = tool.inputSchema;
  if (schema?.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      properties[key] = mapParameter(value);
    }
  }

  const readonly = isReadOnlyIntegrationTool(tool.name, provider);
  const riskLevel = integrationToolRiskLevel(tool.name, provider);

  return {
    id: integrationToolId(provider.id, tool.name),
    name: tool.name,
    description: tool.description ?? `${provider.name} integration tool`,
    modelDescription: `[${provider.name}] ${tool.description ?? tool.name}${readonly ? ' (read-only)' : ' (requires user confirmation before execution)'}`,
    category: 'integrations',
    riskLevel,
    schema: {
      type: 'object',
      properties,
      required: Array.isArray(schema?.required) ? schema.required : [],
    },
    composable: true,
    source: 'integration',
    parallelMode: readonly ? ParallelMode.SAFE : ParallelMode.INTEGRATION_CHECK,
    isDestructive: riskLevel === 'critical' || riskLevel === 'high',
  };
}

export function adaptMcpTools(
  provider: IntegrationProvider,
  tools: McpToolShape[],
): ToolDefinition[] {
  return tools.map((tool) => adaptMcpTool(provider, tool));
}
