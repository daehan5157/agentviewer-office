import fsp from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { statSafe } from './util.js';

const CHUNK = 8 * 1024 * 1024;

/** Incrementally reads newly appended lines of a JSONL file. */
export class Tailer {
  constructor(file) {
    this.file = file;
    this.offset = 0;
    this.partial = '';
    this.decoder = new StringDecoder('utf8');
    this.mtime = 0;
    this.size = 0;
  }

  /** Read the last `maxBytes` of the file to bootstrap state. */
  async readInitial(maxBytes = 2 * 1024 * 1024) {
    const st = await statSafe(this.file);
    if (!st) return [];
    this.mtime = st.mtimeMs;
    const start = Math.max(0, st.size - maxBytes);
    return this.#read(start, st.size, start > 0);
  }

  /** Lines appended since the last read; null if the file disappeared. */
  async readNew() {
    const st = await statSafe(this.file);
    if (!st) return null;
    this.mtime = st.mtimeMs;
    if (st.size < this.offset) {
      // truncated or rewritten
      this.offset = 0;
      this.partial = '';
      this.decoder = new StringDecoder('utf8');
    }
    if (st.size === this.offset) return [];
    return this.#read(this.offset, Math.min(st.size, this.offset + CHUNK), false);
  }

  async #read(start, end, skipFirst) {
    const len = end - start;
    if (len <= 0) {
      this.offset = end;
      return [];
    }
    const fh = await fsp.open(this.file, 'r');
    try {
      const buf = Buffer.alloc(len);
      let got = 0;
      while (got < len) {
        const { bytesRead } = await fh.read(buf, got, len - got, start + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
      this.offset = start + got;
      this.size = Math.max(this.size, this.offset);
      const text = this.partial + this.decoder.write(buf.subarray(0, got));
      const parts = text.split('\n');
      this.partial = parts.pop() ?? '';
      if (skipFirst) parts.shift();
      return parts.filter((l) => l.trim());
    } finally {
      await fh.close();
    }
  }
}
