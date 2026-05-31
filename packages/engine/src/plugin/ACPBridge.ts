import { ACPClient } from '../acp/ACPClient.js';
import type { ACPConnectionConfig } from '../acp/ACPClient.js';
import type { AcpServerConfig, PluginRegistry } from './PluginRegistry.js';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

interface AcpServerProcess {
  config: AcpServerConfig;
  client: ACPClient;
  toolCount: number;
  error?: string;
}

export class ACPBridge {
  private servers: Map<string, AcpServerProcess> = new Map();
  private registry: PluginRegistry;

  constructor(registry: PluginRegistry) {
    this.registry = registry;
  }

  getServerStatus(): Array<{ id: string; name: string; running: boolean; toolCount: number; error?: string }> {
    return [...this.servers.entries()].map(([id, server]) => ({
      id,
      name: server.config.name,
      running: server.client.isConnected(),
      toolCount: server.toolCount,
      error: server.error,
    }));
  }

  async startAll(): Promise<void> {
    const configs = this.registry.listAcpServers();
    for (const cfg of configs) {
      if (!cfg.enabled) continue;
      try {
        await this.startServer(cfg.id);
      } catch (e) {
        logger.error('ACP_START_FAILED', `Failed to start ACP server "${cfg.name}": ${(e as Error).message}`);
      }
    }
  }

  async startServer(id: string): Promise<void> {
    const existing = this.servers.get(id);
    if (existing?.client.isConnected()) return;

    const config = this.registry.getAcpServer(id);
    if (!config) throw new Error(`ACP server "${id}" not found in registry`);
    if (!config.enabled) throw new Error(`ACP server "${config.name}" is disabled`);

    const connConfig: ACPConnectionConfig = {
      command: config.command,
      args: config.args,
      host: config.host,
      port: config.port,
    };

    const client = new ACPClient(connConfig);
    await client.connect();

    let toolCount = 0;
    try {
      const tools = await client.listTools();
      toolCount = tools.length;
    } catch {
      // listTools may not be supported; report 0
    }

    this.servers.set(id, { config, client, toolCount });
    logger.info('ACP_SERVER_STARTED', `Connected to ACP server "${config.name}"`);
  }

  async stopServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;

    try {
      await server.client.disconnect();
    } catch (e) {
      logger.error('ACP_STOP_FAILED', `Error disconnecting ACP server "${server.config.name}": ${(e as Error).message}`);
    }

    this.servers.delete(id);
    logger.info('ACP_SERVER_STOPPED', `Disconnected ACP server "${server.config.name}"`);
  }

  async dispose(): Promise<void> {
    for (const id of this.servers.keys()) {
      await this.stopServer(id);
    }
  }

  getServerConfig(id: string): AcpServerConfig | undefined {
    return this.registry.getAcpServer(id);
  }
}
