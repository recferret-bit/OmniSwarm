// How a large repository is divided before models see it. Top-level directories
// only: one queue job per theme, not one job per file. Docs, vendored deps and
// build output are not themes.
export type ReviewScope = 'full' | 'web2' | 'web3';
export type ThemeName = 'web3' | 'apps' | 'infra' | 'scripts';

export const THEME_ORDER: readonly ThemeName[] = ['web3', 'apps', 'infra', 'scripts'];

const SKIP = new Set(['node_modules', 'target', 'dist', 'build', 'coverage', 'docs', 'doc', 'examples', 'fixtures', 'vendor']);

const RULES: { theme: ThemeName; test: (name: string) => boolean }[] = [
  { theme: 'web3', test: (name) => /^(contracts?|programs?|crates|anchor|solana|near|chain)$/i.test(name) || /(^|[-_])(contract|program|onchain|on-chain)([-_]|$)/i.test(name) },
  { theme: 'infra', test: (name) => /^(infra|deploy|ops|k8s|kubernetes|terraform|docker)$/i.test(name) || name === '.github' },
  { theme: 'scripts', test: (name) => /^(scripts?|tools|bin|ci)$/i.test(name) },
  { theme: 'apps', test: (name) => /^(apps?|frontend|backend|web|api|services?|packages|src|server|client)$/i.test(name) },
];

export function normalizeScopes(selected: readonly string[]): ReviewScope {
  const picked = new Set(selected);
  if (picked.has('full') || (picked.has('web2') && picked.has('web3'))) return 'full';
  if (picked.has('web3')) return 'web3';
  if (picked.has('web2')) return 'web2';
  return 'full';
}

export function themeOf(name: string): ThemeName | null {
  if (!name || name === '.git' || SKIP.has(name)) return null;
  if (name.startsWith('.') && name !== '.github') return null;
  for (const rule of RULES) if (rule.test(name)) return rule.theme;
  return 'apps';
}

export interface ThemeSlice { theme: ThemeName; dirs: string[]; exclude?: string[] }

const CHAIN_DIR = /^(programs?|contracts?|anchor)$/i;

/** A chain project nested under an app, such as backend/programs, is its own web3 root. */
export function web3Roots(files: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    const base = parts[parts.length - 1] ?? '';
    if (base === 'Anchor.toml') roots.add(parts.slice(0, -1).join('/') || '.');
    const at = parts.findIndex((part) => CHAIN_DIR.test(part));
    if (at >= 0) roots.add(parts.slice(0, at + 1).join('/'));
  }
  return [...roots].filter((root) => root !== '.').sort();
}

/**
 * Group a file list. Nested chain roots are web3 and are excluded from the
 * surrounding app tree. `full` keeps every theme; web2 drops web3; web3 keeps only web3.
 */
export function partitionTree(files: readonly string[], scope: ReviewScope): ThemeSlice[] {
  const roots = web3Roots(files);
  const top = [...new Set(files.map((file) => file.split('/')[0] ?? '').filter(Boolean))];
  const grouped = new Map<ThemeName, { dirs: string[]; exclude: string[] }>();
  const add = (theme: ThemeName, dir: string, exclude: string[] = []) => {
    const current = grouped.get(theme) ?? { dirs: [], exclude: [] };
    if (!current.dirs.includes(dir)) current.dirs.push(dir);
    for (const item of exclude) if (!current.exclude.includes(item)) current.exclude.push(item);
    grouped.set(theme, current);
  };
  if (scope !== 'web2') for (const root of roots) add('web3', root);
  for (const name of top) {
    const theme = themeOf(name);
    if (!theme || theme === 'web3') continue;
    if (scope === 'web3') continue;
    const nested = roots.filter((root) => root === name || root.startsWith(`${name}/`));
    if (theme === 'apps' && nested.length && nested.some((root) => root !== name)) add('apps', name, nested);
    else if (!nested.includes(name)) add(theme, name);
  }
  return THEME_ORDER.filter((theme) => grouped.has(theme)).map((theme) => {
    const found = grouped.get(theme)!;
    return found.exclude.length ? { theme, dirs: found.dirs, exclude: found.exclude } : { theme, dirs: found.dirs };
  });
}

/** Group top-level directory names. `full` keeps every theme; web2 drops web3; web3 keeps only web3. */
export function partition(names: readonly string[], scope: ReviewScope): ThemeSlice[] {
  const grouped = new Map<ThemeName, string[]>();
  for (const name of names) {
    const theme = themeOf(name);
    if (!theme) continue;
    if (scope === 'web3' && theme !== 'web3') continue;
    if (scope === 'web2' && theme === 'web3') continue;
    const list = grouped.get(theme) ?? [];
    list.push(name);
    grouped.set(theme, list);
  }
  return THEME_ORDER.filter((theme) => grouped.has(theme)).map((theme) => ({ theme, dirs: grouped.get(theme) ?? [] }));
}

/** A full review of a small tree stays one job. A scoped review, or a large tree with several themes, is split. */
export function shouldSplit(input: { scope: ReviewScope; themes: number; files: number; bytes: number }): boolean {
  if (input.themes < 1) return false;
  if (input.scope !== 'full') return true;
  return input.themes > 1 && (input.files > 4000 || input.bytes > 80_000_000);
}

export const SPLIT_BYTES = 80_000_000;
export const SPLIT_FILES = 4000;
