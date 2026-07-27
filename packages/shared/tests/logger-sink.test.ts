import { afterEach, describe, expect, it } from 'vitest';
import { clearLogSinks, getLogger, registerLogSink, type LogSink, type LogSinkRecord } from '../src/logger.js';

/**
 * Captures every record handed to a registered sink so the fan-out behaviour
 * (§8.1) can be asserted without a Postgres backend.
 */
function capturingSink(): LogSink & { records: LogSinkRecord[] } {
  const records: LogSinkRecord[] = [];
  return {
    records,
    log: (record) => {
      records.push(record);
    },
  };
}

describe('logger sink fan-out (§8.1)', () => {
  afterEach(() => {
    clearLogSinks();
    delete process.env['AGENTX_OBS_LOG_LEVEL'];
  });

  it('delivers info/warn/error records to a registered sink with mapped fields', () => {
    const sink = capturingSink();
    registerLogSink(sink);
    const logger = getLogger();
    logger.info('AI_SDK', 'streamText started', { model: 'gpt-4o' });
    logger.warn('TURN_JOURNEY', 'prefetch timeout');
    logger.error('AGENT_BUS', new Error('boom'), { sessionId: 's1' });

    expect(sink.records).toHaveLength(3);
    expect(sink.records[0]).toMatchObject({
      level: 'info',
      scope: 'AI_SDK',
      message: 'streamText started',
      payload: { model: 'gpt-4o' },
    });
    expect(sink.records[1]).toMatchObject({ level: 'warn', scope: 'TURN_JOURNEY', message: 'prefetch timeout' });
    expect(sink.records[2]).toMatchObject({ level: 'error', scope: 'AGENT_BUS', message: 'boom' });
    expect(sink.records[2].stack).toBeTruthy();
  });

  it('respects AGENTX_OBS_LOG_LEVEL=warn — info/debug records are not forwarded', () => {
    process.env['AGENTX_OBS_LOG_LEVEL'] = 'warn';
    const sink = capturingSink();
    registerLogSink(sink); // re-reads the env to refresh sinkMinLevel
    const logger = getLogger();
    logger.debug('AI_SDK', 'chunk delta');
    logger.info('AI_SDK', 'streamText started');
    logger.warn('AI_SDK', 'zero chunks');

    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].level).toBe('warn');
  });

  it('clearLogSinks detaches all sinks', () => {
    const sink = capturingSink();
    registerLogSink(sink);
    clearLogSinks();
    getLogger().info('AI_SDK', 'after clear');
    expect(sink.records).toHaveLength(0);
  });

  it('a throwing sink never breaks logging or other sinks', () => {
    const exploding: LogSink = { log: () => { throw new Error('sink down'); } };
    const ok = capturingSink();
    registerLogSink(exploding);
    registerLogSink(ok);
    // Must not throw.
    expect(() => getLogger().info('AI_SDK', 'resilient')).not.toThrow();
    expect(ok.records).toHaveLength(1);
    expect(ok.records[0].message).toBe('resilient');
  });

  it('registerLogSink is idempotent (no duplicate delivery)', () => {
    const sink = capturingSink();
    registerLogSink(sink);
    registerLogSink(sink);
    getLogger().info('AI_SDK', 'once');
    expect(sink.records).toHaveLength(1);
  });
});
