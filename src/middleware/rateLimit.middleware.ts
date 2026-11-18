import { Request, Response } from 'express';
import rateLimit, {
  MemoryStore,
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from 'express-rate-limit';
import { Redis } from '@upstash/redis';
import { ENV } from '../config/env';
import { redisRateLimitStore } from '../services/rateLimitStore';

/**
 * IP-based throttling.
 *
 * `trust proxy` is set to 1 in app.ts so Express reads the real client IP
 * from Vercel's `X-Forwarded-For` instead of the proxy address. Without that,
 * every request would look like it came from one IP and one user could lock
 * out the whole service.
 *
 * Where counters live:
 *  - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set -> one shared
 *    counter for the whole deployment (correct on Vercel, where multiple
 *    serverless instances run side by side).
 *  - not set -> express-rate-limit's in-process MemoryStore, which is fine for
 *    local development but per-instance in production.
 */

const REDIS_RETRY_COOLDOWN_MS = 30_000;

let redisPausedUntil = 0;
let warnedAboutRedis = false;

const isRedisConfigured = Boolean(
  ENV.UPSTASH_REDIS_REST_URL && ENV.UPSTASH_REDIS_REST_TOKEN
);

/** Exposed so the health endpoint / startup log can show which store is live. */
export const rateLimitStoreKind: 'redis' | 'memory' = isRedisConfigured
  ? 'redis'
  : 'memory';

let redis: Redis | null = null;

const getRedisClient = (): Redis => {
  if (!redis) {
    redis = new Redis({
      url: ENV.UPSTASH_REDIS_REST_URL,
      token: ENV.UPSTASH_REDIS_REST_TOKEN,
      // Fail fast: a sick Redis must not add seconds of latency to every
      // request. The store falls back to memory instead.
      retry: { retries: 0 },
    });
  }
  return redis;
};

const warnAboutRedisFailure = (error: unknown): void => {
  if (warnedAboutRedis) return;
  warnedAboutRedis = true;
  console.warn(
    '[rate-limit] Shared Redis store unavailable, falling back to in-process counters for ' +
      `${REDIS_RETRY_COOLDOWN_MS / 1000}s:`,
    error instanceof Error ? error.message : error
  );
};

/**
 * Wraps the Redis store with a local memory store.
 *
 * A rate limiter must never be the reason the API goes down: if Redis is
 * unreachable, requests are still counted (per instance) instead of failing
 * with a 500. After a failure the Redis path is skipped for a short cooldown
 * so one outage does not cost every request a network timeout.
 */
class ResilientStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;

  constructor(
    private readonly primary: Store,
    private readonly fallback: Store,
    prefix: string
  ) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.primary.init?.(options);
    this.fallback.init?.(options);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    if (Date.now() < redisPausedUntil) {
      return this.fallback.increment(key);
    }

    try {
      return await this.primary.increment(key);
    } catch (error) {
      redisPausedUntil = Date.now() + REDIS_RETRY_COOLDOWN_MS;
      warnAboutRedisFailure(error);
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    if (Date.now() < redisPausedUntil) {
      await this.fallback.decrement(key);
      return;
    }

    try {
      await this.primary.decrement(key);
    } catch (error) {
      redisPausedUntil = Date.now() + REDIS_RETRY_COOLDOWN_MS;
      warnAboutRedisFailure(error);
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.primary.resetKey?.(key);
    } catch {
      // Best effort: the local counter still gets reset below.
    }
    await this.fallback.resetKey?.(key);
  }
}

const tooManyRequests = (_req: Request, res: Response): void => {
  res.status(429).json({
    success: false,
    error: 'Too many requests. Please wait a moment and try again.',
  });
};

const base = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  handler: tooManyRequests,
};

/**
 * Each limiter gets its own store instance and key namespace. Sharing either
 * would make e.g. the 20-request auth limit consume the 600-request API
 * budget, and express-rate-limit rejects a store reused across limiters.
 */
const createLimiter = (name: string, windowMs: number, limit: number) => {
  const prefix = `rl:${name}:`;

  return rateLimit({
    ...base,
    windowMs,
    limit,
    store: isRedisConfigured
      ? new ResilientStore(
          redisRateLimitStore({ redis: getRedisClient(), prefix, windowMs }),
          new MemoryStore(),
          prefix
        )
      : undefined,
  });
};

/** Broad backstop for the whole API. */

/**
 * General API protection:
 * Allows a maximum of 600 requests per IP address
 * within 15 minutes.
 */
export const apiLimiter = createLimiter('api', 15 * 60 * 1000, 600);

/**
 * Authentication protection:
 * Allows a maximum of 20 requests per IP address
 * within 15 minutes.
 * Applied to login, registration and token refresh.
 */
export const authLimiter = createLimiter('auth', 15 * 60 * 1000, 20);

/**
 * OTP sending protection:
 * Allows a maximum of 5 OTP requests per IP address
 * within 15 minutes.
 * Prevents excessive OTP emails.
 */
export const otpSendLimiter = createLimiter('otp-send', 15 * 60 * 1000, 5);

/**
 * OTP verification protection:
 * Allows a maximum of 10 verification attempts per IP address
 * within 15 minutes.
 * Helps prevent brute-force attacks on 6-digit OTP codes.
 */
export const otpVerifyLimiter = createLimiter('otp-verify', 15 * 60 * 1000, 10);

/**
 * Write operation protection:
 * Allows a maximum of 60 requests per IP address
 * within 10 minutes.
 * Applied to comments, likes, polls and reports.
 */
export const writeLimiter = createLimiter('write', 10 * 60 * 1000, 60);
