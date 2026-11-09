import { describe, expect, it } from 'vitest';
import { BEAT_MS, beat } from './how-scene';

describe('how scene beats', () => {
  it('walks four equal beats and wraps', () => {
    expect(beat(0, BEAT_MS, 4)).toMatchObject({ index: 0, u: 0 });
    expect(beat(BEAT_MS * 2 + 10, BEAT_MS, 4).index).toBe(2);
    expect(beat(BEAT_MS * 0.5, BEAT_MS, 4).u).toBeCloseTo(0.5, 5);
    expect(beat(BEAT_MS * 4 + 5, BEAT_MS, 4).index).toBe(0);
    expect(beat(-10, BEAT_MS, 4).index).toBe(3);
  });
});
