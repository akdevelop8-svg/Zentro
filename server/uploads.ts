import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const UPLOADS_DIR = path.resolve(process.cwd(), 'data', 'uploads');
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function ensureUploadsDir(): void {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function detectImageType(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 12) return null;
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ext: '.png', mime: 'image/png' };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }
  // WebP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: '.webp', mime: 'image/webp' };
  }
  return null;
}

export function saveValidatedBase64Image(
  dataUrl: string,
  prefix: 'receipt' | 'broadcast'
): string {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl.trim()
  );
  if (!match) {
    throw new Error('Only PNG, JPEG, or WebP images are allowed.');
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image size must be between 1 byte and 4 MB.');
  }

  const detected = detectImageType(buffer);
  if (!detected) {
    throw new Error('Invalid image file signature.');
  }

  ensureUploadsDir();
  const filename = `${prefix}-${crypto.randomUUID()}${detected.ext}`;
  const targetPath = path.resolve(UPLOADS_DIR, filename);
  if (!targetPath.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Invalid upload destination.');
  }

  fs.writeFileSync(targetPath, buffer);
  return filename;
}

export function resolveUploadFile(
  filename: string
): { filePath: string; contentType: string } | null {
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
    return null;
  }
  ensureUploadsDir();
  const resolved = path.resolve(UPLOADS_DIR, filename);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    return null;
  }
  if (!fs.existsSync(resolved)) {
    return null;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg';

  return { filePath: resolved, contentType };
}
