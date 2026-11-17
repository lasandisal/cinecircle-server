/**
 * Magic-byte image detection.
 *
 * The browser-reported MIME type is attacker-controlled, so we inspect the
 * actual bytes instead of trusting `file.mimetype` or the filename extension.
 * Only the formats the app actually displays are accepted.
 */

export interface DetectedImage {
  mime: string;
  ext: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const detectImageType = (buffer: Buffer | undefined): DetectedImage | null => {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: fixed 8-byte signature
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mime: 'image/png', ext: 'png' };
  }

  // GIF: "GIF87a" or "GIF89a"
  const gifHeader = buffer.subarray(0, 6).toString('latin1');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { mime: 'image/gif', ext: 'gif' };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  return null;
};
