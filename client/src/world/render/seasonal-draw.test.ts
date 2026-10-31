// Prova do DESENHO do tema cyberpunk com um contexto de canvas falso: janela (vidro escuro + chuva + letreiro
// refletido) e painel do elevador. Sem isto, um efeito sutil (poucos pixels, semitransparente) fica invisível na
// captura e não se sabe se o problema é o desenho ou o zoom.
import { describe, expect, it } from 'vitest';
import { CYBER } from './cyber';
import { decorateElevator, drawSeasonalWindow } from './seasonal';

interface Fill {
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
  alpha: number;
}

class FakeCtx {
  fills: Fill[] = [];
  fillStyle = '';
  globalAlpha = 1;
  lineWidth = 1;
  strokeStyle = '';
  font = '';
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  clip(): void {}
  rect(): void {}
  stroke(): void {}
  drawImage(): void {}
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ x, y, w, h, style: this.fillStyle, alpha: this.globalAlpha });
  }
}

const fake = () => {
  const c = new FakeCtx();
  return { c, ctx: c as unknown as CanvasRenderingContext2D };
};

const GLASS = { x: 1000, y: 200, w: 60, h: 24 };
const dentro = (f: Fill, g = GLASS) => f.x >= g.x && f.y >= g.y && f.x + f.w <= g.x + g.w && f.y + f.h <= g.y + g.h;
const ehCor = (f: Fill) => [CYBER.neon, CYBER.cold, CYBER.hot].includes(f.style as never);

describe('tema cyberpunk: desenho da janela', () => {
  it('desenha o vidro escuro, a chuva escorrendo e o letreiro, tudo dentro do vidro', () => {
    const { c, ctx } = fake();
    drawSeasonalWindow(ctx, 'cyberpunk', GLASS, 5000, 42);

    const vidro = c.fills.find((f) => f.style === '#0c1424');
    expect(vidro).toBeTruthy();
    expect(vidro!.w).toBe(GLASS.w);
    expect(vidro!.h).toBe(GLASS.h);

    const chuva = c.fills.filter((f) => f.style === '#cbe8ff');
    expect(chuva.length).toBeGreaterThan(8);
    for (const d of chuva) {
      expect(dentro(d)).toBe(true);
      expect(d.w).toBe(2); // risco, não pingo
      expect(d.h).toBeGreaterThanOrEqual(3);
      expect(d.alpha).toBeGreaterThan(0.4);
    }

    const barras = c.fills.filter(ehCor);
    expect(barras.length).toBeGreaterThanOrEqual(2);
    expect(barras.length).toBeLessThanOrEqual(3);
    for (const b of barras) {
      expect(dentro(b)).toBe(true);
      expect(b.h).toBeGreaterThan(b.w / 10); // faixa, não risco de 1 px
      expect(b.alpha).toBeGreaterThan(0.3);
    }
  });

  it('o Natal continua como estava (neve sim, chuva e letreiro não)', () => {
    const { c, ctx } = fake();
    drawSeasonalWindow(ctx, 'christmas', GLASS, 0, 7);
    expect(c.fills.some((f) => f.style === '#edf3f3')).toBe(true);
    expect(c.fills.some((f) => f.style === '#cbe8ff')).toBe(false);
    expect(c.fills.some(ehCor)).toBe(false);
  });

  it('a chuva cai com o tempo (mesma semente, quadros diferentes)', () => {
    const a = fake();
    const b = fake();
    drawSeasonalWindow(a.ctx, 'cyberpunk', GLASS, 0, 7);
    drawSeasonalWindow(b.ctx, 'cyberpunk', GLASS, 700, 7);
    const ys = (c: FakeCtx) => c.fills.filter((f) => f.style === '#cbe8ff').map((f) => f.y);
    expect(ys(b.c)).not.toEqual(ys(a.c));
  });
});

describe('tema cyberpunk: painel do elevador', () => {
  it('põe o painel acima da porta, com bordas ciano e três linhas de varredura', () => {
    const { c, ctx } = fake();
    decorateElevator(ctx, 'cyberpunk', 300, 400, 0, 9);
    const painel = c.fills.find((f) => f.style === '#0d1b24')!;
    expect(painel).toBeTruthy();
    expect(painel.y + painel.h).toBeLessThan(400); // acima da porta, não sobre ela
    expect(painel.x + painel.w / 2).toBeCloseTo(300, 0); // centrado na porta
    expect(c.fills.filter((f) => f.style === CYBER.cold)).toHaveLength(2); // bordas de cima e de baixo
    expect(c.fills.filter((f) => f.style === '#7ef0ff')).toHaveLength(3); // varredura
  });

  it('a varredura desce com o tempo e o painel pisca', () => {
    const a = fake();
    const b = fake();
    decorateElevator(a.ctx, 'cyberpunk', 300, 400, 0, 9);
    decorateElevator(b.ctx, 'cyberpunk', 300, 400, 1600, 9);
    const scan = (c: FakeCtx) => c.fills.filter((f) => f.style === '#7ef0ff').map((f) => f.y);
    expect(scan(b.c)).not.toEqual(scan(a.c));
  });

  it('sem tema (ou nos sazonais) o painel não aparece', () => {
    const { c, ctx } = fake();
    decorateElevator(ctx, 'none', 300, 400, 0, 9);
    expect(c.fills).toHaveLength(0);
  });
});
