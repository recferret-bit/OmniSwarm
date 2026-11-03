// Tools every role has, and the helpers role files share. Role files (bridge-tools-<role>.mjs) add their submit tool.
// The handlers live in bridge-context.mjs (scope and plans), bridge-reads.mjs (list/read/search of the sealed source)
// and bridge-existing-tests.mjs (catalogued suites); the container boundary is bridge-container.mjs.
import { citation } from './report-contract-auditor.mjs';
import { getAuditContext, getReviewPlan } from './bridge-context.mjs';
import { listFiles, readFile, searchCode } from './bridge-reads.mjs';
import { listExistingTests, runExistingTests } from './bridge-existing-tests.mjs';

export {
  BRIDGE_PATH, BridgeError, CONTAINER_ROOTS, NODE_BIN, REVIEW_SOURCE_LABEL, SEALED_SOURCE, SUITE_PATH,
  boundedCapture, displayPath, dockerClientEnv, execInContainer, resolveContainerPath, truncationMarker,
} from './bridge-container.mjs';
export { SOURCE_READ_DIGEST_FILE, digestTree, ensureSourceReadDigest } from './bridge-reads.mjs';

export const SAFE_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const objSchema = (properties, required = []) => ({
  type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false,
});
export const strProp = (description) => ({ type: 'string', ...(description ? { description } : {}) });
export const intProp = (description) => ({ type: 'integer', ...(description ? { description } : {}) });
export const boolProp = (description) => ({ type: 'boolean', ...(description ? { description } : {}) });
export const strArr = (description) => ({ type: 'array', items: { type: 'string' }, ...(description ? { description } : {}) });

export function normalizeCitation(raw) {
  if (typeof raw !== 'string') throw new Error('Expected a file:line citation');
  let s = raw.trim().replace(/^\/(?:work\/)?src\//, '').replace(/^\.\//, '');
  const m = s.match(/^([^:\n]+):([1-9]\d*)(?:-\d+)?$/);
  if (m) s = `${m[1]}:${m[2]}`;
  if (!citation(s)) throw new Error('Expected a relative file:line citation');
  return s;
}

// A bridge process must not keep provider credentials either; whatever its launcher passed is dropped at start.
const PROVIDER_ENV = /(?:^|_)(?:API_KEY|AUTH_TOKEN|SECRET_KEY|ACCESS_TOKEN)$|^(?:ANTHROPIC|OPENAI|OPENROUTER|ZAI|Z_AI|XAI|GEMINI|GOOGLE_API|NEARAI|NEAR_AI)_/;
export function scrubProviderEnv(env = process.env) {
  const removed = Object.keys(env).filter(key => PROVIDER_ENV.test(key));
  for (const key of removed) delete env[key];
  return removed;
}

export function commonToolDefinitions() {
  return [
    {
      name: 'get_audit_context',
      description: 'Read the audit scope, detected stacks (http, grpc, websockets, databases, crypto), skill guidance, harness lead summary, and (for crosscheck) assigned peer claims from the one-shot Docker container.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({}),
    },
    {
      name: 'get_review_plan',
      description: 'Read the source security review plan and codebase entry-point leads for one domain detected in this target (the domain ids listed by get_audit_context), or all.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({
        domain: strProp('A domain id detected for this target (see get_audit_context), or all (default: the plans relevant to the assigned surface)'),
      }),
    },
    {
      name: 'list_files',
      description: 'List files inside the one-shot Docker container (/work/src, /out/harness, /out/crosscheck).',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({ path: strProp('Directory path (default: /work/src)'), max_depth: intProp('Max recursion depth (1..6, default 3)') }),
    },
    {
      name: 'read_file',
      description: 'Read a file with 1-based line numbers inside the one-shot Docker container (/work/src or /out/harness). Relative paths resolve under /work/src.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({
        path: strProp('Relative path under /work/src or absolute path under /out/harness'),
        start_line: intProp('1-based start line (default 1)'),
        end_line: intProp('1-based inclusive end line (default start_line + 200)'),
      }, ['path']),
    },
    {
      name: 'search_code',
      description: 'Search source files inside the one-shot Docker container (/work/src or /out/harness) by regex or literal string. Returns relative file:line citations.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({
        pattern: strProp('Regex or literal pattern to search for'),
        path: strProp('Directory or file inside container (default: /work/src)'),
        case_insensitive: boolProp('Case-insensitive search (default: false)'),
        max_results: intProp('Max matches (default 80, max 200)'),
      }, ['pattern']),
    },
    {
      name: 'list_existing_tests',
      description: 'List fixed test IDs discovered in the captured source before review. No commands or test code can be supplied.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({}),
    },
    {
      name: 'run_existing_tests',
      description: 'Run one catalogued existing test suite inside the verified network-disconnected Docker container. Dependencies must already be available; failures remain coverage gaps.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: objSchema({ test_id: strProp('An ID returned by list_existing_tests; no additional arguments are accepted') }, ['test_id']),
    },
  ];
}


export const commonHandlers = Object.freeze({
  get_audit_context: getAuditContext,
  get_review_plan: getReviewPlan,
  list_files: listFiles,
  read_file: readFile,
  search_code: searchCode,
  list_existing_tests: listExistingTests,
  run_existing_tests: runExistingTests,
});
export const COMMON_TOOL_NAMES = Object.keys(commonHandlers);
