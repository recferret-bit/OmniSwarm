import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HowStage } from './HowStage';
import { HeroCanvas, PipeCanvas } from './StageCanvas';

function installFrames() {
  const pending = new Map<number, FrameRequestCallback>();
  let seq = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const handle = ++seq;
    pending.set(handle, callback);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    pending.delete(handle);
  });
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  return {
    pending,
    hide() {
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    show() {
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

describe('landing animation loops', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'hidden');
  });

  it.each([
    ['how stage', () => render(<HowStage active={0} />)],
    ['hero canvas', () => render(<HeroCanvas />)],
    ['pipe canvas', () => render(<PipeCanvas />)],
  ])('%s keeps one frame across ten hide/show cycles', (_name, mount) => {
    const frames = installFrames();
    mount();
    expect(frames.pending.size).toBe(1);
    for (let cycle = 0; cycle < 10; cycle += 1) {
      frames.hide();
      frames.show();
    }
    expect(frames.pending.size).toBe(1);
  });

  it('paints the how stage again once a real sample hash arrives', async () => {
    installFrames();
    const original = HTMLCanvasElement.prototype.getContext;
    const paints: number[] = [];
    HTMLCanvasElement.prototype.getContext = function getContext() {
      paints.push(1);
      return null;
    } as typeof original;
    vi.stubGlobal('fetch', () => Promise.resolve({
      ok: true,
      json: async () => ({ report_sha256: 'ab'.repeat(32) }),
    }));
    try {
      render(<HowStage active={3} />);
      await waitFor(() => expect(paints.length).toBeGreaterThan(0));
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
});
