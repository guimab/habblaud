// Contrato entre o Habblaud e um framework de agentes (Hermes hoje; outros depois). O Habblaud só conhece este
// contrato; cada driver traduz para a API do seu framework. Capacidades dizem quais botões a interface pode mostrar.

/** O que um driver sabe fazer. A interface só oferece a ação se o driver declarar a capacidade. */
export type DriverCapability = 'observe' | 'chat' | 'create' | 'approve' | 'steer' | 'stop' | 'fork' | 'schedule' | 'model';

/** Evento de uma resposta em andamento, já no formato do Habblaud (independente do framework). */
export interface ChatEvent {
  type: 'delta' | 'tool' | 'done' | 'error';
  /** `delta`: pedaço de texto da resposta. */
  text?: string;
  /** `tool`: nome da ferramenta em uso e uma prévia curta. */
  tool?: string;
  preview?: string;
  /** `error`: mensagem já pronta para mostrar (nunca contém credenciais). */
  message?: string;
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
}
