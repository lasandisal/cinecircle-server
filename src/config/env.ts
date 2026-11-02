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
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  TMDB_API_KEY: process.env.TMDB_API_KEY || '',
  TMDB_ACCESS_TOKEN: process.env.TMDB_ACCESS_TOKEN || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
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

