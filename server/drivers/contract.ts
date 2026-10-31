// Contrato entre o Habblaud e um framework de agentes (Hermes hoje; outros depois). O Habblaud só conhece este
// contrato; cada driver traduz para a API do seu framework. Capacidades dizem quais botões a interface pode mostrar.

/** O que um driver sabe fazer. A interface só oferece a ação se o driver declarar a capacidade. */
export type DriverCapability = 'observe' | 'chat' | 'create' | 'approve' | 'steer' | 'stop' | 'fork' | 'schedule' | 'model';

/** Evento de uma resposta em andamento, já no formato do Habblaud (independente do framework). */
/** Escolhas de uma aprovação: só esta vez, até o fim da sessão, sempre, ou negar. */
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';
export const APPROVAL_CHOICES: readonly ApprovalChoice[] = ['once', 'session', 'always', 'deny'];

/** Pedido de aprovação de um run (comando já mascarado pelo framework). */
export interface ApprovalRequest {
  requestId?: string;
  command: string;
  description?: string;
  /** Escolhas aceitas para este pedido (subconjunto de APPROVAL_CHOICES). */
  choices: ApprovalChoice[];
}

export interface ChatEvent {
  /** `approval`: o run espera aprovação; `approved`: alguém respondeu e o run seguiu. */
  type: 'delta' | 'tool' | 'done' | 'error' | 'approval' | 'approved' | 'run';
  /** `delta`: pedaço de texto da resposta. */
  text?: string;
  /** `tool`: nome da ferramenta em uso e uma prévia curta. */
  tool?: string;
  preview?: string;
  /** `error`: mensagem já pronta para mostrar (nunca contém credenciais). */
  message?: string;
  /** `error`: o run foi parado/cancelado (não falhou). */
  interrupted?: boolean;
  approval?: ApprovalRequest;
  /** `run`: id do run em segundo plano (para redirecionar/parar). */
  runId?: string;
}

/** Evento de um run, com a posição no histórico do framework (para retomar depois). */
export type RunEvent = ChatEvent & { seq?: number };

/** Estado de um run. `gone` = o framework não conhece mais o run (expirou ou reiniciou). */
export interface RunStatus {
  state: 'running' | 'waiting' | 'done' | 'error' | 'interrupted' | 'gone';
  output?: string;
  error?: string;
  /**
   * Hermes com execução sob autoridade (ver `approve`): geração da execução atual, exigida no
   * corpo do approve. Ausente nos Hermes anteriores, que não pedem a geração.
   */
  executionGeneration?: number;
  /** Id do pedido de aprovação pendente, como aparece em `pending_controls` da projeção do run. */
  pendingApprovalId?: string;
}

/** Sessão criada pelo driver. */
export interface DriverSession {
  id: string;
  title: string;
}

export interface CreateSessionOptions {
  title: string;
  model?: string;
}

export interface ChatOptions {
  system?: string;
}

export interface AgentDriver {
  /** Identificador estável do driver (ex.: 'hermes'). */
  readonly id: string;
  capabilities(): Promise<ReadonlySet<DriverCapability>>;
  /** `model` vazio = padrão do framework. As instruções vão por turno em `chat` (ver ChatOptions). */
  createSession(opts: CreateSessionOptions): Promise<DriverSession>;
  /** Envia uma mensagem e devolve a resposta em eventos; `signal` aborta a conversa com o framework. `system` vai a
   *  cada turno: verificado no Hermes que o system_prompt da criação NÃO vale nos turnos (só o system_message). */
  chat(sessionId: string, message: string, signal: AbortSignal, opts?: ChatOptions): AsyncIterable<ChatEvent>;
  archive(sessionId: string): Promise<void>;

  // Runs: o turno roda no framework sem depender de alguém assistindo (capacidades approve/steer/stop).
  /** Inicia um turno na sessão e devolve o id do run. */
  startRun?(sessionId: string, message: string, opts?: ChatOptions): Promise<string>;
  /** Eventos do run a partir de `afterSeq` (-1 = do começo). Lança erro com `gone: true` se o run sumiu. */
  runEvents?(runId: string, afterSeq: number, signal: AbortSignal): AsyncIterable<RunEvent>;
  runStatus?(runId: string): Promise<RunStatus>;
  approve?(runId: string, choice: ApprovalChoice, requestId?: string): Promise<void>;
  steer?(runId: string, text: string): Promise<void>;
  stop?(runId: string): Promise<void>;
}
