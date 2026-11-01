# Painel único — primeira entrega Implementation Plan

> **Para agentes:** execute inline, tarefa por tarefa, seguindo writing-plans e test-driven-development. Passos com checkbox. Não presumir skill de execução instalada; carregar a skill de TDD antes de implementar.

**Objetivo:** abrir o agente em painel lateral maior com Trabalho, Histórico e Configuração, substituindo a disputa entre ficha e conversa por uma navegação única.
**Arquitetura:** manter Drawer como hospedeiro visual e RoomView existente. Extrair um modelo puro de navegação e adaptar ConsultPanel para montagem embutida; reutilizar CardSection, permissões, histórico de runs e renderizadores existentes, sem novo framework. Pendências semânticas e administração de cronjobs têm planos próprios após descoberta da API.
**Stack:** TypeScript, DOM incremental, CSS, Node, Vitest, navegador automatizado.
**Spec:** docs/superpowers/specs/2026-10-31-painel-trabalho-agendas-design.md (aprovado).

## Restrições globais

- Escritório permanece visível com painel lateral maior.
- Lido não significa resolvido. Pergunta permanece pendente até resposta ou dispensa explícita.
- Começar pela interface; investigar por que faltam aprovações nas execuções do Habblaud depois. Não alterar política de aprovação nesta entrega.
- Não fazer push ou deploy nesta fase de design.
- Credenciais ficam no servidor, nunca no navegador.
- Não migrar cronjobs Hermes para o agendador Habblaud.
- Não modificar instrumentação local preexistente em client/src/ui/drawer.ts sem avaliar sua finalidade.

A segunda restrição será implementada no plano de Pendências, não por mudanças incompletas em RunManager nesta entrega. Não apresentar a Inbox atual como a Pendências definitiva. Não criar botões globais sem comportamento real.

## Divisão do spec em entregas

1. Este plano: descoberta somente leitura + painel funcional de agente.
2. Plano posterior de Pendências: persistência de leitura/resolução, resposta vinculada, pergunta confirmada versus possível, falhas reconhecidas e navegação global.
3. Plano posterior de Agendas: integração HTTP dos jobs Hermes, união por origem, CRUD, fuso/entrega, histórico e resultados conforme fonte validada.
4. Integração global final: Histórico geral, filtros e retorno entre execução/rotina/lista, sem duplicações.

Não marcar o pedido completo como entregue ao concluir apenas a primeira entrega. A descoberta pode identificar extensão de API necessária, a ser aprovada separadamente; não preencher lacunas com arquivos internos do Hermes.

## Fontes consultadas

- client/src/ui/index.ts:62–100,247: montagem UI, seleção e Drawer.
- client/src/ui/context.ts:14–42: TerminalRouter, chatCard e openRun.
- client/src/ui/drawer.ts:420–510: conversas/runs e composição atual; 1050–1121: hospedeiro Drawer.
- client/src/ui/consult.ts:31–140: ConsultPanel, montagem popover, openCard/openRun.
- client/src/ui/viewport.ts:31–75: geometria e computeInsets.
- server/schedule/scheduler.ts:14–23: última tentativa, não histórico completo.
- server/runs/manager.ts:13–38,85–89: identidade de run, pedido/resposta e retenção de 200.
- gateway/platforms/api_server.py:3350–3468 na instalação Hermes: jobs CRUD e include_disabled=true.
- Docs oficiais: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server e https://hermes-agent.nousresearch.com/docs/developer-guide/cron-internals . Docs podem cobrir versão mais nova que a instalada: contrato efetivo deve ser validado.

## Mapa de arquivos

Criar:
- docs/superpowers/verification/2026-10-31-fontes-painel-jobs.md: relatório sanitizado da descoberta, não segredos nem prompts completos.
- client/src/ui/agent-panel-model.ts: navegação e seleção pura de execução.
- client/src/ui/agent-panel-model.test.ts: prioridade, retorno, largura e mudanças de alvo.
- client/src/ui/agent-tabs.ts: DOM de abas e grupos Trabalho/Histórico/Configuração.
- scripts/qa-agent-panel.mjs: QA com Playwright em servidor isolado e fixtures próprias.

Modificar:
- client/src/ui/drawer.ts:420–510 e 1050–1121: composição de grupos, resize e abertura da aba padrão.
- client/src/ui/consult.ts:31–140 e métodos show/hide/render: suporte embutido, mantendo Advisor independente temporariamente.
- client/src/ui/context.ts:35–42: contrato único para navegação de run/ficha.
- client/src/ui/index.ts: montagem de Drawer e roteamento chatCard/openRun; geometria/foco.
- client/src/ui/topbar.ts: encaminhar conversa de ficha/run para painel, preservar Consultor avulso.
- client/src/ui/card.ts: mover editor para Configuração; botões Conversar/Nova conversa abrem Trabalho.
- client/src/ui/styles.css:1989–2037,4034–4186 e 7627 em diante: largura docked, resize, tabs, modo estreito; não deixar floating sobrescrever docked.
- client/src/ui/prefs.ts: persistir largura com validação e clamp.
- client/src/ui/viewport.test.ts e client/src/ui/prefs.test.ts: geometria e persistência.
- shared/locales/en.ts, es.ts, fr.ts: chaves novas; PT é texto fonte.
- README.md, README.pt-BR.md, CHANGELOG.md: documentação da entrega real.

## Foco de revisão

1. Resposta atrasada de A sobrescreve B: tarefa 4 testa geração/abort e alvo.
2. Fechar/alternar painel para execução é confundido com Parar: tarefas 3/4 testam ausência de POST /stop.
3. Resize move câmera no intervalo do duplo clique: tarefa 2 preserva DBLCLICK_GUARD_MS e testa geometria.
4. Ficha dormindo e personagem externo: tarefas 4/5 cobrem ambos; externo não recebe compositor indevido.
5. CSS floating e teclado interrompem painel docked: tarefas 2/6 verificam DOM real e Enter/Tab/Escape.

## Tarefa 0 — validar fontes, sem mutações

Arquivos: criar relatório de verificação indicado no mapa. Nenhum arquivo de código alterado.
Consome: HABBLAUD_HERMES_URL/HABBLAUD_HERMES_KEY existentes no servidor; não imprimir valores.
Produz: tabela de endpoints, campos, capacidades e limitações, com HTTP status e contagens verificadas.

- [ ] Ler as rotas e métodos efetivos de capacidades, jobs, sessões/mensagens e acesso a resultados no código instalado. Verificar documentação sem presumir que há histórico de jobs.
- [ ] Consultar GET /v1/capabilities e GET /api/jobs?include_disabled=true no Hermes configurado. Não chamar create/run/pause/delete. Capturar esquema/tipos, contagem e estados agregados; não imprimir prompt, tokens ou destinos pessoais.
- [ ] Consultar GET /api/access, /api/cards, /api/runs, /api/schedules no Habblaud local. Resumir campos e correlação, incluindo execução antiga sem prompt.
- [ ] Registrar disponibilidade de resultado completo, histórico de jobs, fuso, entrega e vínculos. Quando não houver prova, escrever 'não confirmado', com endpoint verificado; nenhuma afirmação de completude.
- [ ] Revisar que relatório não contém Bearer, chave, hash de senha ou conteúdo privado.
- [ ] Commit somente do relatório: git add docs/superpowers/verification/2026-10-31-fontes-painel-jobs.md; commit 'docs: verificar fontes do painel e cronjobs'.

Essa tarefa informa planos posteriores; indisponibilidade de histórico Hermes não bloqueia a reorganização do painel de agente, mas bloqueia promessa de histórico completo de cronjobs.

## Tarefa 1 — modelo puro de navegação

Create/Test: agent-panel-model.ts e agent-panel-model.test.ts.
Consome: AgentInfo e RunView existentes em shared/types.ts; ler tipos completos antes do teste.
Produz:
- AgentTab = 'work' | 'history' | 'config'.
- PanelTarget = {kind:'agent';agentId:string} | {kind:'run';runId:string;agentId?:string}.
- AgentPanelState = {target:PanelTarget|null;tab:AgentTab;detailsOpen:boolean}.
- openAgentPanel(agentId:string):AgentPanelState (work, detalhes fechados).
- preferredRun(runs:readonly RunView[]):RunView|undefined (aprovação aberta, ativo recente, último recente).
- clampPanelWidth(width:number, viewportWidth:number, sidebarWidth:number):number.

- [ ] Escrever testes openAgentDefaultsToWork, confirmedApprovalBeforeActive, activeBeforeRecent, doesNotInferQuestionFromPunctuation, panelWidthPreservesOffice.
- [ ] Rodar npx vitest run client/src/ui/agent-panel-model.test.ts → FAIL por módulo/exports ausentes.
- [ ] Implementar funções puras. Preferência por aprovação usa informação real do run; não inventar status de pergunta. Largura desktop default 560 px, mínimo 400 quando cabe, máximo min(720, viewportWidth-sidebarWidth-320); abaixo do espaço necessário, priorizar área disponível sem largura negativa.
- [ ] Repetir comando → PASS; npm run -s typecheck → PASS.
- [ ] git add somente os dois arquivos; commit 'feat(ui): modelo de navegação do agente'.

## Tarefa 2 — hospedeiro docked, maior e redimensionável

Modify: drawer.ts:1050–1121, styles.css nos blocos listados, prefs.ts, index.ts, viewport.ts somente se necessário para medição real.
Test: prefs.test.ts, viewport.test.ts, agent-panel-model.test.ts.
Consome: clampPanelWidth da tarefa 1.
Produz: Drawer continua com el/isOpen/render e preserva contrato usado por index.ts; largura em preferência agentPanelWidth?:number.

- [ ] Testar clamp de preferência inválida, largura após resize da viewport e computeInsets com painel de 560 px. Asserções: Number.isFinite(width), width>=0, área do escritório>=320 em viewport 1440 com sidebar medida.
- [ ] Rodar testes específicos → FAIL nas expectativas novas.
- [ ] Implementar borda redimensionável com pointer events e separator acessível (setas alteram 16 px); persistir largura validada. Desktop >900 px docked; <=900 px vista temporária na área disponível, botão voltar/fechar. Não aplicar draggable/floating ao painel único.
- [ ] Manter guarda de duplo clique e ResizeObserver/FreeArea informando largura atual; rodar testes → PASS e typecheck.
- [ ] Commit dos caminhos explicitamente modificados: 'feat(ui): painel lateral maior e redimensionável'.

## Tarefa 3 — conversa embutida, não outro popover

Create: scripts/qa-agent-panel.mjs (harness mínimo com fixture HTTP isolada, ampliado nas tarefas 4–6).
Modify: consult.ts:31–140 e hide/toggle; context.ts:35–42.
Test: agent-panel-model.test.ts para estado e QA para rede/DOM.
Consome: ConsultPanel.openCard/openRun existentes e reducer consult-model.ts.
Produz: ConsultPanel(ctx, options?:{embedded?:boolean}); show/hide preservam ciclo do stream, sem popover em embedded. Métodos públicos openCard/openRun seguem assinaturas atuais. disposeView():void remove assinante/abort local, nunca POST /stop.

- [ ] Adicionar testes de contrato no QA: embeddedHasNoPopover, closeDoesNotStopRun, abortedViewIsNotRunError. Rodar após build atual → FAIL na ausência de modo embutido (fixture HTTP próprio, não Hermes real).
- [ ] Implementar opção embutida e montagem no corpo Trabalho, mantendo renderização markdown, pedido/resposta, erros e ações atuais. Fechar descarta conexão de observação, não cancela run do executor.
- [ ] Rodar consult-model.test.ts, typecheck e build → PASS; QA dos três casos → PASS.
- [ ] Commit 'refactor(ui): conversa de agente embutida no painel'.

## Tarefa 4 — abas e roteamento de agente/run

Create: agent-tabs.ts. Modify: drawer.ts:420–510, index.ts, topbar.ts, context.ts, card.ts.
Consome: AgentPanelState, preferredRun e ConsultPanel embedded.
Produz: AgentTabs com el, setTab(tab:AgentTab):void, mount(tab:AgentTab,node:HTMLElement):void; ctx.chatCard e ctx.openRun continuam compatíveis, mas abrem Drawer/Trabalho em vez de segundo popover.

- [ ] Acrescentar QA sleepingCardOpensWork, chatButtonStaysInDrawer, runFromInboxOpensSameDrawer, staleResponseCannotReplaceSelection. Asserções de ids do alvo e uma única conversa visível.
- [ ] Rodar QA → FAIL nas expectativas de navegação.
- [ ] Montar Trabalho (conversa+agora+pedido real), Histórico (lista de runs existentes), Configuração (CardSection/editor). Para personagem externo, mostrar atividade e acesso somente leitura; não fabricar run ou habilitar chat. Novo alvo abre Trabalho; alternar abas no mesmo alvo preserva rascunho. Ficha sem run abre compositor sem iniciar execução automaticamente.
- [ ] Proteger buscas por geração/alvo e cancelar observação antiga ao mudar de agente. Seleção de run usa dados do run, não último snapshot de outra sessão. Advisor avulso continua como entrada própria nesta primeira entrega; documentar exceção transitória.
- [ ] Rodar QA, testes de modelo, suite completa npx vitest run, typecheck e build → PASS.
- [ ] Commit 'refactor(ui): trabalho histórico e configuração no painel'.

## Tarefa 5 — detalhes técnicos e leitura de resultado

Modify: drawer.ts grupos existentes, agent-tabs.ts, styles.css, shared/locales/en.ts/es.ts/fr.ts.
Consome: grupos de abas e renderizadores de tarefa/subagente/estatística existentes.
Produz: details da execução recolhido por padrão, preservando conteúdo técnico e permissões reais.

- [ ] QA technicalDetailsCollapsed, resultReadableWithoutTerminal, guestReadOnly, oldRunMissingPromptIsExplicit. Asserções: detalhes fechados, resposta completa acessível em Trabalho, textarea ausente/desabilitado para guest, aviso em registro antigo.
- [ ] Rodar QA → FAIL.
- [ ] Mover ferramentas/estatísticas/linha do tempo/subagentes para details; manter aprovação real acessível fora do recolhimento quando pendente. Compositor de mensagem legado não aparece junto do compositor de ficha. Terminal técnico externo pode manter sua infraestrutura interativa por compatibilidade, mas não ser necessário para ler/responder a runs do Hermes; não prometer integração PTY completa nesta entrega.
- [ ] Traduzir cada chave nova nos três dicionários, rodar npm run -s i18n:check (registrar baseline preexistente), testes, typecheck/build e QA → PASS.
- [ ] Commit 'refactor(ui): detalhes técnicos fora da conversa principal'.

## Tarefa 6 — QA integrada em servidor isolado

Create/Modify: scripts/qa-agent-panel.mjs. Test: fixtures próprias no scratch, nunca fichas do usuário.
Consome: build real, API HTTP de teste, fixture Claude com pid vivo; servidor em 4750 só se livre, senão outra porta livre.
Produz: relatório de cenários e evidências de DOM/rede.

- [ ] Rodar QA em 1440x900 e 390x844: abrir, redimensionar, alternar abas, trocar A/B rapidamente, voltar de histórico, foco Tab/Enter/Escape, clicar/duplo clicar personagem, resposta markdown longa, reconexão SSE e guest.
- [ ] Verificar desktop: painel>=400 quando cabe, escritório livre>=320, nenhum popover de conversa de ficha aberto; estreito: botões alcançáveis e sem overflow horizontal do documento.
- [ ] Contar POST /stop: zero ao fechar/trocar, exatamente um só ao clicar Parar na fixture; POST de mensagem com Content-Type JSON. Testar erro de envio visível sem apagar rascunho.
- [ ] Confirmar a renderização com página em foreground/focus e reload; aba hidden não é prova de bug SSE.
- [ ] Rodar suite completa, typecheck, build; limpar servidores/fixtures. Não afirmar teste contra executor real com fixture.
- [ ] Commit 'test(ui): validar painel único e navegação'.

## Tarefa 7 — documentação e revisão da entrega

Modify: README.md, README.pt-BR.md, CHANGELOG.md.

- [ ] Documentar navegação efetivamente entregue, exceções temporárias Advisor/PTy, e que Pendências/Agendas globais ainda estão nas próximas entregas.
- [ ] Registrar commit/testes, limitações da tarefa 0, diff --check e status. Preservar o diff de debug preexistente; staging por arquivo/hunk, nunca git add -A.
- [ ] Commit 'docs: documentar primeira entrega do painel único'.
- [ ] Apresentar resultado local e pedir autorização separada para deploy/push. Não executá-los por terem sido permitidos em tarefa anterior.

## Auto-revisão / cobertura

Painel e largura → 1/2; conversa e ciclo de run → 3/4; configuração/histórico do agente → 4; detalhes → 5; acessibilidade/viewport/concorrência → 6; docs → 7.
Pendências semânticas, CRUD de cronjobs e Histórico geral → próximos planos explicitamente separados, não encerrados aqui. Tarefa 0 verifica contratos necessários sem alterar execução ou política de aprovação.

## Execução proposta

Inline, uma tarefa por vez, verificando antes de seguir. Revisão independente ao concluir a entrega. Alternativa: um subagente por tarefa com revisão a cada passo, mais custo de coordenação.
