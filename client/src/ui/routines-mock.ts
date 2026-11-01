// Dados de demonstração da tela Agendas (?mock=1): nada sai do navegador.
import type { RoutinesResponse } from './routines-model';

const day = 86_400_000;

export const MOCK_ROUTINES: RoutinesResponse = {
  sources: { habblaud: { ok: true, timeZone: 'America/Sao_Paulo' }, hermes: { ok: true } },
  routines: [
    {
      key: 'habblaud:s1', source: 'habblaud', id: 's1',
      habblaud: { id: 's1', cardId: 'c1', text: 'Veja a saúde do cluster e avise se algo caiu', rule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:30' }, enabled: true, createdAt: Date.now() - 7 * day, next: Date.now() + day / 3, last: { at: Date.now() - day, result: 'started' } },
    },
    {
      key: 'hermes:j1', source: 'hermes', id: 'j1',
      hermes: { id: 'j1', name: 'Resumo diário', prompt: 'Resuma as notícias de infraestrutura', schedule: { kind: 'cron', display: '0 9 * * *', expr: '0 9 * * *' }, enabled: true, state: 'scheduled', nextRunAt: new Date(Date.now() + day / 2).toISOString(), lastRunAt: new Date(Date.now() - day / 2).toISOString(), lastStatus: 'ok', deliver: 'telegram', repeat: { completed: 12 }, skills: ['news'], model: 'gpt-5', latest: { status: 'completed', startedAt: new Date(Date.now() - day / 2).toISOString(), finishedAt: new Date(Date.now() - day / 2 + 60_000).toISOString(), deliveryOutcome: 'delivered' } },
    },
    {
      key: 'hermes:j2', source: 'hermes', id: 'j2',
      hermes: { id: 'j2', name: 'Backup semanal', prompt: 'Confira os backups do Proxmox', schedule: { kind: 'interval', display: 'every 10080m', minutes: 10080 }, enabled: false, state: 'paused', pausedReason: 'manutenção', deliver: 'local', repeat: { completed: 3 }, skills: [], workdir: '/root', lastStatus: 'error', lastError: 'timeout', lastRunAt: new Date(Date.now() - 3 * day).toISOString() },
    },
  ],
};
