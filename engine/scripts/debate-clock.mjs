// Wall clock for one debate turn, judgement, or general review. The limit lives in the harness:
// when it fires, the signal aborts so the ACP session is cancelled. A voice that ignores the signal
// still loses the race, and a late resolution is swallowed.
export async function boundedCall(turnMs, parent, run) {
  const ms = Number.isFinite(turnMs) && turnMs >= 0 ? turnMs : 180000;
  const controller = new AbortController();
  const onParent = () => { if (!controller.signal.aborted) controller.abort(); };
  if (parent?.aborted) onParent();
  else parent?.addEventListener('abort', onParent);
  let timed = false;
  const timer = setTimeout(() => { timed = true; onParent(); }, ms);
  const pending = Promise.resolve().then(() => run(controller.signal));
  try {
    const winner = await Promise.race([
      pending.then((value) => ({ value }), (error) => ({ error })),
      new Promise((resolve) => {
        const finish = () => { if (timed) resolve({ timeout: true }); };
        if (controller.signal.aborted) finish();
        else controller.signal.addEventListener('abort', finish, { once: true });
      }),
    ]);
    if (timed) return { unavailable: 'debate_turn_timeout' };
    if (winner.error) throw winner.error;
    return winner.value;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParent);
    pending.catch(() => {});
  }
}
