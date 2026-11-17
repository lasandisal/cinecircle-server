import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ENV } from '../config/env';
import { AppError } from '../middleware/error.middleware';

/**
 * Server-side Supabase Storage access.
 *
 * Uploads now pass through the API so the bytes can be validated before they
 * are stored. The secret key is server-only and must never be exposed with a
 * VITE_ prefix.
 */

let client: SupabaseClient | null = null;

const getClient = (): SupabaseClient => {
  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_SECRET_KEY) {
    throw new AppError('Image storage is not configured on the server.', 503);
  }

  if (!client) {
    client = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return client;
};

export const uploadImage = async (
  userId: string,
  buffer: Buffer,
  mime: string,
  ext: string
): Promise<string> => {
  const bucket = ENV.SUPABASE_STORAGE_BUCKET;
  const storage = getClient().storage.from(bucket);

  // Random filename inside the user's own folder: one member cannot overwrite
  // another member's asset, and the URL is not guessable.
  const path = `${userId}/${randomUUID()}.${ext}`;

  const { error } = await storage.upload(path, buffer, {
    contentType: mime,
    upsert: false,
  });

  if (error) {
    throw new AppError(`Image upload failed: ${error.message}`, 502);
  }

  const { data } = storage.getPublicUrl(path);
  return data.publicUrl;
};
