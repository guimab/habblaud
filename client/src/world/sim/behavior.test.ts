import { describe, expect, it } from 'vitest';
import { isLongIdle, modeFor } from './behavior';

describe('ficha dormindo', () => {
  it('status sleeping: fica ocioso e cochila na hora', () => {
    expect(modeFor('sleeping', { kind: 'main' })).toBe('idle');
    expect(isLongIdle('sleeping', 0, 0)).toBe(true);
  });
});
