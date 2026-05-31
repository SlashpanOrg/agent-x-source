import { type FC, useState, useCallback, useEffect } from 'react';
import { Box } from 'ink';
import { MissionControl } from './screens/MissionControl.js';
import { CrewSelect } from './screens/CrewSelect.js';
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { ConfigManager, SessionStore, PluginRegistry, MCPBridge, ACPBridge } from '@agentx/engine';
import { CrewManager } from '@agentx/engine';
import { PostgresStorageAdapter } from '@agentx/engine';
import { TelegramBridge } from '@agentx/engine';
import type { AgentXConfig, Crew } from '@agentx/shared';
import { getLogger } from '@agentx/shared';

type AppState = 'loading' | 'setup' | 'crew' | 'main';

interface AppProps {
  sessionId?: string;
  recovered?: boolean;
  planMode?: boolean;
  fallbackModel?: string;
  maxBudget?: number;
  gitAutoCommit?: boolean;
  gitAware?: boolean;
}

export const App: FC<AppProps> = ({ sessionId: restoreSessionId, recovered, planMode: initialPlanMode, fallbackModel, maxBudget, gitAutoCommit, gitAware }) => {
  const configManager = new ConfigManager();
  const isSetupDone = configManager.isSetupComplete();

  const [state, setState] = useState<AppState>(() => {
    if (!isSetupDone) return 'setup';
    if (restoreSessionId) return 'main';
    return 'crew';
  });

  const [config, setConfig] = useState<AgentXConfig | null>(() => {
    if (isSetupDone) {
      try {
        return configManager.load();
      } catch {
        return null;
      }
    }
    return null;
  });

  const [activeCrew, setActiveCrew] = useState<Crew | null>(() => {
    if (restoreSessionId) {
      try {
        const store = new SessionStore();
        const session = store.getSession(restoreSessionId);
        if (session) {
          const pm = new CrewManager();
          const crewId = session['crew_id'] as string | null;
          if (crewId) {
            return pm.get(crewId) ?? pm.getActive();
          }
        }
      } catch { /* fallback */ }
      const pm = new CrewManager();
      return pm.getActive();
    }
    return null;
  });

  // Shared plugin registry — created once, used by both PluginHub and WelcomeScreen
  const [pluginRegistry] = useState(() => new PluginRegistry());

  // Plugin lifecycle state (PostgreSQL adapter, Telegram bridge)
  const [pgAdapter, setPgAdapter] = useState<PostgresStorageAdapter | null>(null);
  const [telegramBridge, setTelegramBridge] = useState<TelegramBridge | null>(null);
  const [lifecycleVersion, setLifecycleVersion] = useState(0);

  // Re-initialize plugin-based adapters when lifecycle changes
  useEffect(() => {
    const logger = getLogger();

    // ── PostgreSQL ──
    const pgPlugin = pluginRegistry.getPlugin('postgresql');
    const pgConfig = pgPlugin?.config ?? {};
    if (pgPlugin?.enabled && pgConfig['connectionString']) {
      if (!pgAdapter) {
        const adapter = new PostgresStorageAdapter({
          connectionString: pgConfig['connectionString'] as string,
          max: (pgConfig['poolSize'] as number) ?? 5,
        });
        adapter.connect().then(() => {
          setPgAdapter(adapter);
          logger.info('PG_ADAPTER_STARTED', 'PostgreSQL storage adapter initialized from Plugin Hub');
        }).catch((e) => {
          logger.error('PG_ADAPTER_FAILED', e);
        });
      }
    } else {
      if (pgAdapter) {
        pgAdapter.disconnect().catch(() => {});
        setPgAdapter(null);
        logger.info('PG_ADAPTER_STOPPED', 'PostgreSQL storage adapter stopped');
      }
    }

    // ── Telegram ──
    const tgPlugin = pluginRegistry.getPlugin('telegram');
    const tgConfig = tgPlugin?.config ?? {};
    if (tgPlugin?.enabled && tgConfig['botToken']) {
      if (!telegramBridge) {
        const token = tgConfig['botToken'] as string;
        const bridge = new TelegramBridge({ botToken: token });
        bridge.start().then(() => {
          setTelegramBridge(bridge);
          logger.info('TG_BRIDGE_STARTED', 'Telegram bridge started from Plugin Hub');
        }).catch((e) => {
          logger.error('TG_BRIDGE_FAILED', e);
        });
      }
    } else {
      if (telegramBridge) {
        telegramBridge.stop();
        setTelegramBridge(null);
        logger.info('TG_BRIDGE_STOPPED', 'Telegram bridge stopped');
      }
    }
  }, [lifecycleVersion, pluginRegistry]);

  // Auto-start MCP servers
  const [mcpBridge] = useState(() => new MCPBridge());
  useEffect(() => {
    const logger = getLogger();
    void (async () => {
      try {
        const manifests = await mcpBridge.discover();
        let loaded = 0;
        for (const m of manifests) {
          try {
            await mcpBridge.start(m);
            loaded++;
          } catch (e) {
            logger.warn('MCP_START_FAILED', `Failed to start MCP ${m.name}: ${e}`);
          }
        }
        if (loaded > 0) {
          logger.info('MCP_SERVERS_STARTED', `Auto-started ${loaded} MCP server(s)`);
        }
      } catch (e) {
        logger.warn('MCP_DISCOVER', `MCP discovery failed: ${e}`);
      }
    })();
    return () => { void mcpBridge.dispose(); };
  }, []);

  // Auto-start ACP servers
  const [acpBridge] = useState(() => new ACPBridge(pluginRegistry));
  useEffect(() => {
    void acpBridge.startAll();
    return () => { void acpBridge.dispose(); };
  }, []);

  const handlePluginChanged = useCallback(() => {
    setLifecycleVersion((v) => v + 1);
  }, []);

  const handleMissionComplete = useCallback((newConfig: AgentXConfig, crew: Crew) => {
    process.stdout.write('\x1Bc');
    setConfig(newConfig);
    setActiveCrew(crew);
    setState('main');
  }, []);

  const handleSetupCancel = useCallback(() => {
    process.exit(0);
  }, []);

  const handleCrewSelect = useCallback((crew: Crew) => {
    setActiveCrew(crew);
    setState('main');
  }, []);

  const handleCrewSwitch = useCallback(() => {
    setState('crew');
  }, []);

  if (state === 'setup') {
    return <MissionControl onComplete={handleMissionComplete} onCancel={handleSetupCancel} />;
  }

  if (state === 'crew' && config) {
    return (
      <CrewSelect
        onSelect={handleCrewSelect}
        currentProvider={config.provider.activeProvider}
        currentModel={config.provider.activeModel}
      />
    );
  }

  if (state === 'main' && config && activeCrew) {
    return (
      <WelcomeScreen
        config={config}
        crew={activeCrew}
        restoreSessionId={restoreSessionId}
        recovered={recovered}
        onCrewSwitch={handleCrewSwitch}
        pluginRegistry={pluginRegistry}
        onPluginChanged={handlePluginChanged}
        storageAdapter={pgAdapter}
        telegramBridge={telegramBridge}
        initialPlanMode={initialPlanMode}
        fallbackModel={fallbackModel}
        mcpBridge={mcpBridge}
        acpBridge={acpBridge}
        maxBudget={maxBudget}
        gitAutoCommit={gitAutoCommit}
        gitAware={gitAware}
      />
    );
  }

  return (
    <Box>
      <MissionControl onComplete={handleMissionComplete} onCancel={handleSetupCancel} />
    </Box>
  );
};
