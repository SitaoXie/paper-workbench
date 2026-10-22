import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Read an imported PDF without following references outside its data directory. */
export async function readStoredPdf(paper, directory) {
  if (!paper.filePath) throw new Error('No stored PDF');
  let handle;
  try {
    const root = await realpath(directory);
    const target = await realpath(path.resolve(root, paper.filePath));
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Invalid PDF location');
    handle = await open(target, 'r');
    const info = await handle.stat(), maximum = 25 * 1024 * 1024;
    if (!info.isFile() || info.size <= 0 || info.size > maximum) throw new Error('Invalid PDF size');
    const buffer = Buffer.alloc(Math.min(info.size + 1, maximum + 1));
    let size = 0;
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size !== info.size || size > maximum || !buffer.subarray(0, Math.min(size, 1024)).includes(Buffer.from('%PDF-'))) throw new Error('PDF changed or invalid');
    return buffer.subarray(0, size);
  } finally {
    await handle?.close().catch(() => {});
  }
}
