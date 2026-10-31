// Móveis do tema cyberpunk (Night City). Mesmo contrato dos móveis do escritório (floorSheet 1x1, coordenadas do
// footprint, contorno e sombra de contato) — o tema troca o SPRITE de móveis que já existem, então cada peça aqui
// mantém o footprint e a altura da original para nada se deslocar.
import { ramp, shade } from '../core/color';
import type { PixelBuf } from '../core/pixbuf';
import { floorSheet, rectAt, type BufFurniture } from '../core/sprite';
import { contact, frontFace, glass, topFace } from './kit';

const NEON = '#fcee0a';
const COLD = '#00e5ff';
const HOT = '#ff2e88';
const LEDS = ['#39ff88', '#ffc95c', '#00e5ff'] as const;

/** Bainha de neon: trilho escuro com o fio aceso no meio. */
function neonLine(b: PixelBuf, x0: number, x1: number, y: number, color: string): void {
  b.hline(x0, x1, y, shade(color, -0.45));
  b.hline(x0, x1, y + 1, color);
}

/** Estante de pastas -> rack de servidores: gavetas de rack, LEDs e trilho de neon (troca `binder_shelf`). */
export function serverRack(): BufFurniture {
  const s = floorSheet(1, 1, 22);
  const b = s.buf;
  const m = ramp('#2b3040', 0.07);
  topFace(b, 1, -21, 14, 3, m);
  frontFace(b, 1, -18, 14, 34, m);
  b.vline(1, -18, 15, m.lt);
  b.vline(14, -18, 15, m.dd);
  // Gavetas de rack: vão escuro, frente clara e parafuso nas pontas.
  for (let y = -17; y <= 8; y += 5) {
    b.hline(3, 12, y, '#161b26');
    b.hline(3, 12, y + 1, m.lt);
    b.set(3, y + 1, m.dd);
    b.set(12, y + 1, m.dd);
  }
  // LEDs acesos (verde, âmbar e ciano), alternando por linha.
  for (let row = 0; row < 5; row++) {
    for (let x = 4; x <= 11; x += 2) b.set(x, -16 + row * 5, LEDS[(x + row) % 3]!);
  }
  // Neon no alto e na lateral, e a etiqueta magenta de "não abrir".
  neonLine(b, 2, 13, -19, NEON);
  neonLine(b, 2, 13, 12, HOT);
  b.set(2, -17, COLD);
  b.set(2, -8, COLD);
  b.set(2, 1, COLD);
  b.outline();
  contact(b, 1, 13, 14, 3, 0.26);
  return { base: s };
}

/** Lixeira -> tambor com aro de neon e adesivo (troca `trash_bin`). */
export function binNeon(): BufFurniture {
  const s = floorSheet(1, 1, 6);
  const b = s.buf;
  const m = ramp('#232838', 0.07);
  for (let y = 4; y <= 15; y++) {
    const inset = y > 13 ? 1 : 0;
    b.hline(4 + inset, 11 - inset, y, m.base);
    b.set(4 + inset, y, m.lt);
    b.set(11 - inset, y, m.dk);
  }
  b.hline(5, 10, 15, m.dd);
  // Boca escura com o aro de neon em volta e o resto do lixo aparecendo.
  b.ellipse(8, 3, 4.5, 2, COLD);
  b.ellipse(8, 3.2, 3.5, 1.3, '#0d1018');
  b.set(7, 3, '#3a4152');
  b.set(9, 4, '#4a5364');
  // Adesivos.
  b.set(5, 9, HOT);
  b.set(6, 11, NEON);
  b.set(10, 8, NEON);
  b.outline();
  contact(b, 4, 13, 9, 3, 0.24);
  return { base: s };
}

/** Máquina de snacks -> máquina de venda iluminada com latas de neon (troca `vending_machine`). */
export function vendingNeon(): BufFurniture {
  const s = floorSheet(1, 1, 24);
  const b = s.buf;
  const m = ramp('#2a2f3f', 0.07);
  topFace(b, 0, -23, 16, 3, m);
  frontFace(b, 0, -20, 16, 36, m);
  b.vline(0, -20, 15, m.lt);
  // Vitrine iluminada (azul-petróleo claro, como máquina acesa de madrugada) com fileiras de latas.
  const gx = 2;
  const gy = -17;
  const gw = 9;
  const gh = 20;
  b.rect(gx, gy, gw, gh, '#154b5e');
  b.hline(gx, gx + gw - 1, gy, '#1f7f96');
  b.rect(gx, gy, 1, gh, '#0f3d4b');
  for (let row = 0; row < 5; row++) {
    const y = gy + 1 + row * 4;
    for (let k = 0; k < 3; k++) {
      const c = [COLD, HOT, NEON][(row + k) % 3]!;
      b.rect(gx + 1 + k * 3, y, 2, 3, c);
      b.set(gx + 1 + k * 3, y, shade(c, 0.25));
    }
    b.hline(gx, gx + gw - 1, y + 3, '#2b8fa8');
  }
  glass(b, gx, gy, gw, gh, { alpha: 0.16 });
  // Painel de moedas e botões.
  b.rect(12, -15, 3, 12, '#191d29');
  b.rect(13, -14, 1, 2, '#7cf3ff');
  for (let i = 0; i < 4; i++) b.set(13, -10 + i * 2, '#39d7f0');
  b.rect(12, -1, 3, 2, '#101319');
  // Saída de produtos.
  b.rect(2, 6, 9, 4, '#101319');
  b.hline(2, 10, 6, '#2a3244');
  // Letreiro de neon no alto e fio aceso pela lateral.
  neonLine(b, 1, 14, -21, NEON);
  b.set(2, -19, '#fff6a8');
  b.set(14, -12, COLD);
  b.set(14, -4, HOT);
  b.outline();
  contact(b, 0, 13, 16, 4, 0.26);
  return { base: s };
}

/** Luminária de chão -> poste com tubo de neon (troca `floor_lamp`; mesma altura e mesmo rects.glow). */
export function lampNeon(): BufFurniture {
  const s = floorSheet(1, 1, 26);
  const b = s.buf;
  b.ellipse(8, 14, 4, 1.5, '#20242f');
  b.hline(6, 9, 13, '#39405a');
  b.vline(8, -17, 13, '#242a38');
  b.vline(7, -17, 13, '#39415a');
  // Cabeça: tubo de neon deitado, com as pontas em magenta.
  b.rect(3, -22, 11, 4, '#101319');
  neonLine(b, 4, 12, -21, COLD);
  b.set(3, -20, HOT);
  b.set(13, -20, HOT);
  b.set(8, -23, '#7cf3ff');
  // Fio de energia descendo pela haste.
  b.vline(9, -16, 5, '#0d5f74');
  b.outline();
  contact(b, 3, 13, 10, 3, 0.22);
  s.rects = { glow: rectAt(s, 4, -21, 9, 4) };
  return { base: s };
}

/** Fliperama -> fliperama de neon com a tela acesa (troca `arcade`; mantém rects.screen do jogo). */
export function arcadeNeon(): BufFurniture {
  const s = floorSheet(1, 1, 24);
  const b = s.buf;
  const m = ramp('#2b2f45', 0.07);
  frontFace(b, 1, -20, 14, 36, m);
  b.vline(1, -20, 15, m.lt);
  // Letreiro de neon.
  b.rect(1, -22, 14, 4, '#1a1420');
  neonLine(b, 2, 13, -21, HOT);
  b.set(3, -20, '#ffd0e6');
  b.set(12, -20, '#ffd0e6');
  // Tela (o mundo desenha a partida por cima, em rects.screen).
  b.rect(2, -17, 12, 9, '#0e1420');
  const screen = { x: 3, y: -16, w: 10, h: 7 };
  b.rect(screen.x, screen.y, screen.w, screen.h, '#0d1b2a');
  b.set(4, -14, COLD);
  b.rect(8, -15, 3, 2, NEON);
  b.set(10, -11, HOT);
  // Painel inclinado com botões.
  b.rect(1, -7, 14, 4, m.hi);
  b.hline(1, 14, -4, m.dk);
  b.rect(4, -7, 2, 2, COLD);
  b.set(4, -7, '#b9ffe0');
  b.vline(5, -5, -4, '#191d29');
  for (const [x, c] of [[9, COLD], [11, HOT], [13, NEON]] as const) b.set(x, -6, c);
  // Porta de fichas e arte lateral.
  b.rect(5, 2, 6, 6, m.dd);
  b.set(6, 4, NEON);
  b.set(9, 4, NEON);
  b.line(2, 13, 6, 9, HOT);
  b.line(3, 13, 7, 9, COLD);
  b.outline();
  contact(b, 0, 13, 16, 4, 0.26);
  s.rects = { screen: rectAt(s, screen.x, screen.y, screen.w, screen.h) };
  return { base: s };
}
