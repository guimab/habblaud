// Estado puro do painel do Consultor (ui/consult.ts): conversa, ferramenta em uso, erro, caixa travada.

export interface ConsultEvent {
  type: 'delta' | 'tool' | 'done' | 'error';
  text?: string;
  tool?: string;
  preview?: string;
  message?: string;
}

export interface ConsultTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ConsultView {
  turns: ConsultTurn[];
  busy: boolean;
  tool?: string;
  error?: string;
}

export function emptyConsult(): ConsultView {
  return { turns: [], busy: false };
}

/** Pergunta enviada: entra a fala do usuário e uma resposta vazia que os deltas vão preenchendo. */
export function sendStarted(v: ConsultView, text: string): ConsultView {
  return { turns: [...v.turns, { role: 'user', text }, { role: 'assistant', text: '' }], busy: true };
}

export function reduceConsult(v: ConsultView, e: ConsultEvent): ConsultView {
  switch (e.type) {
    case 'delta': {
      const turns = v.turns.slice();
      const last = turns.at(-1);
      if (last?.role === 'assistant') turns[turns.length - 1] = { role: 'assistant', text: last.text + (e.text ?? '') };
      else turns.push({ role: 'assistant', text: e.text ?? '' });
      const { tool: _t, ...rest } = v;
      return { ...rest, turns };
    }
    case 'tool':
      return { ...v, tool: e.tool || undefined };
    case 'done': {
      const { tool: _t, ...rest } = v;
      return { ...rest, busy: false };
    }
    case 'error': {
      const { tool: _t, ...rest } = v;
      return { ...rest, busy: false, error: e.message || 'erro' };
    }
  }
}

/** Junta o pedaço novo ao resto anterior e devolve os eventos completos (JSON do `data:`) + o que sobrou. */
export function parseSseChunk(rest: string, chunk: string): { events: ConsultEvent[]; rest: string } {
  const buf = (rest + chunk).replace(/\r\n?/g, '\n');
  const blocks = buf.split('\n\n');
  const tail = blocks.pop() ?? '';
  const events: ConsultEvent[] = [];
  for (const b of blocks) {
    const data = b
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      const e = JSON.parse(data) as ConsultEvent;
      if (e && typeof e.type === 'string') events.push(e);
    } catch {
      /* frame quebrado: ignora */
    }
  }
  return { events, rest: tail };
}
