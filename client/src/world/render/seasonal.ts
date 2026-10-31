import type { CharacterFrameRequest, FurnitureKind, Sprite, WallStyle } from '../../art/api';
import { mix } from '../../art/core/color';
import { hash32 } from '../../../../shared/hash';
import { renderSeasonalProp, type SeasonalProp } from '../../art/seasonal';
import type { SeasonalTheme } from '../api';
import type { AreaLayout, WallSegment } from '../layout/types';
import { CYBER, billboardBars, holoScanlines, neonFlicker, rainDrops } from './cyber';

const sprites = new Map<SeasonalProp, Sprite>();
function prop(kind: SeasonalProp): Sprite {
  let sprite = sprites.get(kind);
  if (!sprite) {
    const { buf, ax, ay } = renderSeasonalProp(kind);
    const canvas = document.createElement('canvas');
    canvas.width = buf.w;
    canvas.height = buf.h;
    canvas.getContext('2d')!.putImageData(new ImageData(buf.data, buf.w, buf.h), 0, 0);
    sprites.set(kind, sprite = { canvas, ax, ay });
  }
  return sprite;
}

export function seasonalCostume(theme: SeasonalTheme, seed: number): CharacterFrameRequest['costume'] {
  if (theme === 'christmas') return 'santa';
  if (theme === 'halloween') return (['witch', 'pumpkin', 'vampire'] as const)[(seed >>> 0) % 3];
  return undefined;
}

/**
 * Qual enfeite do tema troca este móvel (puro, sem canvas). Reutiliza footprints de plantas: nenhuma nova colisão
 * ou mudança de caminhos. No cyberpunk a primeira planta grande vira quiosque holográfico e a pequena, um terminal.
 */
export function seasonalPropFor(
  theme: SeasonalTheme,
  kind: FurnitureKind,
  areaKind: AreaLayout['kind'],
  firstPlantTall: boolean,
  seed: number,
): SeasonalProp | null {
  if (theme === 'none' || areaKind === 'restroom') return null;
  if (kind === 'plant_tall') {
    if (!firstPlantTall) return null;
    if (theme === 'cyberpunk') return 'holo';
    return theme === 'christmas' ? 'tree' : seed % 3 === 0 ? 'ghost' : 'pumpkin';
  }
  if (kind === 'plant_small') return theme === 'cyberpunk' ? 'terminal' : theme === 'christmas' ? 'gift' : 'pumpkin';
  return null;
}

export function seasonalFurniture(theme: SeasonalTheme, kind: FurnitureKind, area: AreaLayout, seed: number): Sprite | null {
  const first = area.furniture.find((f) => f.kind === kind);
  const firstPlantTall = kind === 'plant_tall' && !!first && hash32(first.id) === seed;
  const p = seasonalPropFor(theme, kind, area.kind, firstPlantTall, seed);
  return p ? prop(p) : null;
}

export function seasonalRugColor(theme: SeasonalTheme, original: string): string {
  if (theme === 'cyberpunk') return CYBER.carpet;
  return theme === 'christmas' ? '#a93649' : theme === 'halloween' ? '#60416f' : original;
}

/** Tom do piso da sala pelo tema: o cyberpunk escurece o porcelanato sem tirar a identidade da sala. */
export function seasonalFloorTint(theme: SeasonalTheme, original: string | undefined): string | undefined {
  if (!original || theme !== 'cyberpunk') return original;
  return mix(original, CYBER.floor, 0.8);
}

export function seasonalWallStyle(theme: SeasonalTheme, original: WallStyle): WallStyle {
  if (theme === 'none' || original.pattern === 'glass') return original;
  if (theme === 'cyberpunk') return { ...original, base: mix(original.base, CYBER.wall, 0.8), trim: CYBER.neon };
  return { ...original, base: mix(original.base, theme === 'christmas' ? '#ffe3b4' : '#bc97d1', 0.18), trim: theme === 'christmas' ? '#4e7756' : '#725486' };
}

/** Motivos de tapete (cacheados junto com o piso). */
export function decorateSeasonalRug(ctx: CanvasRenderingContext2D, theme: SeasonalTheme, rug: { x: number; y: number; w: number; h: number }): void {
  if (theme === 'none') return;
  const x = Math.round(rug.x), y = Math.round(rug.y), w = Math.floor(rug.w), h = Math.floor(rug.h);
  if (w < 25 || h < 16) return;
  ctx.save();
  if (theme === 'cyberpunk') {
    // Tapete do tema: faixas de sinalização (amarelo de Night City, emendas ciano) nas duas bordas.
    ctx.fillStyle = CYBER.neon;
    ctx.fillRect(x + 4, y + 4, w - 8, 1);
    ctx.fillRect(x + 4, y + h - 5, w - 8, 1);
    for (let i = 0, cx = x + 10; cx < x + w - 10; cx += 14, i++) {
      ctx.fillStyle = i % 3 === 2 ? CYBER.cold : CYBER.neon;
      ctx.fillRect(cx, Math.round(y + h / 2) - 1, 7, 2);
    }
    ctx.restore();
    return;
  }
  ctx.fillStyle = theme === 'christmas' ? '#ddb66e' : '#e5a457';
  ctx.fillRect(x + 4, y + 4, w - 8, 1);
  ctx.fillRect(x + 4, y + h - 5, w - 8, 1);
  for (let cx = x + 14; cx < x + w - 10; cx += 28) {
    const cy = Math.round(y + h / 2);
    if (theme === 'christmas') {
      ctx.fillRect(cx - 4, cy, 9, 1);
      ctx.fillRect(cx, cy - 4, 1, 9);
      for (const d of [-2, 2]) {
        ctx.fillRect(cx + d, cy + d, 1, 1);
        ctx.fillRect(cx + d, cy - d, 1, 1);
      }
    } else {
      ctx.fillRect(cx - 3, cy - 2, 7, 5);
      ctx.fillRect(cx, cy - 4, 1, 2);
      ctx.fillStyle = '#60416f';
      ctx.fillRect(cx - 2, cy - 1, 1, 1);
      ctx.fillRect(cx + 2, cy - 1, 1, 1);
      ctx.fillStyle = '#e5a457';
    }
  }
  ctx.restore();
}

/** Enfeites no alto da parede, longe das telas e placas. Os vãos ficam livres. */
export function decorateSeasonalWall(ctx: CanvasRenderingContext2D, theme: SeasonalTheme, wall: WallSegment): void {
  if (theme === 'none' || wall.kind !== 'face') return;
  ctx.save();
  const x0 = Math.round(wall.x + 3), end = Math.floor(wall.x + wall.w - 3), y = Math.round(wall.y + 5);
  if (theme === 'cyberpunk') {
    // Tubo de neon reto no alto da parede (sem a curva da guirlanda), com emendas frias ciano.
    for (let x = x0; x < end; x++) {
      if (wall.doorways?.some((d) => x >= d.x - 1 && x < d.x + d.w + 1)) continue;
      ctx.fillStyle = CYBER.neon;
      ctx.fillRect(x, y, 1, 1);
      if ((x - x0) % 16 === 8) {
        ctx.fillStyle = CYBER.cold;
        ctx.fillRect(x, y - 1, 3, 1);
        ctx.fillRect(x, y, 1, 2);
      }
    }
    ctx.restore();
    return;
  }
  for (let x = x0; x < end; x++) {
    if (wall.doorways?.some((d) => x >= d.x - 1 && x < d.x + d.w + 1)) continue;
    const sag = Math.round(Math.sin(((x - x0) % 48) / 48 * Math.PI) * 3);
    ctx.fillStyle = theme === 'christmas' ? '#347653' : '#584068';
    ctx.fillRect(x, y + sag, 1, theme === 'christmas' ? 3 : 1);
    if ((x - x0) % 12 === 6) {
      ctx.fillStyle = theme === 'christmas' ? '#f5d491' : '#eea24d';
      ctx.fillRect(x, y + sag + 3, 2, 3);
      ctx.fillStyle = theme === 'christmas' ? '#fff0be' : '#ffd78a';
      ctx.fillRect(x, y + sag + 3, 1, 1);
    }
  }
  if (theme === 'halloween') {
    // Teias pequenas nos cantos; não cobrem os equipamentos.
    ctx.strokeStyle = '#d6bfdd';
    ctx.lineWidth = 1;
    for (const side of [1, -1]) {
      const x = side === 1 ? x0 : end;
      ctx.beginPath();
      for (const [dx, dy] of [[15, 0], [13, 7], [7, 13], [0, 15]]) {
        ctx.moveTo(x, y + 2);
        ctx.lineTo(x + side * dx, y + 2 + dy);
      }
      for (const r of [5, 10, 15]) {
        ctx.moveTo(x + side * r, y + 2);
        ctx.lineTo(x + side * Math.round(r * 0.7), y + 2 + Math.round(r * 0.7));
        ctx.lineTo(x, y + 2 + r);
      }
      ctx.stroke();
    }
    if (wall.w > 90) {
      const bat = prop('bat');
      ctx.drawImage(bat.canvas, Math.round(wall.x + wall.w / 2 - bat.ax), y + 18 - bat.ay);
    }
  }
  ctx.restore();
}

/** Guirlandas nas molduras dos elevadores (sem cobrir a porta animada). No cyberpunk, o painel holográfico. */
export function decorateElevator(ctx: CanvasRenderingContext2D, theme: SeasonalTheme, x: number, y: number, now = 0, seed = 0): void {
  if (theme === 'none') return;
  if (theme === 'cyberpunk') {
    const w = 14, h = 9;
    const px = Math.round(x - w / 2), py = Math.round(y - 20 - h);
    ctx.save();
    ctx.globalAlpha = 0.8 * neonFlicker(now, seed);
    ctx.fillStyle = '#0d1b24';
    ctx.fillRect(px, py, w, h);
    ctx.fillStyle = CYBER.cold;
    ctx.fillRect(px, py, w, 1);
    ctx.fillRect(px, py + h - 1, w, 1);
    ctx.fillStyle = '#7ef0ff';
    for (const line of holoScanlines(h, now, seed)) ctx.fillRect(px + 2, py + 1 + line, w - 4, 1);
    ctx.restore();
    return;
  }
  const sprite = prop(theme === 'christmas' ? 'wreath' : 'bat');
  ctx.drawImage(sprite.canvas, Math.round(x - sprite.ax), Math.round(y - 19 - sprite.ay));
}

const glows = new Map<SeasonalTheme, HTMLCanvasElement>();
function glowSprite(theme: SeasonalTheme): HTMLCanvasElement {
  let canvas = glows.get(theme);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = 34;
    const ctx = canvas.getContext('2d')!;
    const glow = ctx.createRadialGradient(17, 17, 1, 17, 17, 17);
    const halo = theme === 'cyberpunk' ? CYBER.neon : theme === 'christmas' ? '#ffd58b' : '#d8a5ed';
    glow.addColorStop(0, halo);
    glow.addColorStop(1, halo === CYBER.neon ? 'rgba(252,238,10,0)' : 'rgba(255,220,180,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 34, 34);
    glows.set(theme, canvas);
  }
  return canvas;
}

/** Luz decorativa suave, limitada à face da parede. Não interfere com salas apagadas. */
export function drawSeasonalLights(ctx: CanvasRenderingContext2D, theme: SeasonalTheme, layout: AreaLayout, light: number, now = 0): void {
  if (theme === 'none' || light <= 0.01) return;
  ctx.save();
  for (const wall of layout.walls) {
    if (wall.kind !== 'face') continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(wall.x, wall.y + 4, wall.w, 27);
    ctx.clip();
    const flick = theme === 'cyberpunk' ? neonFlicker(now, Math.round(wall.x)) : 1;
    for (let x = wall.x + 14; x < wall.x + wall.w - 6; x += 24) {
      if (wall.doorways?.some((d) => x >= d.x - 10 && x <= d.x + d.w + 10)) continue;
      ctx.globalAlpha = light * 0.3 * flick;
      ctx.drawImage(glowSprite(theme), Math.round(x - 17), wall.y - 8);
      ctx.globalAlpha = light * 0.85 * flick;
      ctx.fillStyle = theme === 'cyberpunk' ? CYBER.cold : theme === 'christmas' ? '#ffe4a9' : '#ffd181';
      ctx.fillRect(Math.round(x), wall.y + 9, 2, 2);
    }
    ctx.restore();
  }
  ctx.restore();
}

export function drawSeasonalWindow(ctx: CanvasRenderingContext2D, theme: SeasonalTheme, glass: { x: number; y: number; w: number; h: number }, now: number, seed: number): void {
  if (theme === 'cyberpunk') {
    // Noite de Night City: o vidro escurece, chove lá fora e um letreiro de neon se reflete no vidro.
    ctx.save();
    ctx.beginPath();
    ctx.rect(glass.x, glass.y, glass.w, glass.h);
    ctx.clip();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#0c1424';
    ctx.fillRect(glass.x, glass.y, glass.w, glass.h);
    billboardBars(glass, seed).forEach((b, i) => {
      ctx.globalAlpha = 0.6 * neonFlicker(now, seed + i * 13);
      ctx.fillStyle = b.color;
      ctx.fillRect(Math.round(glass.x + b.x), Math.round(glass.y + b.y), b.w, b.h);
    });
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#cbe8ff';
    for (const d of rainDrops(glass, now, seed)) ctx.fillRect(Math.floor(glass.x + d.x), Math.floor(glass.y + d.y), 2, d.len);
    ctx.restore();
    return;
  }
  if (theme !== 'christmas') return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(glass.x, glass.y, glass.w, glass.h);
  ctx.clip();
  ctx.fillStyle = '#edf3f3';
  ctx.globalAlpha *= 0.7;
  ctx.fillRect(glass.x, glass.y + glass.h - 2, glass.w, 2);
  for (let i = 0; i < 12; i++) {
    const x = ((seed >>> 0) + i * 17) % Math.max(1, Math.floor(glass.w));
    const y = (Math.floor(now / 180) + i * 11) % Math.max(1, Math.floor(glass.h));
    ctx.fillRect(Math.floor(glass.x + x), Math.floor(glass.y + y), 1, 1);
  }
  ctx.restore();
}
