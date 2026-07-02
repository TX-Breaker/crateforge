import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { copyFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { dirname, join } from 'path';

export const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.aiff', '.aif', '.flac', '.m4a', '.aac', '.ogg', '.alac'
]);

export interface WalkedFile {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Scansione ricorsiva streaming: mai accumulare l'intero albero se non serve. */
export async function* walkFiles(
  root: string,
  filterExt?: Set<string>
): AsyncGenerator<WalkedFile> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return; // cartella non leggibile: salta senza crashare
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, filterExt);
    } else if (entry.isFile()) {
      if (filterExt) {
        const dot = entry.name.lastIndexOf('.');
        const ext = dot >= 0 ? entry.name.slice(dot).toLowerCase() : '';
        if (!filterExt.has(ext)) continue;
      }
      try {
        const s = await stat(full);
        yield { path: full, size: s.size, mtimeMs: s.mtimeMs };
      } catch {
        // file sparito durante la scansione
      }
    }
  }
}

export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Copia con verifica d'integrità (regola §3.5): hash sorgente, copia,
 * hash destinazione, confronto. Se difforme: rimuove la copia e lancia.
 */
export async function copyWithVerify(src: string, dest: string): Promise<string> {
  const srcHash = await hashFile(src);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  const destHash = await hashFile(dest);
  if (srcHash !== destHash) {
    await unlink(dest).catch(() => undefined);
    throw new Error(`Verifica integrità fallita copiando ${src} → ${dest}`);
  }
  return srcHash;
}

export function timestampDir(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
