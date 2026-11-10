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

const INFRA_ROOT_FILE = /^(?:(?:docker-)?compose[^/]*\.ya?ml|\.env(?:\..+)?|.+\.env|.+\.tf|.+\.tfvars|.*nginx.*\.conf|Caddyfile|Procfile|Jenkinsfile|\.gitlab-ci\.yml)$/i;
const DOCKERFILE = /^(?:Dockerfile.*|.+\.dockerfile)$/i;

/**
 * Which theme slices a file at the repository root is copied into. Deploy configuration and committed
 * environment files belong to infra only, and a root Anchor.toml to web3 only, so a web2 slice is not
 * routed as a Solana project and infra findings are not repeated in every theme. A Dockerfile also stays
 * with apps: the engine reads the declared Python version from it. Everything else (manifests, lockfiles,
 * README) is shared.
 */
export function rootFileThemes(name: string): readonly ThemeName[] {
  if (INFRA_ROOT_FILE.test(name)) return ['infra'];
  if (DOCKERFILE.test(name)) return ['apps', 'infra'];
  if (name === 'Anchor.toml') return ['web3'];
  return THEME_ORDER;
}

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
  // Themes are directories. Files at the root are copied per rootFileThemes when a slice is materialized; only a
  // repository with no directories at all is partitioned by its file names.
  const dirNames = [...new Set(files.filter((file) => file.includes('/')).map((file) => file.split('/')[0] ?? '').filter(Boolean))];
  const top = dirNames.length ? dirNames : [...new Set(files.filter(Boolean))];
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
