import type { ClientRateLimitInfo, Store } from 'express-rate-limit';

/**
 * Shared counter store for `express-rate-limit`, backed by Upstash Redis.
 *
 * Why this exists: the default `MemoryStore` keeps counters inside a single
 * Node process. On Vercel every invocation may run in a different (or brand
 * new) instance, so each instance would count independently and the effective
 * limit becomes `configured limit x number of instances`. Redis gives every
 * instance one shared counter per client.
 *
 * Only the two commands the store needs are required, which keeps the adapter
 * unit-testable without a live Redis.
 */
export interface RedisCommands {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

/**
 * Atomically bump the counter and read the remaining window.
 *
 * INCR and PEXPIRE must be one operation: if the process died between two
 * separate calls, the key could be left without a TTL and that client would be
 * blocked forever. Lua scripts in Redis run atomically, so that cannot happen.
 *
 * Returns [hits, ttlMs].
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { hits, redis.call('PTTL', KEYS[1]) }
`;

/**
 * Counterpart used by express-rate-limit's `skipSuccessfulRequests` /
 * `skipFailedRequests` options. Not enabled today, but a store that silently
 * fails to decrement would make those options incorrect if turned on later.
 * Deleting at zero avoids leaving a key that counts nothing.
 */
const DECREMENT_SCRIPT = `
local hits = redis.call('DECR', KEYS[1])
if hits <= 0 then
  redis.call('DEL', KEYS[1])
end
return hits
`;

export interface RedisRateLimitStoreOptions {
  redis: RedisCommands;
  /** Namespace so different limiters never share counters. */
  prefix: string;
  windowMs: number;
}

export const redisRateLimitStore = ({
  redis,
  prefix,
  windowMs,
}: RedisRateLimitStoreOptions): Store => {
  const redisKey = (key: string): string => `${prefix}${key}`;

  return {
    // Counters live in Redis, not in this process.
    localKeys: false,
    // Also lets express-rate-limit tell our limiter instances apart.
    prefix,

    async increment(key: string): Promise<ClientRateLimitInfo> {
      const reply = await redis.eval(INCREMENT_SCRIPT, [redisKey(key)], [windowMs]);

      if (!Array.isArray(reply) || reply.length < 2) {
        throw new Error('Unexpected reply from Redis rate-limit script.');
      }

      const totalHits = Number(reply[0]);
      const ttlMs = Number(reply[1]);

      return {
        totalHits,
        // TTL is -1/-2 only if the key vanished between commands; treat that as
        // "window expires now" rather than producing an invalid date.
        resetTime: new Date(Date.now() + Math.max(ttlMs, 0)),
      };
    },

    async decrement(key: string): Promise<void> {
      await redis.eval(DECREMENT_SCRIPT, [redisKey(key)], []);
    },

    async resetKey(key: string): Promise<void> {
      await redis.del(redisKey(key));
    },
  };
};
