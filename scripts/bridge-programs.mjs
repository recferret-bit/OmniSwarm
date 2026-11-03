// Tree walkers the bridge runs on the sealed source. Each walker is one self-contained function that the
// host calls directly (demo-host, host-served leads) and that the container runs as source text (`node -e`),
// so both sides share one algorithm. A walker uses only its parameters: no imports, no module-level names.
// No model input is spliced into a program; arguments travel as argv.

export const SKIP_DIRS = Object.freeze(['node_modules', '.git', 'target', 'dist', '.cargo', 'coverage']);
export const SEARCH_LINE_CHARS = 220;

// sha256 of the JSON file list sorted by path, exactly like source-manifest.json's digest.
export function sourceTreeDigest(fs, path, crypto, root) {
  const files = [];
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? rel + '/' + ent.name : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) throw new Error('symlink in sealed source: ' + next);
      if (ent.isDirectory()) walk(full, next);
      else if (ent.isFile()) { const body = fs.readFileSync(full); files.push({ path: next, bytes: body.length, sha256: sha(body) }); }
    }
  };
  walk(root, '');
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { digest: sha(JSON.stringify(files)), files };
}

export function listTree(fs, path, root, maxDepth, skipDirs) {
  const skip = new Set(skipDirs);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth || out.length >= 400) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full) || ent.name;
      if (ent.isDirectory()) { if (!skip.has(ent.name)) { out.push(rel + '/'); walk(full, depth + 1); } }
      else if (ent.isFile()) { let size = 0; try { size = fs.statSync(full).size; } catch {} out.push(rel + ' (' + size + 'B)'); }
      if (out.length >= 400) break;
    }
  };
  walk(root, 1);
  return out.join('\n') || '(empty)';
}

export function readSlice(fs, file, rel, start, end) {
  if (!fs.lstatSync(file).isFile()) throw new Error('Not a regular file: ' + rel);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const slice = lines.slice(start - 1, end).map((line, idx) => (start + idx) + ': ' + line);
  return 'File: ' + rel + ' (lines ' + start + '..' + Math.min(end, lines.length) + ' of ' + lines.length + ')\n' + slice.join('\n');
}

// Lines that run past maxChars are cut and say how much was cut, so a hit is never mistaken for the whole line.
// Citations are relative to sourceRoot (the reviewer's /work/src), whatever directory the search started in.
export function searchTree(fs, path, root, sourceRoot, pattern, flags, limit, skipDirs, maxChars) {
  const skip = new Set(skipDirs);
  let re;
  try { re = new RegExp(pattern, flags); } catch { re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags); }
  const hits = [];
  const shown = (line) => {
    const text = line.trim();
    return text.length > maxChars ? text.slice(0, maxChars) + '… [+' + (text.length - maxChars) + ' chars]' : text;
  };
  const scan = (file) => {
    let st; try { st = fs.lstatSync(file); } catch { return; }
    if (!st.isFile() || st.size > 1048576) return;
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    if (text.includes('\0')) return;
    const rel = file.startsWith(sourceRoot + '/') ? file.slice(sourceRoot.length + 1) : file;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && hits.length < limit; i++) if (re.test(lines[i])) hits.push(rel + ':' + (i + 1) + ': ' + shown(lines[i]));
  };
  const walk = (p) => {
    if (hits.length >= limit) return;
    let st; try { st = fs.lstatSync(p); } catch { return; }
    if (st.isFile()) return scan(p);
    if (!st.isDirectory()) return;
    let ents = []; try { ents = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) if (!ent.isSymbolicLink() && !skip.has(ent.name)) walk(path.join(p, ent.name));
  };
  walk(root);
  return hits.length ? hits.join('\n') : 'No matches found.';
}

const program = (fn, call) => `'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const run=${fn.toString()};
process.stdout.write(String(${call}));
`;
const SKIP = JSON.stringify(SKIP_DIRS);

export const SOURCE_DIGEST_SCRIPT = program(sourceTreeDigest, "JSON.stringify(run(fs,path,crypto,'/src'))");
export const LIST_FILES_SCRIPT = program(listTree, `run(fs,path,process.argv[1],Number(process.argv[2]),${SKIP})`);
export const READ_FILE_SCRIPT = program(readSlice, "run(fs,process.argv[1],process.argv[1].startsWith('/src/')?process.argv[1].slice(5):process.argv[1],Number(process.argv[2]),Number(process.argv[3]))");
export const SEARCH_CODE_SCRIPT = program(searchTree, `run(fs,path,process.argv[1],'/src',process.argv[2],process.argv[3],Number(process.argv[4]),${SKIP},${SEARCH_LINE_CHARS})`);

// Where the sandbox seals the prepared dependency trees (node_modules) at reviewer handoff, root-owned and read-only
// for uid 10001. A suite can then not poison the dependencies the next suite copies in. Older sandboxes have no seal;
// the copy then falls back to the writable /work/src and the run is recorded as `dependencies: unsealed`.
export const SEALED_DEPS = '/work/deps';

// A fresh copy of the sealed source for one suite run, plus the prepared node_modules trees. Prints sealed|unsealed.
export const PREPARE_RUN_SCRIPT = `
const fs=require('node:fs'),path=require('node:path');
const run=process.argv[1];
if(!/^\\/work\\/runs\\/[a-f0-9]{16}$/.test(run))throw Error('Invalid run directory');
const dest=path.join(run,'src');
fs.mkdirSync(run,{recursive:true});
fs.cpSync('/src',dest,{recursive:true,verbatimSymlinks:true});
const writable=dir=>{fs.chmodSync(dir,fs.lstatSync(dir).mode|0o700);for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())writable(p);else if(e.isFile())fs.chmodSync(p,fs.lstatSync(p).mode|0o200)}};
writable(dest);
const sealed=fs.existsSync('${SEALED_DEPS}')&&fs.lstatSync('${SEALED_DEPS}').isDirectory()&&!fs.lstatSync('${SEALED_DEPS}').isSymbolicLink();
const base=sealed?'${SEALED_DEPS}':'/work/src';
(function deps(dir,rel){let ents=[];try{ents=fs.readdirSync(dir,{withFileTypes:true})}catch{return}
 for(const e of ents){if(e.isSymbolicLink()||!e.isDirectory()||e.name==='.git'||e.name==='target')continue;
  const r=rel?rel+'/'+e.name:e.name,to=path.join(dest,r);
  if(e.name==='node_modules'){if(fs.existsSync(path.dirname(to))){fs.cpSync(path.join(dir,e.name),to,{recursive:true,verbatimSymlinks:true,force:true});writable(to)}continue}
  deps(path.join(dir,e.name),r)}
})(base,'');
process.stdout.write(sealed?'sealed':'unsealed');
`;

// After a suite: kill every uid-10001 process that outlived it and remove the run directory.
// Processes started by docker exec have parent 0; anything a suite left behind is reparented to pid 1.
// The only orphan to keep is the sandbox's own long-lived node process, which is the lowest pid with that exact command line.
export const SUITE_CLEANUP_SCRIPT = `
const fs=require('node:fs');
const run=process.argv[1];
if(!/^\\/work\\/runs\\/[a-f0-9]{16}$/.test(run))throw Error('Invalid run directory');
const procs=()=>{const out=[];for(const d of fs.readdirSync('/proc')){if(!/^\\d+$/.test(d))continue;try{
 const st=fs.readFileSync('/proc/'+d+'/status','utf8');
 out.push({pid:+d,uid:+(/^Uid:\\s+(\\d+)/m.exec(st)||[])[1],ppid:+(/^PPid:\\s+(\\d+)/m.exec(st)||[])[1],cmd:fs.readFileSync('/proc/'+d+'/cmdline','utf8').split('\\0').filter(Boolean)})}catch{}}return out};
const sandboxMain=all=>all.filter(p=>p.ppid===1&&p.cmd.length===2&&p.cmd[0]==='node'&&p.cmd[1]==='/opt/audit/sandbox-inside.mjs').map(p=>p.pid).sort((a,b)=>a-b)[0];
const leftovers=()=>{const all=procs(),keep=sandboxMain(all);return all.filter(p=>p.uid===10001&&p.ppid===1&&p.pid!==1&&p.pid!==keep&&p.pid!==process.pid)};
const killed=[];
for(let round=0;round<8;round++){
 const targets=leftovers();
 if(!targets.length)break;
 for(const p of targets){try{process.kill(p.pid,'SIGKILL');killed.push({pid:p.pid,command:p.cmd.join(' ').slice(0,160)})}catch{}}
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);
}
const survivors=leftovers().map(p=>p.pid);
fs.rmSync(run,{recursive:true,force:true});
process.stdout.write(JSON.stringify({killed,survivors}));
`;
