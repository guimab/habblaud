import { describe, expect, it } from 'vitest';
import { emptyConsult, parseSseChunk, reduceConsult, resumeStarted, sendStarted, type ConsultView } from './consult-model';

const ask = (v: ConsultView, text: string) => sendStarted(v, text);

describe('reduceConsult', () => {
  it('pergunta abre a resposta e trava a caixa; deltas concatenam', () => {
    let v = ask(emptyConsult(), 'oi');
    expect(v.busy).toBe(true);
    v = reduceConsult(v, { type: 'delta', text: 'Ol' });
    v = reduceConsult(v, { type: 'delta', text: 'á' });
    expect(v.turns).toEqual([
      { role: 'user', text: 'oi' },
      { role: 'assistant', text: 'Olá' },
    ]);
  });

  it('ferramenta vira status e some no próximo delta', () => {
    let v = ask(emptyConsult(), 'x');
    v = reduceConsult(v, { type: 'tool', tool: 'terminal', preview: 'ls' });
    expect(v.tool).toBe('terminal');
    v = reduceConsult(v, { type: 'delta', text: 'a' });
    expect(v.tool).toBeUndefined();
  });

  it('run guarda o id; aprovação aparece e some ao responder; done limpa tudo', () => {
    let v = reduceConsult(ask(emptyConsult(), 'x'), { type: 'run', runId: 'r1' });
    expect(v.runId).toBe('r1');
    v = reduceConsult(v, { type: 'approval', approval: { command: 'rm x', choices: ['once', 'deny'] } });
    expect(v.approval).toEqual({ command: 'rm x', choices: ['once', 'deny'] });
    v = reduceConsult(v, { type: 'approved' });
    expect(v.approval).toBeUndefined();
    v = reduceConsult(v, { type: 'approval', approval: { command: 'y', choices: ['deny'] } });
    v = reduceConsult(v, { type: 'done' });
    expect(v).toMatchObject({ busy: false });
    expect(v.runId).toBeUndefined();
    expect(v.approval).toBeUndefined();
  });

  it('retomar um run: resposta vazia, caixa travada, com o id', () => {
    const v = resumeStarted(emptyConsult(), 'r9');
    expect(v).toEqual({ turns: [{ role: 'assistant', text: '' }], busy: true, runId: 'r9' });
    expect(reduceConsult(v, { type: 'delta', text: 'oi' }).turns).toEqual([{ role: 'assistant', text: 'oi' }]);
  });

  it('done libera a caixa', () => {
    const v = reduceConsult(ask(emptyConsult(), 'x'), { type: 'done' });
    expect(v.busy).toBe(false);
    expect(v.error).toBeUndefined();
  });

  it('error mostra a mensagem e libera a caixa', () => {
    const v = reduceConsult(ask(emptyConsult(), 'x'), { type: 'error', message: 'Hermes fora do ar' });
    expect(v).toMatchObject({ busy: false, error: 'Hermes fora do ar' });
  });

  it('nova pergunta limpa erro e ferramenta', () => {
    let v = reduceConsult(ask(emptyConsult(), 'x'), { type: 'error', message: 'e' });
    v = ask(v, 'y');
    expect(v.error).toBeUndefined();
    expect(v.turns.at(-1)).toEqual({ role: 'assistant', text: '' });
  });
});

describe('parseSseChunk', () => {
  it('separa frames, guarda o resto e ignora JSON inválido', () => {
    const r1 = parseSseChunk('', 'event: delta\ndata: {"type":"delta","text":"a"}\n\nevent: do');
    expect(r1.events).toEqual([{ type: 'delta', text: 'a' }]);
    const r2 = parseSseChunk(r1.rest, 'ne\ndata: {"type":"done"}\n\ndata: {quebrado\n\n');
    expect(r2.events).toEqual([{ type: 'done' }]);
    expect(r2.rest).toBe('');
  });
});
