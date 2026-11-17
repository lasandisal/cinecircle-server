import dotenv from 'dotenv';

dotenv.config();

/**
 * Secrets that must never fall back to a hardcoded default.
 *
 * Previously `JWT_SECRET` defaulted to 'cinecircle_jwt_secret_dev' and
 * `CURATOR_WEBHOOK_KEY` to 'cinecircle_curator_secret_2026'. Anyone running
 * this app without a .env silently got a publicly-known signing key - meaning
 * they could forge a valid admin JWT for anyone.
 */
function requiredSecret(name: string, label: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[config] ${label} (${name}) is not set. ` +
        `Refusing to start with an insecure default. Add it to cinecircle-be/.env.`
    );
  }
  return value;
}

/** Reject obviously-placeholder values that would defeat the point. */
function assertNotPlaceholder(name: string, value: string, known: string[]): string {
  if (known.some((k) => value === k)) {
    throw new Error(
      `[config] ${name} is still set to its old hardcoded default. ` +
        `Generate a unique value and put it in cinecircle-be/.env.`
    );
  }
  return value;
}

const INSECURE_DEFAULTS = ['cinecircle_jwt_secret_dev', 'cinecircle_curator_secret_2026'];

export const ENV = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: assertNotPlaceholder(
    'JWT_SECRET',
    process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : requiredSecret('JWT_SECRET', 'JWT signing secret')),
    INSECURE_DEFAULTS
  ),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  /** Minutes a one-time email code stays valid. */
  OTP_TTL_MINUTES: Math.max(1, parseInt(process.env.OTP_TTL_MINUTES || '10', 10) || 10),
  /** Name of the HttpOnly session cookie. */
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || 'cinecircle_token',
  /** Extra frame/API origins beyond CLIENT_URL (comma separated, e.g. preview deploys). */
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || '',
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || 'cinecircle-images',
  // Shared rate-limit counters (Upstash Redis REST API). Optional: when empty
  // the limiters fall back to express-rate-limit's in-process MemoryStore.
  // KV_REST_API_* is what the Vercel Upstash integration sets, so both names
  // are accepted.
  UPSTASH_REDIS_REST_URL:
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
  UPSTASH_REDIS_REST_TOKEN:
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
  TMDB_API_KEY: process.env.TMDB_API_KEY || '',
  TMDB_ACCESS_TOKEN: process.env.TMDB_ACCESS_TOKEN || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_REQUEST_TIMEOUT_MS: process.env.GEMINI_REQUEST_TIMEOUT_MS || '15000',
  GEMINI_EVAL_TIMEOUT_MS: process.env.GEMINI_EVAL_TIMEOUT_MS || '20000',
  BREVO_SMTP_HOST: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
  BREVO_SMTP_PORT: parseInt(process.env.BREVO_SMTP_PORT || '587', 10),
  BREVO_SMTP_LOGIN: process.env.BREVO_SMTP_LOGIN || 'hello.cinecircle@gmail.com',
  BREVO_SMTP_KEY: process.env.BREVO_SMTP_KEY || '',
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || 'hello.cinecircle@gmail.com',
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || 'CineCircle',
  // The curator webhook key grants anonymous admin write access to soundtracks
  // and episodes, so it must be explicitly configured.
  CURATOR_WEBHOOK_KEY: assertNotPlaceholder(
    'CURATOR_WEBHOOK_KEY',
    process.env.CURATOR_WEBHOOK_KEY || (process.env.NODE_ENV === 'production' ? '' : requiredSecret('CURATOR_WEBHOOK_KEY', 'Curator webhook key')),
    INSECURE_DEFAULTS
  ),
};

