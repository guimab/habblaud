# Driver do Hermes + Consultor — Implementation Plan

> **Para agentes:** use a skill de execução (subagent-driven ou inline), tarefa por tarefa. Passos com `- [ ]`.

**Objetivo:** botão/atalho "Consultor" no Habblaud que abre uma sessão nova do Hermes num painel lateral, com
contexto opcional, resposta em stream e arquivamento automático. Promover para projeto fica na entrega 2 (Projetos).

**Arquitetura:** um contrato de driver (`server/drivers/contract.ts`) com capacidades; o driver do Hermes fala só
com a API HTTP (`/api/sessions`, `chat/stream`, `PATCH archived`). Um serviço de consultas usa o driver; rotas
`/api/consult*` expõem ao cliente; um painel no cliente consome o stream. A observação continua pelo adaptador atual.

**Stack:** Node ≥22.12, TypeScript, `node:http`/`fetch` (sem dependência nova), Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-10-30-habblaud-hermes-design.md`

## Restrições globais

- Sem dependências de runtime novas (o servidor só usa módulos `node:*`).
- Porta principal só no loopback; rotas novas passam pela trava `trusted(req, feature)` de `server/http/app.ts`.
- A chave do Hermes nunca vai ao cliente nem aos logs.
- Sem acesso ao `state.db`; só a API HTTP do Hermes.
- Cópia local `/root/habblaud-dev` diverge do original; pode mudar estrutura.
- Hermes API: `http://192.168.0.31:8642`, `Authorization: Bearer <API_SERVER_KEY>`.

## Foco de revisão

1. Hermes fora do ar ou chave errada → painel mostra erro claro, servidor não cai (teste na Tarefa 2 e 4).
2. Usuário fecha o painel no meio do stream → conexão com o Hermes é abortada, sem vazamento (Tarefa 4).
3. Título repetido (`400 invalid_title`) → tenta `(2)`, `(3)`… (Tarefa 2).
4. Acesso pela porta remota sem `consult` em `HABBLAUD_REMOTE_ALLOW` → 403 (Tarefa 4).
5. Consulta ociosa 30 min → arquivada uma vez só, mesmo com várias consultas (Tarefa 3).

## Mapa de arquivos

- Create `server/drivers/contract.ts` — tipos do driver e capacidades.
- Create `server/drivers/hermes/client.ts` (+ `.test.ts`) — cliente HTTP da API do Hermes.
- Create `server/drivers/hermes/sse.ts` (+ `.test.ts`) — parser de SSE para iterável de eventos.
- Create `server/consult/service.ts` (+ `.test.ts`) — consultas: criar, enviar, arquivar.
- Create `server/consult/http.ts` (+ `.test.ts`) — rotas `/api/consult*`.
- Modify `server/config.ts`, `server/index.ts`, `server/http/app.ts`, `server/http/remote.ts`, `docker-compose.yml`.
- Create `client/src/ui/consult.ts`, `client/src/ui/consult-model.ts` (+ `.test.ts`); Modify `client/src/ui/topbar.ts`,
  `client/src/ui/index.ts`, `client/src/ui/styles.css`.

---

### Tarefa 0: Cópia local e base ✅

- [x] Cópia local em `/root/habblaud-dev` (histórico preservado), branch `main`, remoto só `upstream`
  (marmottajr/habblaud, consulta). `/root/habblaud` intacto (é de onde sai o container atual).
- [x] Commit `65599a1`: patch dos cartões de uso + spec + plano. `npm ci` e `npm run typecheck` OK.
- GitHub e troca do container para esta cópia ficam para depois (decisão do usuário).

### Tarefa 1: Contrato do driver

**Files:** Create `server/drivers/contract.ts`
**Produz:**
```ts
export type DriverCapability = 'observe' | 'chat' | 'create' | 'approve' | 'steer' | 'stop' | 'fork' | 'schedule' | 'model';
export interface ChatEvent { type: 'delta' | 'tool' | 'done' | 'error'; text?: string; tool?: string; preview?: string; message?: string }
export interface AgentDriver {
  readonly id: string;                         // 'hermes'
  capabilities(): Promise<ReadonlySet<DriverCapability>>;
  createSession(opts: { title: string }): Promise<{ id: string; title: string }>;
  chat(sessionId: string, message: string, signal: AbortSignal): AsyncIterable<ChatEvent>;
  archive(sessionId: string): Promise<void>;
}
```
- [ ] `npm run typecheck` → passa.
- [ ] Commit: `feat(drivers): contrato do driver`.

### Tarefa 2: Cliente HTTP do Hermes

**Files:** Create `server/drivers/hermes/sse.ts`, `server/drivers/hermes/client.ts`, testes ao lado.
**Consome:** Tarefa 1. **Produz:** `parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<{event?: string; data: string}>`,
`class HermesDriver implements AgentDriver` com `constructor(opts: { baseUrl: string; key: string; fetch?: typeof fetch })`.

- [ ] Testes `sse.test.ts`: frames divididos entre chunks; `event:` + `data:`; linha `id:` ignorada; CRLF.
- [ ] Testes `client.test.ts` (servidor `node:http` falso em porta 0):
  - `createSession` manda `POST /api/sessions {title, source:'api_server'}` com Bearer; devolve `id` de `session.id` ou `id`.
  - `400 invalid_title` → reenvia com `"<title> (2)"`; até 30 tentativas.
  - `chat` manda `POST /api/sessions/{id}/chat/stream {message}`; mapeia `assistant.delta`→`delta`(text=`delta`),
    `tool.started|tool.completed|tool.failed`→`tool`(tool=`tool_name`, preview), `error`→`error`, `done`→`done`;
    eventos desconhecidos ignorados.
  - `archive` manda `PATCH /api/sessions/{id} {archived:true}`.
  - 401 → erro com mensagem "chave do Hermes inválida" sem a chave no texto; conexão recusada → "Hermes fora do ar".
  - `capabilities()` → `{'chat','create'}` (só o que esta entrega usa).
- [ ] Rodar: `npx vitest run server/drivers` → FAIL; implementar; → PASS.
- [ ] Commit: `feat(drivers): driver HTTP do Hermes`.

### Tarefa 3: Serviço de consultas

**Files:** Create `server/consult/service.ts` (+ test).
**Produz:**
```ts
export interface Consult { id: string; sessionId: string; title: string; createdAt: number; lastUsedAt: number; archived: boolean }
export class ConsultService {
  constructor(opts: { driver: AgentDriver; now?: () => number; idleMs?: number /* 30 min */ });
  start(input: { context?: string; screen?: string }): Promise<Consult>;   // título "Consultor · <HH:MM>"
  send(id: string, text: string, signal: AbortSignal): AsyncIterable<ChatEvent>;
  list(): Consult[];
  archive(id: string): Promise<void>;
  sweep(): Promise<number>;            // arquiva ociosas; devolve quantas
}
```
- [ ] Testes: primeiro `send` prefixa contexto (`"Contexto: <context>\n\nTela: <screen>\n\n<text>"`, só partes presentes);
  envios seguintes não prefixam; `lastUsedAt` atualiza; `sweep` arquiva só as ociosas >30 min, uma vez;
  `send` em consulta arquivada → erro "consulta arquivada"; id desconhecido → erro "consulta desconhecida".
- [ ] FAIL → implementar → PASS. Commit: `feat(consult): serviço de consultas`.

### Tarefa 4: Rotas HTTP

**Files:** Create `server/consult/http.ts` (+ test); Modify `server/http/app.ts` (novo bloco antes de `/api/sessions/`),
`server/http/remote.ts` (`RemoteFeature` ganha `'consult'`).
**Produz:** `createConsultRoutes(svc: ConsultService): (req, res, path, method) => boolean`.
- `GET /api/consult` → `{available: boolean, consults: Consult[]}`
- `POST /api/consult {context?, screen?}` → 201 `Consult`
- `POST /api/consult/:id/messages {text}` → SSE `event: delta|tool|done|error`, `data: <json ChatEvent>`
- `DELETE /api/consult/:id` → arquiva, 200

- [ ] Testes: trava (porta remota sem `consult` → 403; com → ok); `text` vazio → 400; cliente fecha durante o stream
  → `AbortSignal` do driver dispara; driver lança → frame `error` e fim do stream; consulta desconhecida → 404.
- [ ] FAIL → implementar → PASS. Commit: `feat(consult): rotas /api/consult`.

### Tarefa 5: Configuração e ligação

**Files:** Modify `server/config.ts` (`hermes?: { baseUrl: string; key: string }` de `HABBLAUD_HERMES_URL` +
`HABBLAUD_HERMES_KEY`; ausente = consultor desligado), `server/index.ts` (cria `HermesDriver`, `ConsultService`,
`setInterval(sweep, 60_000).unref()`, passa rotas ao `createApiHandler`), `docker-compose.yml` (as duas variáveis),
`shared/types.ts` (`meta.consult?: boolean` no snapshot).
- [ ] Teste em `server/config` existente: sem variáveis → `hermes` undefined; com → preenchido; key nunca em `toString`/log.
- [ ] `npm run typecheck && npx vitest run` → PASS (exceto a falha conhecida de `statusline.test.ts` com root).
- [ ] Commit: `feat(consult): configuração HABBLAUD_HERMES_*`.

### Tarefa 6: Painel do consultor (cliente)

**Files:** Create `client/src/ui/consult-model.ts` (+ test), `client/src/ui/consult.ts`; Modify `topbar.ts`
(botão "Consultor" só se `meta.consult`), `index.ts` (atalho `c` fora de campos de texto, mesmo padrão de `onKey`),
`styles.css`.
**Produz:** `reduceConsult(state: ConsultView, ev: ChatEvent): ConsultView` (puro) e `class ConsultPanel`.
- Painel lateral: campo "Contexto (opcional)" visível só antes da primeira pergunta; caixa de mensagem; respostas em
  markdown (reusa `ui/markdown.ts`); linha de ferramenta "Usando <tool>"; botões "Nova consulta", "Arquivar",
  "Promover para sala"; checkbox "incluir o que estou vendo" (manda nome do agente/sala selecionados como `screen`).
- [ ] Testes do modelo: deltas concatenam; `tool` vira linha de status e some no próximo `delta`; `error` mostra
  mensagem e libera a caixa; `done` libera a caixa.
- [ ] FAIL → implementar → PASS; `npm run build` → OK. Commit: `feat(consult): painel do consultor`.

### Tarefa 7: Subir e verificar de ponta a ponta

- [ ] Usuário põe `HABBLAUD_HERMES_URL` e `HABBLAUD_HERMES_KEY` no `/root/habblaud/.env` (a chave ele mesmo copia).
- [ ] Build e subida a partir de `/root/habblaud-dev` (definir na hora: container separado ou trocar o atual).
- [ ] `curl -s 127.0.0.1:4747/api/consult` → `{"available":true,...}`.
- [ ] `curl -sN -X POST .../api/consult` e depois `.../messages {"text":"responda só OK"}` → frames `delta` e `done`.
- [ ] Na interface: abrir consultor pelo botão e pela tecla `c`, perguntar e arquivar.
- [ ] Pela porta 4748 sem `consult` em `HABBLAUD_REMOTE_ALLOW` → 403; adicionar e repetir → OK.
