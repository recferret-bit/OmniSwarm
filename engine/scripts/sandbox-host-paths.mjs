// Host-only control files (R-04). harness/sandbox-run is the container's /out and is writable by target code,
// so nothing that steers resume, --restart-failed or failure text may live there. harness/host is never mounted.
export const HOST_DIR = 'harness/host';
export const LIFECYCLE_FILE = `${HOST_DIR}/lifecycle.json`;
// Job name ("claude-s1-auth") or crosscheck name ("crosscheck-claude") to the host log path, relative to the report.
export const hostLogRel = name => `${HOST_DIR}/${String(name).startsWith('crosscheck-') ? name : `agent-${name}`}.log`;
