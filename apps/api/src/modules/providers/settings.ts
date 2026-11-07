// Operator switch for free reviews. A boolean, not a secret. Stored beside the sealed key file.
import fs from 'node:fs';
import path from 'node:path';

export interface ReviewSettings { freeChecks: boolean }

export function settingsPath(secretsFile: string | null): string | null {
  if (!secretsFile) return null;
  return path.join(path.dirname(secretsFile), 'review-settings.json');
}

export function readReviewSettings(file: string | null): ReviewSettings {
  if (!file || !fs.existsSync(file)) return { freeChecks: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { freeChecks?: unknown };
    return { freeChecks: parsed.freeChecks === true };
  } catch {
    return { freeChecks: false };
  }
}

export function writeReviewSettings(file: string, freeChecks: boolean): ReviewSettings {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ freeChecks })}\n`, { mode: 0o644 });
  fs.renameSync(tmp, file);
  return { freeChecks };
}
