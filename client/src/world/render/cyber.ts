// Peças puras do tema cyberpunk (Night City): a paleta e a matemática do que se move — chuva no vidro, letreiro
// refletido, painel do elevador e a piscada do neon. O desenho fica em seasonal.ts.
import { hash32 } from '../../../../shared/hash';

export const CYBER = {
  /** Parede da sala (o marrom escuro de Night City). */
  wall: '#191d29',
  /** Piso da sala escurecido. */
  floor: '#20263a',
  /** Tapete. */
  carpet: '#242b45',
  /** Neon amarelo da cidade. */
  neon: '#fcee0a',
  /** Emenda fria (ciano). */
  cold: '#00e5ff',
  /** Anúncio quente (magenta). */
  hot: '#ff2e88',
} as const;

export interface Glass {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Drop {
  x: number;
  y: number;
  len: number;
}

export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

const at = (seed: number | string, tag: string) => hash32(`${seed}:${tag}`);

/**
 * Piscada do neon: 1 quase sempre, com quedas curtas (0,55 e 0,82) de vez em quando. Determinística por
 * (instante, semente) e em passos de ~140 ms, para piscar sem estrobo.
 */
export function neonFlicker(now: number, seed: number): number {
  const h = at(seed, `f${Math.floor(now / 140)}`) % 100;
  return h < 8 ? 0.55 : h < 18 ? 0.82 : 1;
}

/**
 * Velocidade da chuva, em pixels por segundo. O vidro da janela tem ~15 px de altura útil, então nesta faixa uma
 * gota leva de ~10 a ~33 s para atravessá-lo (medido, sementes 1/7/42/99/1234): chuva de Night City escorrendo
 * devagar. Antes eram 50–110 px/s — o vidro era cruzado em 0,1–0,3 s, rápido demais para o olho ler como chuva.
 */
export const RAIN_PX_PER_SEC = { min: 0.4, max: 1.2 } as const;

/** Gotas escorrendo no vidro: cada uma cai na sua velocidade e volta ao topo (o x é fixo por gota). */
export function rainDrops(glass: Glass, now: number, seed: number, count = 18): Drop[] {
  const w = Math.max(1, Math.floor(glass.w));
  const h = Math.max(1, Math.floor(glass.h));
  const drops: Drop[] = [];
  for (let i = 0; i < count; i++) {
    const len = 3 + (at(seed, `l${i}`) % 4);
    // O risco fica inteiro dentro do vidro (2 px de largura, `len` de altura): quem desenha nunca depende do clip.
    const x = at(seed, `x${i}`) % Math.max(1, w - 1);
    // O `now` chega em ms: px/s ÷ 1000 = px/ms. A posição é inteira, então a gota anda 1 px a cada ~1–2,5 s.
    const speed = (RAIN_PX_PER_SEC.min + ((RAIN_PX_PER_SEC.max - RAIN_PX_PER_SEC.min) * (at(seed, `v${i}`) % 100)) / 100) / 1000;
    drops.push({ x, y: (Math.floor(now * speed) + at(seed, `y${i}`)) % Math.max(1, h - len + 1), len });
  }
  return drops;
}

/** Letreiro de neon refletido no vidro: 2 ou 3 faixas, sempre dentro dele e nas cores do tema. */
export function billboardBars(glass: Glass, seed: number): Bar[] {
  const w = Math.max(1, Math.floor(glass.w));
  const h = Math.max(1, Math.floor(glass.h));
  const colors = [CYBER.hot, CYBER.cold, CYBER.neon];
  const n = 2 + (at(seed, 'n') % 2);
  const bars: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const bw = Math.min(w, Math.max(4, Math.floor(w * (0.35 + (at(seed, `bw${i}`) % 26) / 100))));
    const bh = Math.min(h, 4 + (at(seed, `bh${i}`) % 2));
    bars.push({
      x: at(seed, `bx${i}`) % Math.max(1, w - bw + 1),
      y: Math.min(Math.max(0, h - bh), 1 + (at(seed, `by${i}`) % Math.max(1, h - bh))),
      w: bw,
      h: bh,
      color: colors[i % colors.length]!,
    });
  }
  return bars;
}

/** Varredura do painel holográfico do elevador: 3 linhas que descem pelo painel. */
export function holoScanlines(height: number, now: number, seed: number): number[] {
  const n = Math.max(1, Math.floor(height) - 2);
  const head = (Math.floor(now / 160) + (at(seed, 'scan') % n)) % n;
  const step = Math.max(1, Math.ceil(n / 3));
  return [0, step, step * 2].map((d) => (head + d) % n);
}
