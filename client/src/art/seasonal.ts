// Decorações procedurais em pixel art. Mesma escala dos móveis do escritório.
import { PixelBuf } from './core/pixbuf';
import type { BufSprite } from './core/sprite';

export type SeasonalProp = 'tree' | 'gift' | 'pumpkin' | 'ghost' | 'wreath' | 'bat' | 'holo' | 'terminal';

export function renderSeasonalProp(kind: SeasonalProp): BufSprite {
  const b = new PixelBuf(40, 64);
  const rect = (x: number, y: number, w: number, h: number, c: string) => b.rect(x, y, w, h, c);
  if (kind === 'tree') {
    b.shadow(20, 59, 17, 3, '#252c39', 0.22);
    rect(17, 49, 6, 9, '#80573d');
    for (let row = 0; row < 4; row++) {
      const y = 13 + row * 8;
      const half = 6 + row * 3;
      rect(20 - half, y, half * 2 + 1, 9, '#245644');
      rect(22 - half, y, half * 2 - 4, 6, '#387956');
      rect(22 - half, y + 1, half - 1, 3, '#4d9361');
    }
    b.vline(20, 5, 13, '#ffe0a0');
    b.hline(16, 24, 9, '#ffe0a0');
    rect(18, 7, 5, 5, '#ffc45d');
    for (const [x, y] of [[16, 20], [24, 24], [13, 31], [25, 36], [9, 42], [20, 43], [31, 44]]) {
      rect(x, y, 3, 3, '#e05250');
      b.set(x, y, '#ffb27b');
    }
    for (const [x, y] of [[21, 17], [15, 26], [23, 30], [15, 38], [26, 42], [11, 47]]) {
      rect(x, y, 2, 2, '#ffe8b2');
    }
    rect(3, 52, 10, 8, '#a82d42');
    rect(6, 51, 2, 9, '#e5c17b');
    rect(3, 54, 10, 1, '#e5c17b');
    rect(26, 51, 10, 9, '#e6b357');
    rect(30, 50, 2, 10, '#b33549');
    rect(26, 54, 10, 1, '#b33549');
  } else if (kind === 'gift') {
    b.shadow(20, 59, 9, 2, '#252c39', 0.2);
    rect(11, 49, 17, 11, '#bf3849');
    rect(11, 49, 17, 3, '#e35a58');
    rect(18, 49, 3, 11, '#efd1a0');
    rect(11, 54, 17, 2, '#efd1a0');
    rect(14, 46, 5, 3, '#e8b860');
    rect(21, 46, 5, 3, '#e8b860');
  } else if (kind === 'pumpkin') {
    b.shadow(20, 59, 11, 2, '#252c39', 0.2);
    rect(18, 41, 3, 6, '#557342');
    rect(11, 46, 18, 14, '#c56832');
    rect(8, 49, 24, 8, '#e18b39');
    rect(13, 46, 4, 13, '#f0a647');
    rect(23, 47, 3, 12, '#f0a647');
    rect(12, 50, 4, 3, '#523347');
    rect(24, 50, 4, 3, '#523347');
    rect(17, 56, 7, 2, '#523347');
    b.set(13, 51, '#ffd680');
    b.set(25, 51, '#ffd680');
    b.hline(18, 22, 56, '#ffd680');
  } else if (kind === 'ghost') {
    rect(15, 39, 10, 3, '#e0dae9');
    rect(12, 42, 16, 15, '#e0dae9');
    rect(14, 41, 11, 15, '#fff4ed');
    rect(10, 47, 4, 4, '#e0dae9');
    rect(26, 47, 4, 4, '#e0dae9');
    for (const x of [12, 18, 24]) rect(x, 56, 4, 3, '#e0dae9');
    rect(16, 46, 2, 3, '#574563');
    rect(23, 46, 2, 3, '#574563');
    rect(19, 51, 3, 2, '#574563');
  } else if (kind === 'wreath') {
    rect(12, 39, 16, 4, '#347653');
    rect(10, 43, 5, 10, '#245644');
    rect(25, 43, 5, 10, '#347653');
    rect(13, 53, 15, 4, '#245644');
    for (const [x, y] of [[14, 41], [26, 47], [12, 50], [23, 54]]) rect(x, y, 2, 2, '#e45c58');
    rect(15, 55, 4, 4, '#c93945');
    rect(21, 55, 4, 4, '#c93945');
    rect(19, 54, 2, 4, '#f07368');
  } else if (kind === 'holo') {
    // Quiosque de anúncio holográfico (Night City): base metálica, coluna e o painel flutuante com anúncio de neon.
    b.shadow(20, 59, 10, 2, '#252c39', 0.22);
    rect(14, 54, 12, 5, '#242a38');
    rect(14, 54, 12, 1, '#39415a');
    rect(16, 56, 8, 1, '#161b26');
    rect(18, 42, 4, 12, '#1d2230');
    b.vline(19, 42, 53, '#333c56');
    rect(17, 40, 6, 2, '#144a5c'); // feixe do projetor
    rect(10, 24, 20, 16, '#0e3242');
    rect(11, 25, 18, 14, '#124b60');
    for (let y = 26; y < 39; y += 3) b.hline(11, 28, y, '#1d7d99'); // varredura do holograma
    rect(14, 28, 6, 3, '#fcee0a'); // o amarelo da cidade
    rect(22, 28, 6, 3, '#fcee0a');
    rect(14, 33, 14, 3, '#ff2e88'); // faixa de anúncio
    b.set(20, 27, '#fff6a8');
    b.set(25, 37, '#ffd0e6');
  } else if (kind === 'terminal') {
    // Máquina de venda / terminal de dados: corpo escuro e a tela verde de terminal.
    b.shadow(20, 59, 11, 2, '#252c39', 0.22);
    rect(10, 33, 20, 26, '#1f2431');
    rect(10, 33, 20, 2, '#31384c');
    rect(10, 57, 20, 2, '#141821');
    rect(13, 36, 14, 11, '#0d2b25');
    for (let y = 37; y < 46; y += 2) b.hline(14, 25, y, '#2ef28a');
    b.set(24, 37, '#b9ffe0');
    rect(13, 49, 14, 5, '#2a3040');
    for (let x = 14; x < 26; x += 3) {
      b.set(x, 50, '#46d6ff');
      b.set(x, 52, '#46d6ff');
    }
    rect(16, 55, 8, 1, '#46d6ff'); // fenda de saída
  } else {
    rect(18, 51, 5, 6, '#47344f');
    rect(10, 50, 9, 4, '#47344f');
    rect(22, 50, 9, 4, '#47344f');
    rect(7, 48, 4, 4, '#47344f');
    rect(30, 48, 4, 4, '#47344f');
    rect(13, 53, 3, 3, '#47344f');
    rect(25, 53, 3, 3, '#47344f');
    b.set(19, 52, '#f5b95f');
    b.set(21, 52, '#f5b95f');
  }
  b.outline();
  return { buf: b, ax: 20, ay: 60 };
}
