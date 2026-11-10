import { Injectable } from '@nestjs/common';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { get, put } from '@vercel/blob';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const BLOB_PREFIX = 'blob:';

/** Vercel Blob when the project has a store connected; local disk otherwise (development, Docker). */
const useBlob = () => !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);

/**
 * Uploaded files (signed notes, supplier and carrier invoices, proofs, receipts). Files are private:
 * they are only ever served through the API after the permission and scope checks.
 */
@Injectable()
export class FilesService {
  private readonly root = resolve(process.env.UPLOAD_DIR ?? './uploads');

  isAllowed(mime: string) {
    return ALLOWED.has(mime);
  }

  async save(file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<{ path: string; name: string; mime: string }> {
    const month = new Date().toISOString().slice(0, 7);
    const name = `${randomUUID()}${extname(file.originalname).toLowerCase().slice(0, 8)}`;
    if (useBlob()) {
      const blob = await put(`uploads/${month}/${name}`, file.buffer, { access: 'private', contentType: file.mimetype });
      return { path: BLOB_PREFIX + blob.pathname, name: file.originalname, mime: file.mimetype };
    }
    const dir = join(this.root, month);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), file.buffer);
    return { path: join(month, name), name: file.originalname, mime: file.mimetype };
  }

  async read(path: string): Promise<Buffer> {
    if (path.startsWith(BLOB_PREFIX)) {
      const result = await get(path.slice(BLOB_PREFIX.length), { access: 'private' });
      if (!result || result.statusCode !== 200) throw new Error('File not found');
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    }
    const full = resolve(this.root, path);
    if (!full.startsWith(this.root)) throw new Error('Invalid path');
    return readFile(full);
  }
}
