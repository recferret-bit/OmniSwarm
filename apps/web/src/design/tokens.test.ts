import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(root, 'src');
const HEX = /#[0-9a-fA-F]{3,8}\b/;
// \S stops the engine from backing up the space and matching an allowed value.
const RADIUS = /border-radius:\s*(?!0\b|50%)\S/;

function filesUnder(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, ext, out);
    else if (ext.test(name)) out.push(full);
  }
  return out;
}

describe('Source Mark', () => {
  it('keeps raw hex in tokens.css only', () => {
    const css = filesUnder(path.join(src, 'design', 'css'), /\.css$/);
    css.push(path.join(src, 'app', 'globals.css'));
    const offenders = css.filter((file) => !file.endsWith(`${path.sep}tokens.css`) && HEX.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  it('chamfers corners, with the live dot and the radar disc as the round exceptions', () => {
    const css = filesUnder(path.join(src, 'design', 'css'), /\.css$/);
    css.push(path.join(src, 'app', 'globals.css'));
    const offenders = css.filter((file) => RADIUS.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  it('keeps hex out of design and landing view code', () => {
    const views = [
      ...filesUnder(path.join(src, 'design'), /\.tsx?$/),
      ...filesUnder(path.join(src, 'components', 'landing'), /\.tsx?$/),
    ];
    const offenders = views.filter((file) => HEX.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });
});
