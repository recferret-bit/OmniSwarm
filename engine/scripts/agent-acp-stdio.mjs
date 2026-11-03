// Newline-delimited JSON-RPC (ACP v1) over stdio for OmniSwarm's own ACP agents
// (api-acp-agent.mjs, native-acp-agent.mjs). The coordinator's client is agent-rpc.mjs.
import path from 'node:path';
import { readReportJson } from './report-files.mjs';

const MAX_FRAME = 4 * 1024 * 1024;

export const sendAcp = (message, out = process.stdout) => out.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

// The launch config the coordinator wrote into the session workspace (argv[2]).
export function loadAgentConfig(file) {
  const configPath = path.resolve(file);
  return readReportJson(path.dirname(configPath), path.basename(configPath));
}

// Each request runs on its own microtask, so a long prompt never blocks session/cancel.
// An oversized buffer or an unparseable frame ends input (exit code 2); `onAbort` lets the agent
// kill what it spawned, `onEnd` runs when the coordinator closes stdin.
export function serveAcpStdio(agent, { errorReason, onAbort = () => {}, onEnd, input = process.stdin, send = sendAcp } = {}) {
  let buffer = '';
  const abort = () => { process.exitCode = 2; input.destroy(); onAbort(); };
  const dispatch = (msg) => {
    Promise.resolve().then(() => agent.request(msg.method, msg.params)).then(
      (result) => { if (msg.id != null) send({ id: msg.id, result }); },
      (err) => { if (msg.id != null) send({ id: msg.id, error: { code: -32000, message: err.reason || errorReason } }); },
    );
  };
  input.on('data', (data) => {
    buffer += data.toString('utf8');
    if (buffer.length > MAX_FRAME) { buffer = ''; abort(); return; }
    for (let at; (at = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { abort(); return; }
      dispatch(msg);
    }
  });
  if (onEnd) input.on('end', onEnd);
}
