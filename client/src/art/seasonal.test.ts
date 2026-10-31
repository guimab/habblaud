import { describe, expect, it } from 'vitest';
import { parseColor } from './core/color';
import { appearanceFromSeed } from './character/appearance';
import { POSE_FRAMES, renderCharacter } from './character/render';
import type { Dir, Pose } from './api';
import { renderSeasonalProp } from './seasonal';

describe('acessórios sazonais', () => {
  it('mantém a aparência original e desenha os acessórios em todas as poses e direções', () => {
    const appearance = appearanceFromSeed(42);
    const original = { ...appearance };
    for (const dir of ['up', 'down', 'left', 'right'] as Dir[]) {
      for (const pose of Object.keys(POSE_FRAMES) as Pose[]) {
        for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
          const req = { appearance, dir, pose, frame };
          const plain = renderCharacter(req);
          for (const costume of ['santa', 'witch', 'pumpkin', 'vampire'] as const) {
            const dressed = renderCharacter({ ...req, costume });
            expect(dressed.buf.data.some((byte, i) => byte !== plain.buf.data[i])).toBe(true);
            expect([dressed.ax, dressed.ay]).toEqual([plain.ax, plain.ay]);
          }
        }
      }
    }
    expect(appearance).toEqual(original);
  });

  it('a viseira do cyberpunk aparece com o rosto à vista e não brilha de costas', () => {
    const appearance = appearanceFromSeed(11);
    const tem = (buf: { data: Uint8ClampedArray }, hex: string) => {
      const [r, g, b] = parseColor(hex);
      for (let i = 0; i < buf.data.length; i += 4) {
        if (buf.data[i] === r && buf.data[i + 1] === g && buf.data[i + 2] === b && buf.data[i + 3] === 255) return true;
      }
      return false;
    };
    // De frente (rosto sempre à vista): a faixa muda o desenho e a linha de neon aparece em todos os quadros.
    for (const pose of Object.keys(POSE_FRAMES) as Pose[]) {
      for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
        const req = { appearance, dir: 'down' as Dir, pose, frame };
        const plain = renderCharacter(req);
        const visto = renderCharacter({ ...req, costume: 'visor' });
        expect(tem(plain.buf, '#00e5ff'), `down ${pose} ${frame}`).toBe(false);
        expect(tem(visto.buf, '#00e5ff'), `down ${pose} ${frame}`).toBe(true);
        expect(visto.buf.data.some((v, i) => v !== plain.buf.data[i]), `down ${pose} ${frame}`).toBe(true);
      }
    }
    // De lado: igual, menos no primeiro quadro de comemoração, em que a mão erguida passa na frente do rosto.
    for (const dir of ['left', 'right'] as Dir[]) {
      for (const pose of Object.keys(POSE_FRAMES) as Pose[]) {
        for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
          const visto = renderCharacter({ appearance, dir, pose, frame, costume: 'visor' });
          const maoNaFrente = pose === 'cheer' && frame === 0;
          expect(tem(visto.buf, '#00e5ff'), `${dir} ${pose} ${frame}`).toBe(!maoNaFrente);
        }
      }
    }
    // De costas o rosto não aparece: só a haste, sem a linha de neon.
    for (const pose of Object.keys(POSE_FRAMES) as Pose[]) {
      for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
        const visto = renderCharacter({ appearance, dir: 'up', pose, frame, costume: 'visor' });
        expect(tem(visto.buf, '#00e5ff'), `up ${pose} ${frame}`).toBe(false);
      }
    }
  });
  it('mantém decorações dentro das folhas de desenho, com margem transparente', () => {
    for (const kind of ['tree', 'gift', 'pumpkin', 'ghost', 'wreath', 'bat', 'holo', 'terminal'] as const) {
      const { buf } = renderSeasonalProp(kind);
      const bounds = buf.bounds()!;
      expect(buf.countOpaque()).toBeGreaterThan(40);
      expect(bounds.x).toBeGreaterThan(0);
      expect(bounds.y).toBeGreaterThan(0);
      expect(bounds.x + bounds.w).toBeLessThan(buf.w);
      expect(bounds.y + bounds.h).toBeLessThan(buf.h);
    }
  });
});
