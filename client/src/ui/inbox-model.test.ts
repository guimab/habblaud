import { describe, expect, it } from 'vitest';
import { choiceLabel, groupInbox, kindLabel, urgentCount, type InboxItem } from './inbox-model';

const item = (id: string, kind: InboxItem['kind'], project?: string): InboxItem & { p?: string } => ({ id, kind, title: id, text: '', at: 0, ...(project ? { p: project } : {}) });

describe('inbox-model', () => {
  it('agrupa por projeto: alfabético, sem projeto por último, ordem dos itens mantida', () => {
    const items = [item('a', 'reply', 'Zeta'), item('b', 'approval'), item('c', 'question', 'Alfa'), item('d', 'error', 'Zeta')];
    const groups = groupInbox(items, (i) => (i as { p?: string }).p);
    expect(groups.map((g) => [g.project, g.items.map((i) => i.id)])).toEqual([
      ['Alfa', ['c']],
      ['Zeta', ['a', 'd']],
      ['', ['b']],
    ]);
  });

  it('selo conta só o que pede decisão', () => {
    expect(urgentCount([item('a', 'approval'), item('b', 'permission'), item('c', 'question'), item('d', 'reply'), item('e', 'error'), item('f', 'interrupted')])).toBe(3);
  });

  it('rótulos', () => {
    expect(kindLabel('question')).toBe('Pergunta');
    expect(choiceLabel('session')).toBe('Nesta sessão');
  });
});
