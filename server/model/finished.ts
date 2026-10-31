// Conclusões do escritório: cada sessão guarda quando o turno terminou (e se terminou com erro) e o selo "concluiu"
// só sai da lista quando alguém vê. Quem já viu fica em <dataDir>/finished.json (0600), para o selo não voltar a
// cada reinício do servidor. Só a marca de visto é persistida: a conclusão em si vive no agente (AgentInfo).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';

/** O que o Office precisa daqui (implementado por FinishedStore e pelos testes). */
export interface FinishedMarks {
  /** A conclusão de `at` deste agente já foi vista? */
  hasSeen(agentId: string, at: number): boolean;
  markSeen(agentId: string, at: number): void;
}

export class FinishedStore implements FinishedMarks {
  private readonly seen = new Map<string, number>();

  constructor(private readonly file: string | null) {
    this.load();
  }

  seenAt(agentId: string): number | undefined {
    return this.seen.get(agentId);
  }

  hasSeen(agentId: string, at: number): boolean {
    const s = this.seen.get(agentId);
    return s !== undefined && s >= at;
  }

  markSeen(agentId: string, at: number): void {
    const cur = this.seen.get(agentId);
    if (cur !== undefined && cur >= at) return;
    this.seen.set(agentId, at);
    this.save();
  }

  private load(): void {
    if (!this.file) return;
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as { seen?: Record<string, unknown> };
      for (const [id, at] of Object.entries(d.seen ?? {})) if (typeof at === 'number' && Number.isFinite(at)) this.seen.set(id, at);
    } catch {
      /* sem arquivo ou inválido: começa vazio */
    }
  }

  private save(): void {
    const file = this.file;
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, seen: Object.fromEntries(this.seen) }, null, 2), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    } catch (err) {
      log.warn(tr('Não consegui gravar {0}: {1}', [file, errMsg(err)]));
    }
  }
}
