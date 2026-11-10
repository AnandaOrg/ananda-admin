import { Injectable } from '@nestjs/common';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Uploaded files (signed notes, supplier and carrier invoices, proofs, receipts) on local disk. */
@Injectable()
export class FilesService {
  private readonly root = resolve(process.env.UPLOAD_DIR ?? './uploads');

  isAllowed(mime: string) {
    return ALLOWED.has(mime);
  }

  async save(file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<{ path: string; name: string; mime: string }> {
    const day = new Date().toISOString().slice(0, 7);
    const dir = join(this.root, day);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${extname(file.originalname).toLowerCase().slice(0, 8)}`;
    await writeFile(join(dir, name), file.buffer);
    return { path: join(day, name), name: file.originalname, mime: file.mimetype };
  }

  read(path: string) {
    const full = resolve(this.root, path);
    if (!full.startsWith(this.root)) throw new Error('Invalid path');
    return readFile(full);
  }
}
