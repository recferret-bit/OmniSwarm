// Drains a child's stdout and stderr into one host-only log file, writing at most `maxBytes` and
// discarding the rest, so a chatty engine can neither block on a full pipe nor fill the disk.
import fs from 'node:fs';
import type { Readable } from 'node:stream';

export class CappedLog {
  readonly #fd: number;
  readonly #max: number;
  #written = 0;
  #truncated = false;

  constructor(file: string, maxBytes: number) {
    this.#fd = fs.openSync(file, 'a', 0o600);
    this.#max = maxBytes;
  }

  drain(stream: Readable | null): void {
    stream?.on('data', (chunk: Buffer) => this.#write(chunk));
  }

  #write(chunk: Buffer): void {
    const room = this.#max - this.#written;
    if (room > 0) {
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      fs.writeSync(this.#fd, part);
      this.#written += part.length;
    }
    if (chunk.length > room && !this.#truncated) {
      this.#truncated = true;
      fs.writeSync(this.#fd, `\n[worker] log truncated at ${this.#max} bytes\n`);
    }
  }

  note(line: string): void {
    fs.writeSync(this.#fd, `[worker] ${line}\n`);
  }

  close(): void {
    fs.closeSync(this.#fd);
  }
}
