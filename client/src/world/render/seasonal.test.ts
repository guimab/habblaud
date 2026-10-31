// Regras puras do tema cyberpunk (Night City): escritório escuro com neon amarelo/ciano. Só o que dá para
// afirmar sem canvas: cores de parede, tapete e piso, e a ausência de figurino próprio.
import { describe, expect, it } from 'vitest';
import { parseColor } from '../../art/core/color';
import type { WallStyle } from '../../art/api';
import { seasonalCostume, seasonalFloorTint, seasonalPropFor, seasonalRugColor, seasonalWallStyle } from './seasonal';

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

  it('todos os personagens ganham a viseira de neon', () => {
    for (const seed of [0, 7, 1234]) expect(seasonalCostume('cyberpunk', seed)).toBe('visor');
    expect(seasonalCostume('none', 0)).toBeUndefined();
  });
});

describe('tema cyberpunk: qual enfeite troca cada planta', () => {
  it('a planta grande vira holograma (só a primeira da área) e a pequena vira terminal', () => {
    expect(seasonalPropFor('cyberpunk', 'plant_tall', 'room', true, 3)).toBe('holo');
    expect(seasonalPropFor('cyberpunk', 'plant_tall', 'room', false, 3)).toBeNull();
    expect(seasonalPropFor('cyberpunk', 'plant_small', 'room', false, 3)).toBe('terminal');
  });

  it('banheiro e móveis que não são planta ficam sem enfeite', () => {
    expect(seasonalPropFor('cyberpunk', 'plant_tall', 'restroom', true, 3)).toBeNull();
    expect(seasonalPropFor('cyberpunk', 'plant_small', 'restroom', true, 3)).toBeNull();
    expect(seasonalPropFor('cyberpunk', 'desk', 'room', true, 3)).toBeNull();
  });

  it('os outros temas seguem exatamente como estavam', () => {
    expect(seasonalPropFor('none', 'plant_tall', 'room', true, 3)).toBeNull();
    expect(seasonalPropFor('christmas', 'plant_tall', 'room', true, 3)).toBe('tree');
    expect(seasonalPropFor('christmas', 'plant_small', 'room', true, 3)).toBe('gift');
    expect(seasonalPropFor('halloween', 'plant_tall', 'room', true, 8)).toBe('pumpkin');
    expect(seasonalPropFor('halloween', 'plant_tall', 'room', true, 3)).toBe('ghost');
    expect(seasonalPropFor('halloween', 'plant_small', 'room', true, 3)).toBe('pumpkin');
    expect(seasonalPropFor('halloween', 'plant_tall', 'room', false, 3)).toBeNull();
  });
});
