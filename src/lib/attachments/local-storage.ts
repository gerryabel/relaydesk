import { promises as fs } from 'node:fs';
import path from 'node:path';
import { attachmentConfig } from './config';
import type { StorageProvider } from './storage.interface';

export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor() {
    this.root = path.resolve(process.cwd(), attachmentConfig.storageRoot);
  }

  private resolveKey(key: string): string {
    const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const resolved = path.resolve(this.root, normalized);

    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Invalid storage key: path traversal detected');
    }

    return resolved;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  async get(key: string): Promise<Buffer> {
    const target = this.resolveKey(key);
    return fs.readFile(target);
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveKey(key);
    await fs.unlink(target);
  }

  async exists(key: string): Promise<boolean> {
    const target = this.resolveKey(key);
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}

let cachedProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!cachedProvider) {
    cachedProvider = new LocalStorageProvider();
  }
  return cachedProvider;
}
