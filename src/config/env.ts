import dotenv from 'dotenv';

dotenv.config();

export const ENV = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/cinecircle',
  JWT_SECRET: process.env.JWT_SECRET || 'cinecircle_jwt_secret_dev',
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
  CURATOR_WEBHOOK_KEY: process.env.CURATOR_WEBHOOK_KEY || 'cinecircle_curator_secret_2026',
};

