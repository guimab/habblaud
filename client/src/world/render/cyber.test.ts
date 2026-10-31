// Peças puras do tema cyberpunk: o que se move (chuva, letreiro, painel do elevador) e a piscada do neon.
import { describe, expect, it } from 'vitest';
import { CYBER, RAIN_PX_PER_SEC, billboardBars, holoScanlines, neonFlicker, rainDrops, type Drop } from './cyber';

const GLASS = { x: 100, y: 50, w: 60, h: 24 };

describe('tema cyberpunk: o que se move', () => {
  it('o neon pisca entre 0,5 e 1, determinístico por (instante, semente)', () => {
    const vals = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const v = neonFlicker(i * 140, 7);
      expect(v, `passo ${i}`).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(1);
      vals.add(v);
    }
    expect(vals.size).toBeGreaterThan(1); // pisca
    expect([...vals].some((v) => v < 1)).toBe(true); // tem queda
    expect(neonFlicker(1234, 7)).toBe(neonFlicker(1234, 7));
    for (let i = 0; i < 50; i++) expect(neonFlicker(i * 140, 8)).toBeLessThanOrEqual(1);
  });

  it('as gotas escorrem dentro do vidro e caem com o tempo', () => {
    const a = rainDrops(GLASS, 0, 3);
    expect(a.length).toBe(18);
    for (const d of a) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThan(GLASS.w - 1); // o risco de 2 px caber inteiro no vidro
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y + d.len).toBeLessThanOrEqual(GLASS.h);
      expect(d.len).toBeGreaterThanOrEqual(3);
      expect(d.len).toBeLessThanOrEqual(6);
    }
    expect(rainDrops(GLASS, 5000, 3).map((d) => d.y)).not.toEqual(a.map((d) => d.y));
    expect(rainDrops(GLASS, 0, 3)).toEqual(a); // mesma semente e instante = mesmo quadro
  });

  it('a chuva cai devagar: ~1 px por segundo no máximo, mais de 10 s para atravessar o vidro', () => {
    const a = rainDrops(GLASS, 0, 5);
    const b = rainDrops(GLASS, 1000, 5);
    const c = rainDrops(GLASS, 4000, 5);
    // Deslocamento para baixo entre dois quadros, já contando a volta ao topo: o movimento é sempre para baixo,
    // então o resto do módulo é o quanto a gota andou (e não o salto de volta ao topo).
    const desceu = (de: Drop, para: Drop) => {
      const faixa = GLASS.h - de.len + 1;
      return (para.y - de.y + faixa) % faixa;
    };
    a.forEach((d, i) => {
      expect(desceu(d, b[i]!), `gota ${i} em 1 s`).toBeLessThanOrEqual(Math.ceil(RAIN_PX_PER_SEC.max));
      expect(desceu(d, c[i]!), `gota ${i} em 4 s`).toBeGreaterThanOrEqual(1); // escorre, não congela
    });
    expect(RAIN_PX_PER_SEC.max).toBeLessThanOrEqual(2);
    expect(GLASS.h / RAIN_PX_PER_SEC.max).toBeGreaterThan(10); // o vidro inteiro leva mais de 10 s
  });

  it('o letreiro refletido não sai do vidro e usa as cores do tema', () => {
    const bars = billboardBars(GLASS, 11);
    expect(bars.length).toBeGreaterThanOrEqual(2);
    expect(bars.length).toBeLessThanOrEqual(3);
    for (const b of bars) {
      expect([CYBER.neon, CYBER.cold, CYBER.hot]).toContain(b.color);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(GLASS.w);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(GLASS.h);
    }
  });

  it('as linhas do painel holográfico descem com o tempo', () => {
    const h = 9;
    const a = holoScanlines(h, 0, 5);
    expect(a).toHaveLength(3);
    for (const y of a) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(h - 2);
    }
    expect(holoScanlines(h, 500, 5)).not.toEqual(a);
    expect(holoScanlines(h, 0, 5)).toEqual(a);
  });
});
