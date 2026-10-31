import { describe, expect, it, vi } from 'vitest';
import { isChunkError, offerReload } from './lazy';

describe('lazy', () => {
  it('reconhece pedaço que não baixou (Chrome, Safari, Firefox)', () => {
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: http://x/bundle/daystats-A.js'))).toBe(true);
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkError(new Error('x is undefined'))).toBe(false);
  });

  it('pergunta e recarrega só em erro de pedaço', () => {
    const reload = vi.fn();
    expect(offerReload(new Error('outro'), () => true, reload)).toBe(false);
    expect(offerReload(new TypeError('Failed to fetch dynamically imported module: a'), () => false, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(offerReload(new TypeError('Failed to fetch dynamically imported module: a'), () => true, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
