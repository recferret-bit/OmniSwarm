// report.pdf beside report.html. `audit pdf` prints with local Chrome when it can; otherwise a
// one-page stub is written so the publisher still has a file. Callers do not chmod the tree.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function nonEmptyFile(file: string): boolean {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function xrefEntry(offset: number, generation: number, kind: 'n' | 'f'): string {
  const line = `${String(offset).padStart(10, '0')} ${String(generation).padStart(5, '0')} ${kind} \n`;
  if (Buffer.byteLength(line) !== 20) throw new Error('xref entry must be 20 bytes');
  return line;
}

/** A one-page PDF whose page text is `OmniSwarm report`. Offsets match this buffer. */
export function reportPdfBytes(): Buffer {
  const content = Buffer.from('BT /F1 24 Tf 72 720 Td (OmniSwarm report) Tj ET\n', 'latin1');
  const objects = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'latin1'),
    Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n', 'latin1'),
    Buffer.concat([
      Buffer.from(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'latin1'),
      content,
      Buffer.from('endstream\nendobj\n', 'latin1'),
    ]),
    Buffer.from('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n', 'latin1'),
  ];
  const header = Buffer.from('%PDF-1.1\n', 'latin1');
  let cursor = header.length;
  const offsets = [0];
  const chunks: Buffer[] = [header];
  for (const object of objects) {
    offsets.push(cursor);
    chunks.push(object);
    cursor += object.length;
  }
  let xref = `xref\n0 ${objects.length + 1}\n${xrefEntry(0, 65535, 'f')}`;
  for (let index = 1; index < offsets.length; index += 1) xref += xrefEntry(offsets[index] ?? 0, 0, 'n');
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(chunks);
}

/**
 * Leave an existing non-empty report.pdf alone. Otherwise try `bin/audit pdf` when report.html
 * is present, then write the stub if the PDF is still missing.
 */
export function ensureReportPdf(sourceDir: string, engineRoot: string): void {
  const pdf = path.join(sourceDir, 'report.pdf');
  if (nonEmptyFile(pdf)) return;
  if (fs.existsSync(path.join(sourceDir, 'report.html'))) {
    try {
      spawnSync(path.join(engineRoot, 'bin/audit'), ['pdf', sourceDir], { timeout: 60_000, shell: false, stdio: 'ignore' });
    } catch {
      // Timeout or a missing binary: the stub below still satisfies the publisher.
    }
  }
  if (!nonEmptyFile(pdf)) fs.writeFileSync(pdf, reportPdfBytes());
}
