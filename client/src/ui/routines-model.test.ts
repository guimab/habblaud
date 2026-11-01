import { describe, expect, it } from 'vitest';
import { hermesLastLabel, hermesScheduleLabel, hermesStatus, jobEditDiff, routineRows, runConfirm, sourceNotices, type HermesJobDto, type RoutinesResponse } from './routines-model';

function job(over: Partial<HermesJobDto> = {}): HermesJobDto {
  return { id: 'j1', name: 'Resumo', prompt: 'Resuma', schedule: { kind: 'cron', display: '0 9 * * 1', expr: '0 9 * * 1' }, enabled: true, state: 'scheduled', deliver: 'local', repeat: { completed: 0 }, skills: [], ...over };
}

describe('routines-model', () => {
  it('rótulo da regra Hermes: intervalo em linguagem, cron literal, única com data', () => {
    expect(hermesScheduleLabel({ kind: 'interval', display: 'every 1440m', minutes: 1440 })).toBe('todo dia');
    expect(hermesScheduleLabel({ kind: 'interval', display: 'every 90m', minutes: 90 })).toBe('a cada 90 min');
    expect(hermesScheduleLabel({ kind: 'cron', display: '0 9 * * 1', expr: '0 9 * * 1' })).toBe('cron 0 9 * * 1');
    expect(hermesScheduleLabel({ kind: 'once', display: 'x', runAt: '2026-11-02T09:05:00-03:00' })).toMatch(/^uma vez, \d\d\/11 \d\d:05$/);
    expect(hermesScheduleLabel({ kind: 'weird', display: 'algo' })).toBe('algo');
  });

  it('estado Hermes: rodando, pausada (com motivo), concluída, erro, ativa', () => {
    expect(hermesStatus(job({ latest: { status: 'running', startedAt: 'x' } }))).toEqual({ kind: 'running', text: 'executando agora' });
    expect(hermesStatus(job({ enabled: false, state: 'paused', pausedReason: 'férias' }))).toEqual({ kind: 'paused', text: 'pausada: férias' });
    expect(hermesStatus(job({ enabled: false, state: 'paused' }))).toEqual({ kind: 'paused', text: 'pausada' });
    expect(hermesStatus(job({ enabled: false, state: 'completed', repeat: { times: 2, completed: 2 } }))).toEqual({ kind: 'done', text: 'concluída' });
    expect(hermesStatus(job({ lastStatus: 'error', lastError: 'boom', nextRunAt: '2026-11-02T09:00:00-03:00' })).kind).toBe('error');
    expect(hermesStatus(job({ nextRunAt: '2026-11-02T09:00:00-03:00' })).text).toMatch(/^próxima: 02\/11/);
  });

  it('última execução: diz o que aconteceu e lembra que a resposta fica no Hermes', () => {
    expect(hermesLastLabel(job())).toBe('ainda não executou');
    const ok = hermesLastLabel(job({ latest: { status: 'completed', finishedAt: '2026-11-01T00:20:13-03:00', deliveryOutcome: 'suppressed' } }));
    expect(ok).toMatch(/^concluída \d\d\/\d\d \d\d:\d\d · entrega local · resposta completa só no Hermes$/);
    expect(hermesLastLabel(job({ lastStatus: 'error', lastError: 'boom', lastRunAt: '2026-11-01T00:20:13-03:00' }))).toMatch(/^erro \d\d\/\d\d \d\d:\d\d: boom/);
    expect(hermesLastLabel(job({ latest: { status: 'completed', finishedAt: '2026-11-01T00:20:13-03:00' }, lastDeliveryError: 'tg off' }))).toContain('falha na entrega: tg off');
  });

  it('linhas: chave origem:id, Habblaud com nome da ficha, Hermes com campos só-leitura', () => {
    const resp: RoutinesResponse = {
      sources: { habblaud: { ok: true }, hermes: { ok: true } },
      routines: [
        { key: 'hermes:j1', source: 'hermes', id: 'j1', hermes: job({ model: 'gpt-x', workdir: '/w' }) },
        { key: 'habblaud:s1', source: 'habblaud', id: 's1', habblaud: { id: 's1', cardId: 'c1', text: 'veja o cluster', rule: { kind: 'every', minutes: 60 }, enabled: true, createdAt: 1, next: Date.parse('2026-11-01T10:00:00') } },
      ],
    };
    const rows = routineRows(resp, (id) => (id === 'c1' ? 'Ops' : undefined));
    expect(rows.map((r) => [r.key, r.sourceLabel, r.title, r.rule])).toEqual([
      ['habblaud:s1', 'Habblaud', 'Ops', 'a cada hora'],
      ['hermes:j1', 'Hermes', 'Resumo', 'cron 0 9 * * 1'],
    ]);
    expect(rows[0]!.prompt).toBe('veja o cluster');
    expect(rows[1]!.readOnly).toEqual([['modelo', 'gpt-x'], ['pasta', '/w']]);
  });

  it('linhas: ficha sumida não inventa nome; paradas vão para o fim', () => {
    const resp: RoutinesResponse = {
      sources: { habblaud: { ok: true }, hermes: { ok: true } },
      routines: [
        { key: 'hermes:p', source: 'hermes', id: 'p', hermes: job({ id: 'p', name: 'Parada', enabled: false, state: 'paused' }) },
        { key: 'hermes:a', source: 'hermes', id: 'a', hermes: job({ id: 'a', name: 'Ativa', nextRunAt: '2026-11-03T09:00:00-03:00' }) },
        { key: 'habblaud:s', source: 'habblaud', id: 's', habblaud: { id: 's', cardId: 'gone', text: 't', rule: { kind: 'every', minutes: 5 }, enabled: true, createdAt: 1, next: Date.parse('2026-11-02T00:00:00-03:00') } },
      ],
    };
    const rows = routineRows(resp, () => undefined);
    expect(rows.map((r) => r.key)).toEqual(['habblaud:s', 'hermes:a', 'hermes:p']);
    expect(rows[0]!.title).toBe('ficha removida');
  });

  it('avisos por origem: erro e desligada aparecem, ok não', () => {
    expect(sourceNotices({ habblaud: { ok: true }, hermes: { ok: false, code: 'unavailable', error: 'Hermes fora do ar' } })).toEqual([{ source: 'hermes', kind: 'error', text: 'Hermes: Hermes fora do ar — as rotinas do Hermes não estão nesta lista' }]);
    expect(sourceNotices({ habblaud: { ok: false, code: 'off', error: 'x' }, hermes: { ok: true } })).toEqual([{ source: 'habblaud', kind: 'off', text: 'Habblaud: x' }]);
  });

  it('diff de edição: só o que mudou, aparando espaços; nada mudou = null', () => {
    const j = job({ skills: ['a', 'b'] });
    expect(jobEditDiff(j, { name: 'Resumo', schedule: '0 9 * * 1', prompt: 'Resuma', deliver: 'local', skills: 'a, b' })).toBeNull();
    expect(jobEditDiff(j, { name: ' Novo ', schedule: '0 9 * * 1 ', prompt: 'Resuma', deliver: 'local', skills: 'a,b' })).toEqual({ name: 'Novo' });
    expect(jobEditDiff(j, { name: 'Resumo', schedule: 'every 2h', prompt: 'Outro', deliver: 'telegram', skills: '' })).toEqual({ schedule: 'every 2h', prompt: 'Outro', deliver: 'telegram', skills: [] });
    // Regra de intervalo: o display normalizado do Hermes ("every 1440m") vale como "não mudou".
    expect(jobEditDiff(job({ schedule: { kind: 'interval', display: 'every 1440m', minutes: 1440 } }), { name: 'Resumo', schedule: 'every 1440m', prompt: 'Resuma', deliver: 'local', skills: '' })).toBeNull();
  });

  it('diff de edição recusa nome ou regra vazios', () => {
    expect(() => jobEditDiff(job(), { name: ' ', schedule: '0 9 * * 1', prompt: '', deliver: 'local', skills: '' })).toThrow('nome obrigatório');
    expect(() => jobEditDiff(job(), { name: 'x', schedule: '', prompt: '', deliver: 'local', skills: '' })).toThrow('regra obrigatória');
  });

  it('executar agora: pausada pede confirmação e oferece manter pausada; ativa não', () => {
    expect(runConfirm(job())).toBeNull();
    expect(runConfirm(job({ enabled: false, state: 'paused' }))).toEqual({ text: 'Esta rotina está pausada. Executar agora a reativa no Hermes.', keepPausedLabel: 'Executar e manter pausada', reactivateLabel: 'Executar e deixar ativa' });
  });
});
