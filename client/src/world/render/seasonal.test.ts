// Regras puras do tema cyberpunk (Night City): escritório escuro com neon amarelo/ciano. Só o que dá para
// afirmar sem canvas: cores de parede, tapete e piso, e a ausência de figurino próprio.
import { describe, expect, it } from 'vitest';
import { parseColor } from '../../art/core/color';
import type { WallStyle } from '../../art/api';
import { seasonalCostume, seasonalFloorTint, seasonalRugColor, seasonalWallStyle } from './seasonal';

const lum = (c: string) => {
  const [r, g, b] = parseColor(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const PLAIN: WallStyle = { base: '#eef1f4', trim: '#9fb0c4', pattern: 'plain' };

describe('tema cyberpunk', () => {
  it('escurece a parede e pinta o acabamento de neon amarelo', () => {
    const w = seasonalWallStyle('cyberpunk', PLAIN);
    expect(lum(w.base)).toBeLessThan(90);
    expect(lum(w.base)).toBeLessThan(lum(PLAIN.base) / 2.5);
    expect(w.trim).toBe('#fcee0a');
    expect(w.pattern).toBe('plain');
  });

  it('não mexe no vidro (parede de vidro fica como é)', () => {
    const glass: WallStyle = { base: '#dfeaf0', trim: '#8fb6c4', pattern: 'glass' };
    expect(seasonalWallStyle('cyberpunk', glass)).toEqual(glass);
  });

  it('tapete escuro, na cor do tema', () => {
    const rug = seasonalRugColor('cyberpunk', '#c9d1dc');
    expect(rug).toBe('#242b45');
    expect(lum(rug)).toBeLessThan(60);
    // os sazonais continuam como estavam
    expect(seasonalRugColor('christmas', '#c9d1dc')).toBe('#a93649');
    expect(seasonalRugColor('halloween', '#c9d1dc')).toBe('#60416f');
    expect(seasonalRugColor('none', '#c9d1dc')).toBe('#c9d1dc');
  });

  it('escurece o piso da sala e some quando a sala não tem tom', () => {
    const floor = seasonalFloorTint('cyberpunk', '#c9d1dc')!;
    expect(lum(floor)).toBeLessThan(lum('#c9d1dc') / 2.5);
    expect(seasonalFloorTint('cyberpunk', undefined)).toBeUndefined();
    for (const t of ['none', 'christmas', 'halloween'] as const) expect(seasonalFloorTint(t, '#c9d1dc')).toBe('#c9d1dc');
  });

  it('personagem não ganha figurino (o visual é do escritório)', () => {
    expect(seasonalCostume('cyberpunk', 0)).toBeUndefined();
    expect(seasonalCostume('cyberpunk', 7)).toBeUndefined();
  });
});
