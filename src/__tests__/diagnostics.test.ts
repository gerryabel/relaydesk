import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/queue/connection', () => ({
  getQueueRedis: vi.fn(),
}));

vi.mock('@/lib/queue/producer', () => ({
  getQueue: vi.fn(),
}));

import { getQueueRedis } from '@/lib/queue/connection';
import { getQueue } from '@/lib/queue/producer';
import {
  pingRedis,
  getRedisInfo,
  getQueueHealth,
  getRedisConnectionState,
  type RedisInfo,
} from '@/lib/queue/diagnostics';

const mockedGetQueueRedis = vi.mocked(getQueueRedis);
const mockedGetQueue = vi.mocked(getQueue);

describe('diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('pingRedis', () => {
    it('returns a positive latency for a successful ping', async () => {
      const redis = { ping: vi.fn().mockResolvedValue('PONG') };
      mockedGetQueueRedis.mockReturnValue(redis as never);

      const latency = await pingRedis(redis as never);

      expect(typeof latency).toBe('number');
      expect(latency).toBeGreaterThanOrEqual(0);
      expect(redis.ping).toHaveBeenCalledTimes(1);
    });

    it('uses the provided connection', async () => {
      const redis = { ping: vi.fn().mockResolvedValue('PONG') };
      await pingRedis(redis as never);
      expect(redis.ping).toHaveBeenCalled();
      expect(mockedGetQueueRedis).not.toHaveBeenCalled();
    });

    it('propagates ping failures', async () => {
      const redis = { ping: vi.fn().mockRejectedValue(new Error('connection refused')) };
      await expect(pingRedis(redis as never)).rejects.toThrow('connection refused');
    });
  });

  describe('getRedisInfo', () => {
    it('parses selected INFO fields from the raw response', async () => {
      const rawInfo = [
        '# Server',
        'redis_version:7.2.4',
        'uptime_in_seconds:12345',
        'connected_clients:3',
        'total_connections_received:42',
        'total_commands_received:999999',
        'used_cpu_sys:1.5',
        'used_cpu_user:2.5',
        '',
        '# Memory',
        'used_memory_human:12.50M',
        '',
        '# Stats',
        'keyspace_hits:1000',
        'keyspace_misses:50',
        '',
      ].join('\n');

      const redis = { info: vi.fn().mockResolvedValue(rawInfo) };
      const info: RedisInfo = await getRedisInfo(redis as never);

      expect(info).toMatchObject({
        redis_version: '7.2.4',
        uptime_in_seconds: '12345',
        connected_clients: '3',
        used_memory_human: '12.50M',
        total_connections_received: '42',
        keyspace_hits: '1000',
        keyspace_misses: '50',
      });
    });

    it('returns defaults when INFO sections are missing', async () => {
      const redis = { info: vi.fn().mockResolvedValue('') };
      const info = await getRedisInfo(redis as never);

      expect(info.redis_version).toBe('unknown');
      expect(info.uptime_in_seconds).toBe('0');
      expect(info.connected_clients).toBe('0');
      expect(info.used_memory_human).toBe('0B');
    });

    it('propagates INFO failures', async () => {
      const redis = { info: vi.fn().mockRejectedValue(new Error('ERR info disabled')) };
      await expect(getRedisInfo(redis as never)).rejects.toThrow('ERR info disabled');
    });
  });

  describe('getQueueHealth', () => {
    it('returns job counts by state for the primary queue', async () => {
      const queue = {
        getJobCounts: vi.fn().mockResolvedValue({
          waiting: 5,
          active: 2,
          completed: 100,
          failed: 3,
          delayed: 1,
        }),
      };
      mockedGetQueue.mockReturnValue(queue as never);

      const health = await getQueueHealth('relaydesk:primary');

      expect(health).toEqual({
        queueName: 'relaydesk:primary',
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 1,
      });
      expect(queue.getJobCounts).toHaveBeenCalledWith(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      );
    });

    it('coerces missing counts to zero', async () => {
      const queue = {
        getJobCounts: vi.fn().mockResolvedValue({}),
      };
      mockedGetQueue.mockReturnValue(queue as never);

      const health = await getQueueHealth('relaydesk:primary');

      expect(health.waiting).toBe(0);
      expect(health.active).toBe(0);
      expect(health.completed).toBe(0);
      expect(health.failed).toBe(0);
      expect(health.delayed).toBe(0);
    });

    it('propagates getJobCounts failures', async () => {
      const queue = {
        getJobCounts: vi.fn().mockRejectedValue(new Error('redis error')),
      };
      mockedGetQueue.mockReturnValue(queue as never);

      await expect(getQueueHealth('relaydesk:primary')).rejects.toThrow('redis error');
    });
  });

  describe('getRedisConnectionState', () => {
    it('reports status and connection metadata without credentials', async () => {
      const redis = {
        status: 'ready',
        options: { host: 'localhost', port: 6379, family: 4 },
      };
      const state = getRedisConnectionState(redis as never);

      expect(state).toEqual({
        status: 'ready',
        address: 'localhost',
        port: 6379,
        family: 4,
      });
    });

    it('omits host/port when not present', async () => {
      const redis = { status: 'connecting', options: {} };
      const state = getRedisConnectionState(redis as never);

      expect(state).toEqual({ status: 'connecting' });
      expect(state).not.toHaveProperty('address');
      expect(state).not.toHaveProperty('port');
    });
  });
});
