# W02 — Sandbox Hardening: owner check

Wave file: [`../waves/W02-sandbox-hardening.md`](../waves/W02-sandbox-hardening.md). About 10 minutes, no provider calls, no paid keys.

Every command and output below was run in `../OmniSwarm-wt/w02` on 2026-11-02. Outputs are shortened. Names that change per run are written as placeholders.

## Before you start

- Branch `wave/w02-sandbox-hardening`, worktree `../OmniSwarm-wt/w02`. The main checkout is untouched. Work from the worktree root: `cd ../OmniSwarm-wt/w02`.
- Docker must be running. **No image is pulled or built.** Three images must already exist locally (`docker image ls`): `audit-sandbox:local`, `node:24-bookworm-slim`, and `node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` (the last is used by the older `review-workflow.docker.mjs`). `npm run check:w02` sets `OMNI_REQUIRE_HARDENING=1`, so a missing image fails the check instead of skipping it.
- `./bin/audit setup-agents` is not needed. No provider login or key is used. Nothing here is **live**.
- Placeholders: `<container>` is the held sandbox container (`audit-sbx-<id>`), `<run>` is the temporary report directory the hardening test prints on its `HOLD` line.

## Steps

Step numbers match the wave file.

### 1. The hostile fixture runs through a real sandbox and all six invariants pass

```sh
node scripts/harness.mjs --self-test
cat scripts/harness-fixtures/hostile/expected.json      # lists 6 invariants
node --test --test-name-pattern hardening scripts/sandbox-hardening.docker.mjs
```

See `harness self-test ok (104 patterns)`, then (about 25 s):

```
  ✔ R-01-bridge-node: the bridge still runs the real node
  ✔ R-02-sealed-reads: reviewers read the sealed content
  ✔ R-02-source-digest: the digest of what was served equals the manifest
  ✔ R-02-no-leftovers: no uid-10001 process outlives the suite
  ✔ R-04-host-lifecycle: the host lifecycle is untouched by the forgery
  ✔ R-07-text-not-classified: planted text never becomes a failure label
✔ hardening: the hostile fixture cannot influence what reviewers see (six invariants)
✔ hardening: the handoff seal copies prepared node_modules into a root-owned /work/deps
```

Notes:

- The wave file writes this as `npm run test:docker -- --test-name-pattern hardening`. With that spelling npm puts the flag after the file globs and node does not filter, so all Docker files run. Use the command above. The rest of the Docker suite was red for unrelated reasons until the engine-sandbox fix pass (2026-11-03, branch `worktree-agent-aef5e510068636637`): on `5ad56e0` `npm run test:docker` ran 33 tests, 14 passed and 19 failed, because the worker runtime could not load its imports in its container and the SBF fixture no longer matched the build routing. Both are fixed; see "Automated checks".
- The test is `scripts/sandbox-hardening.docker.mjs`. It starts the real `sandbox.sh --review-only` on `scripts/harness-fixtures/hostile/`, runs the catalogued `npm test` through the real bridge (`callBridgeTool`, no model), then asserts the invariants. The fixture's suite tries, as uid 10001: writing `/work/bin/node`, renaming `/work/bin`, rewriting `/work/src/src/lib.js` and `/src/src/lib.js`, starting a `setsid` sleeper, writing `/out/lifecycle.json` (`lost`), `/out/agent-*.log` and `/out/sandbox.release`, and printing "usage limit reached". The test also asserts that the suite's run row says `dependencies: sealed`, that `/work/deps` is `root:root 755` and not writable by uid 10001, and that the in-container harness wrote its leads. The second test runs `scripts/sandbox-seal.sh` on a scratch volume: nested `node_modules` trees are copied, those under `.git` and `target` are not, symlinks are kept, and uid 10001 cannot change, add to or move the copy.

### 2. After the hostile suite, a bridge read returns the original file and the digests match

Part of the test above (`R-02-sealed-reads`, `R-02-source-digest`). By hand, in step 3's held container (below), the prepared tree was rewritten but reviewers still read the sealed text:

```sh
docker exec --user 10001:10001 <container> cat /work/src/src/lib.js       # module.exports = { marker: () => 'TAMPERED' };
cat <run>/harness/source-read-digest.json | head -c 120                    # "source":"/src","digest":"92bda58e…"
grep '"digest"' <run>/source-manifest.json                                 # "digest": "92bda58e…"  (same value)
```

The bridge `read_file src/lib.js` returned `ORIGINAL-SEALED-CONTENT` (asserted in the test).

### 3. The bridge's node is the real one; `/work/bin` is root-owned; the planted node never ran

Hold the sandbox open for 75 seconds and run these in a second terminal:

```sh
OMNI_HARDENING_HOLD_SECONDS=75 node --test scripts/sandbox-hardening.docker.mjs     # prints: HOLD <container> <run>
```

```sh
docker exec --user 10001:10001 <container> stat -c '%U:%G %a %n' /work /work/bin /work/runs /work/src /work/deps
docker exec --user 10001:10001 <container> ls -la /work/bin
docker exec --user 10001:10001 <container> /usr/local/bin/node -e "console.log(require('fs').readlinkSync('/proc/self/exe'))"
docker exec --user 10001:10001 <container> sh -c 'test -e /tmp/hostile-node-ran && echo "node marker: PRESENT" || echo "node marker: absent"'
docker exec --user 10001:10001 <container> cat /tmp/hostile-attempts.json
```

See:

```
root:root 755 /work
root:root 755 /work/bin
sandbox:sandbox 755 /work/runs
sandbox:sandbox 755 /work/src
root:root 755 /work/deps
total 8                                   (/work/bin is empty: no planted node)
/usr/local/bin/node
node marker: absent
{ "write /work/bin/node": "refused: EACCES",  "write /work/bin/npm": "refused: EACCES",
  "replace /work/bin directory": "refused: EACCES",  "write /usr/local/bin/node": "refused: EROFS",
  "overwrite /work/src/src/lib.js": "succeeded",  "overwrite /src/src/lib.js": "refused: EROFS",
  "add /src/src/backdoor.js": "refused: EROFS",  "spawn setsid daemon": "started",
  "write /out/lifecycle.json": "succeeded", … }
```

Note: the bridge process itself runs on the host and starts its programs with `docker exec … /usr/local/bin/node`; `/proc/self/exe` above is the node that the bridge's in-container programs run. The unit test `R-01: every bridge program runs /usr/local/bin/node by absolute path under a PATH with no /work entry` checks every spawned `docker exec` argv and `PATH`.

### 4. No uid-10001 process outlives the suite

Same held container:

```sh
docker exec --user 10001:10001 <container> ps -u 10001 -o pid,ppid,args
docker exec --user 10001:10001 <container> sh -c 'cat /tmp/hostile-daemon.pid; kill -0 $(cat /tmp/hostile-daemon.pid) 2>&1'
node -e "console.log(JSON.parse(require('fs').readFileSync('<run>/harness/existing-test-results-verification.json'))[0].killedProcesses)"
```

See only the container's init and the sandbox's own node (plus the `ps` itself), the sleeper's pid gone, and it listed as killed:

```
  PID  PPID COMMAND
    1     0 /sbin/docker-init -- /usr/local/bin/sandbox-entrypoint node /opt/audit/sandbox-inside.mjs
    7     1 node /opt/audit/sandbox-inside.mjs
  309     0 ps -u 10001 -o pid,ppid,args
79
sh: 1: kill: No such process
[ { pid: 79, command: 'sleep 3600' } ]
```

### 5. The forged `lifecycle.json` does not stop the review

```sh
docker exec <container> cat /out/lifecycle.json        # the forgery, container side
cat <run>/harness/host/lifecycle.json                  # the real one, host only
ls -la <run>/harness/host
```

See:

```
{"state":"lost","reason":"container_stopped","at":"2026-11-02T12:48:31.589Z"}      <- forged by the suite
{"state":"running","at":"2026-11-02T12:48:31.086Z"}                               <- host file, drwx------
```

The test also asserts that `harness/host` is not among the container's mounts, that `/out/host` is not visible inside, that the orchestrator's `lost` promise stays pending for 3.5 s, and that a forged `/out/sandbox.release` does not stop the container (the sandbox no longer waits on a file under `/out`).

### 6. `--restart-failed` is not blocked by planted text (automated only)

`./bin/audit run` would make provider calls, so this step is automated only:

```sh
node --test --test-name-pattern "R-07" scripts/docker-agent-orchestrator.test.mjs scripts/audit-process.test.mjs scripts/report-contract.test.mjs
```

See 3 passing tests, among them `R-07: --restart-failed is not blocked by "usage limit reached" text quoted in the old logs, but is by a recorded structured limit` (the restart proceeds with the text planted in both `harness/host/` and `harness/sandbox-run/`; a recorded `usage_limit` still blocks it) and `R-07: text quoted from target source in stdout, stderr or a non-error value is never classified` (a real JSON-RPC quota error object classifies as `usage_limit`; the label is `usage_limit`, not the plan's `quota`).

### 7. AGY hook preflight — offline half only

```sh
node --test scripts/agent-hook-preflight.test.mjs
```

See 3 passing tests: the generated hook refuses a host command tool and allows the review bridge; a missing, empty, garbage, non-denying or duplicated hook gives `unavailable: hook_not_enforced`; `buildCliInvocation` for AGY throws `AGY unavailable: hook_not_enforced` instead of launching. **Not done:** proving that the AGY binary actually calls the hook under `--dangerously-skip-permissions` needs a live AGY run and a recorded real transcript. This step is **live** and optional; it is skipped here, and `check-agents --live` is untouched.

### 8. Bridge unit tests

```sh
node --test scripts/audit-submission.test.mjs scripts/bridge-hardening.test.mjs scripts/bridge-tools-registry.test.mjs
```

See 21 passing tests, including:

- `R-09: every submit requires a submission identity` (`IDENTITY_REQUIRED`) and the evidence checks for every identity (`audit-submission.test.mjs`);
- `W02-02: …IDENTITY_UNKNOWN` for an id not in `harness/reviewers.json`;
- `tools/list per role is byte-identical to the list main served before the split` for `auditor`, `crosscheck`, `verification` (snapshots in `scripts/bridge-tool-snapshots/`, taken from the unmodified code), and `a new bridge-tools-<role>.mjs adds a role without editing the dispatcher`, `beforeCall runs for every tool call before the handler and can refuse it`;
- `ORCH 1.1: no provider key or endpoint reaches the docker client environment or its arguments` and `…a bridge process started with provider keys in its environment drops them`;
- `R-12: a read that the capture cut says so, with the exact byte count`. The marker counts bytes at the 64 KiB capture cut (`… [truncated N bytes]`). There is no per-line cap, so a 5 000-character line is not cut and gets no marker.

## Automated checks

```sh
node scripts/harness.mjs --self-test && npm test        # self-test ok (104 patterns); 330 pass, 0 fail
npm run test:schemas                                    # 119 pass, 0 fail
cmp skills/security-audit/SKILL.md .claude/skills/security-audit/SKILL.md && echo identical
npm run check:w02                                       # exit 0: self-test, npm test (330/330), hardening + review-workflow Docker tests (9/9 since the seal test)
npm run test:docker                                     # 2026-11-03: 34 pass, 0 fail (was 14 pass, 19 fail on 5ad56e0)
```

`check:w02` is `node scripts/harness.mjs --self-test && npm test && OMNI_REQUIRE_HARDENING=1 node --test scripts/sandbox-hardening.docker.mjs scripts/review-workflow.docker.mjs` (the wave file's `npm run test:docker -- --test-name-pattern hardening` does not filter, see step 1).

Earlier waves: `npm run check:w01` and `npm run check:w00` are unchanged by this wave.

## Known residuals (not fixed in W02)

- `/out` stays writable inside the container, because preparation writes there. The hostile run shows `"write /out/harness/summary.md": "succeeded"`: the harness leads that `read_file` can serve from `/out/harness` and `/out/crosscheck` are container-writable. They are untrusted leads. Only the source tree (R-02) is served from the sealed `/src`. `docker exec` cannot make a mount read-only per call.
- Fixed after W02: each per-run copy takes `node_modules` from `/work/deps`, which `scripts/sandbox-seal.sh` copies from the prepared `/work/src` at handoff and makes root-owned and not writable by uid 10001. Residual: the copy keeps symlinks (`cp -a`, then `verbatimSymlinks`), so a `node_modules` symlink with an absolute target under `/work/src` still points into the writable tree.
- A suite can still kill the sandbox's own process; the review then ends INCOMPLETE with `sandbox_unavailable`. A leftover process that cannot be killed is recorded as `survivingProcesses`, not treated as a failure.
- Fixed after W02: `/usr/local/cargo/bin` was mode 0777 in the rust base image. `engine/docker/sandbox.Dockerfile` now removes group and world write from `/usr/local/cargo` and `/usr/local/rustup` and fails the build if a world-writable file is left; `sandbox-hardening.docker.mjs` checks `root:root 755` in the running sandbox. The read-only root filesystem still blocks writes as a second layer.
- `native/codex-review` `cargo test` was not run here: its workspace root is not in this worktree.

## When you're done

All good: land it from the main checkout:

```sh
git merge --no-ff wave/w02-sandbox-hardening
git tag wave-02
git push origin main --tags
git worktree remove ../OmniSwarm-wt/w02
```

or tell the lead "land W02". Something wrong: tell the wave lead which step and what you saw.
