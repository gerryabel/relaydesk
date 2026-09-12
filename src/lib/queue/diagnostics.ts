/**
 * Lightweight Redis and queue diagnostics for the async infrastructure.
 *
 * No Prometheus, no external exporters. These helpers are designed to be
 * called from the worker startup path and from scripts/infra-check.mjs.
 *
 * All functions are fail-safe: they throw on hard failure so callers can
 * decide whether to degrade gracefully, but they never crash the process
 * on their own.
 */

import type { Redis } from 'ioredis';
import { getQueueRedis } from './connection';
import { getQueue } from './producer';
import { QUEUE_NAMES } from './config';

/**
 * Round-trip Redis PING latency in milliseconds.
 * Uses the shared queue Redis connection by default.
 */
export async function pingRedis(connection: Redis = getQueueRedis()): Promise<number> {
  const start = process.hrtime.bigint();
  await connection.ping();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000;
}

/**
 * Selected Redis INFO fields returned by getRedisInfo.
 * Only the most useful operational fields are included to avoid leaking
 * internal details into logs.
 */
export interface RedisInfo {
  redis_version: string;
  uptime_in_seconds: string;
  connected_clients: string;
  used_memory_human: string;
  total_connections_received: string;
  total_commands_processed: string;
  keyspace_hits: string;
  keyspace_misses: string;
  used_cpu_sys: string;
  used_cpu_user: string;
}

/**
 * Fetch selected Redis INFO fields. Returns a RedisInfo object.
 * Throws if the INFO command fails.
 */
export async function getRedisInfo(connection: Redis = getQueueRedis()): Promise<RedisInfo> {
  const raw = await connection.info();
  const parsed = parseInfoSections(raw);

  const server = parsed.server ?? {};

  return {
    redis_version: server.redis_version ?? 'unknown',
    uptime_in_seconds: server.uptime_in_seconds ?? '0',
    connected_clients: server.connected_clients ?? '0',
    used_memory_human: parsed.memory?.used_memory_human ?? '0B',
    total_connections_received: server.total_connections_received ?? '0',
    total_commands_processed: server.total_commands_processed ?? '0',
    keyspace_hits: parsed.stats?.keyspace_hits ?? '0',
    keyspace_misses: parsed.stats?.keyspace_misses ?? '0',
    used_cpu_sys: server.used_cpu_sys ?? '0',
    used_cpu_user: server.used_cpu_user ?? '0',
  };
}

function parseInfoSections(raw: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = 'server';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      if (trimmed.startsWith('# ')) {
        current = trimmed.slice(2).trim().toLowerCase();
      }
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);

    if (!sections[current]) {
      sections[current] = {};
    }
    sections[current][key] = value;
  }

  return sections;
}

export interface QueueHealth {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Return job counts for the named queue. Uses BullMQ getJobCounts which is
 * O(1) per state — no expensive SCAN/KEYS.
 *
 * Waited + active + completed + failed + delayed give an operator a complete
 * picture of queue depth and backlog.
 */
export async function getQueueHealth(queueName: string = QUEUE_NAMES.primary): Promise<QueueHealth> {
  const queue = getQueue(queueName);
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
  );

  return {
    queueName,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}

export interface RedisConnectionState {
  status: string;
  address?: string;
  port?: number;
  /**
   * The connection family (4 or 6). Not exposed as a credential — only
   * useful for diagnosing IPv4/IPv6 binding issues.
   */
  family?: number;
}

/**
 * Inspect the ioredis connection status. Does NOT expose the connection
 * string or password.
 */
export function getRedisConnectionState(connection: Redis = getQueueRedis()): RedisConnectionState {
  const status = connection.status;

  // ioredis ConnectionOptions are not publicly typed; read defensively.
  const options = (connection as unknown as { options?: { host?: string; port?: number; family?: number } }).options;

  return {
    status,
    ...(options?.host ? { address: options.host } : {}),
    ...(options?.port ? { port: options.port } : {}),
    ...(options?.family ? { family: options.family } : {}),
  };
}
