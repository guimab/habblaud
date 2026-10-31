# Verificação das fontes do painel e dos cronjobs

Data: 2026-10-31, após 20:24 (-03). Tarefa 0 da primeira entrega.
Escopo: leitura do código instalado, documentação oficial e sondas HTTP GET; nenhuma criação, execução, pausa, exclusão, resposta ou mudança de política de aprovação.

## Método e segurança

- Hermes consultado na URL já configurada no .env de habblaud-dev, usando a chave existente apenas em memória. Nenhuma credencial escrita ou exibida.
- Habblaud consultado pela porta local 4747, que atende o container em uso. Servidor 4750 existente não foi reiniciado nem modificado.
- A última rodada fez 13 GETs; todos retornaram HTTP 200 e JSON. Contagens abaixo calculadas dos arrays retornados, não estimadas.
- Identificadores, prompts, respostas, destinos de entrega e nomes pessoais não constam deste relatório. Os caminhos dinâmicos abaixo são moldes de documentação; a sonda usou IDs reais validados, sem normalizá-los.
- Não assinar /api/runs/{id}/events nesta tarefa: acompanhar até done pode marcar seen e alterar a Inbox. Essa rota foi inspecionada no código, não exercitada.

## Endpoints efetivamente consultados

| Origem | GET | HTTP | Resultado observado |
| --- | --- | --- | --- |
| Hermes | /v1/capabilities | 200 | Runs, SSE, aprovações, steering, stop e recursos de sessão declarados disponíveis; jobs_admin=false |
| Hermes | /api/jobs?include_disabled=true | 200 | 1 job; enabled=true, state=scheduled, last_status=ok |
| Hermes | /api/jobs/{job_id} | 200 | Detalhe do mesmo job; não inclui latest_execution, diferentemente da listagem |
| Hermes | /api/sessions?limit=5 | 200 | Amostra de 5 sessões; não é o total de sessões |
| Hermes | /api/sessions/{owned_session_id} | 200 | Sessão vinculada a um run conhecido do Habblaud |
| Hermes | /api/sessions/{owned_session_id}/messages?limit=5 | 200 | Amostra de 5 mensagens: user=1, assistant=2, tool=2; sem has_more nesse retorno, portanto não prova completude |
| Hermes | /v1/runs/{known_habblaud_run_id} | 200 | Amostra completed, output não vazio, execution_generation presente |
| Habblaud local | /api/health | 200 | JSON de saúde, contas e fonte do escritório |
| Habblaud local | /api/access | 200 | local=true; agents/projects/messages/permissions/terminal/spawn=true; world=false |
| Habblaud local | /api/cards | 200 | 5 fichas, com driver e sessions |
| Habblaud local | /api/runs | 200 | 22 runs: 21 done e 1 interrupted |
| Habblaud local | /api/schedules | 200 | 0 agendas; timeZone=America/Sao_Paulo |
| Habblaud local | /api/inbox | 200 | 0 itens no momento da sonda |

Acesso remoto/guest não foi exercitado. A autorização local não prova permissão na porta remota.

## Contrato dos jobs Hermes

Campos observados: id/name/prompt; schedule (kind/display/minutes na amostra); schedule_display; created_at/next_run_at/last_run_at; enabled/state; repeat.times/completed; deliver; skills/skill; script; model/provider; origin; workdir; attach_to_session/context_from; last_status/last_error/last_delivery_error; last_dispatch; canonical_completions; latest_execution na listagem.

- latest_execution tem ID, job_id, status, instantes claimed/started/finished, source e delivery_outcome; isso permite mostrar a última execução conhecida, não uma lista completa de execuções.
- canonical_completions contém 1 referência nesta amostra. Não é transcript nem histórico completo por si só.
- Job observado sem timezone explícito, sem origin preenchido e sem output/last_output/output_file. Não há vínculo comprovado com uma das fichas Habblaud. Exibir 'Sem agente vinculado', não atribuir por semelhança de nome/prompt.
- A lista agrega latest_execution; GET individual apenas normaliza o registro. Não apagar esse metadado ao mesclar detalhe com lista.

### Divergência da declaração de capacidades

/v1/capabilities declara jobs_admin=false, mas GET /api/jobs e GET individual funcionam. O código instalado confirma que jobs_admin é false na tabela estática (gateway/platforms/api_server.py:55), enquanto as rotas são registradas em :1594–1601.

Consequência: false não basta para ocultar a leitura que já funcionou. Também não autoriza presumir escrita disponível. Exibir leitura comprovada e validar os controles em ambiente isolado na entrega de Agendas; tratar 401/403/404/501 explicitamente.

### Escrita: código encontrado, efeitos não testados

Rotas instaladas: POST /api/jobs; PATCH/DELETE /api/jobs/{id}; POST /pause, /resume, /run. Não foram chamadas.

- PATCH só encaminha name, schedule, prompt, deliver, skills, skill, repeat, enabled (api_server.py:3294,3415).
- POST exige name/schedule; encaminha prompt, deliver (default local), origin, paused/paused_reason e skills/repeat opcionais (:3361–3395).
- timezone, grace_minutes, model, provider, script, workdir e contexto de sessão NÃO fazem parte dessa whitelist de PATCH. Não oferecer sua edição como suportada por este endpoint.
- Campos não editados devem ser preservados; não simular PUT nem serializar um registro normalizado inteiro para PATCH.
- /run retorna resultado do trigger, não comprova conclusão nem entrega (:3449–3468). Teste posterior precisa distinguir aceitação/disparo/execução/entrega.

### Fuso, resultado e histórico

Instantes retornados são strings, mas não há timezone por job na amostra nem edição desse campo na API instalada. A documentação atual descreve capacidades de cron que podem ser mais novas que esta instalação. O fuso efetivo das expressões Hermes e sua edição continuam não confirmados pela API.

Não foi encontrado endpoint de histórico completo ou de leitura dos arquivos de saída de cron nas rotas instaladas de /api/jobs. O código cron/jobs.py:3384–3395 salva resultados em arquivos com retenção, mas o Habblaud deve continuar usando HTTP — não ler SQLite ou arquivos internos para preencher essa lacuna. Persistência interna não prova exposição HTTP.

Há resultado completo de run disponível na amostra /v1/runs/{id}; isso não comprova acesso a resultados de cronjobs, cujas identidades não foram correlacionadas a esses runs.

## Runs, fichas e histórico do Habblaud

- Dos 22 runs: todos têm owner, owner.sessionId e text não vazio; nenhum tem prompt. O código atual grava prompt nos novos registros (server/runs/manager.ts:27–30,106), mas não reconstrói pedidos antigos. Mostrar 'Pedido não registrado' para eles; não adivinhar pelo transcript.
- 18 owners são kind=card. 15 correspondem a fichas ainda presentes; não assumir que o restante do histórico pertence a uma ficha atual. Abrir o run pelo seu próprio ID, conservando owner e aviso quando a ficha não existir.
- 1 run tem owner.scheduleId; há 0 agendas atuais. Vínculo de execução antiga não prova que a agenda ainda existe.
- Resposta está em text, sessão em owner.sessionId — não em response ou sessionId de topo.
- 4 respostas na listagem começam com marcador de cauda. O handler view limita text aos últimos 2000 caracteres, tanto na lista quanto no GET individual (server/inbox/http.ts:17–20,82,91).
- Para resposta completa, usar o fluxo existente do painel/assinatura com semântica de leitura apropriada; GET de lista/detalhe sozinho não atende 'resposta completa'. Não anunciar resposta completa se só houver cauda. A mudança de leitura/resolução será tratada no plano de Pendências.
- Retenção default local: 200 registros, ativos protegidos do descarte (manager.ts:88,318–324). Não é arquivo de histórico infinito nem inclui automaticamente trabalhos externos ao Habblaud.
- Transcript HTTP da sessão é acessível na amostra. Não há correlação automática validada entre cada turno desse transcript e cada run. Não fundir os dois históricos por ordem temporal apenas.

## Agendas Habblaud

Amostra vazia; esquema de registro verificado somente no código (server/schedule/scheduler.ts:14–24): id/cardId/text/rule/enabled/createdAt/next/last. last contém at/result/runId/error e representa última tentativa, não histórico completo. O histórico de runs pode ser filtrado por owner.scheduleId, respeitando retenção e perda de vínculo.

O endpoint devolve timeZone=America/Sao_Paulo. Isso foi comprovado para Habblaud, não para Hermes. A união deve manter origem e identificador próprios, executando e administrando cada rotina no agendador de origem.

## Aprovações e perguntas

Aprovações são declaradas disponíveis pelo Hermes; a amostra de run tem execution_generation. Isso não explica por que pedidos não aparecem em determinados caminhos. Não forçar uma aprovação nem mudar configuração nesta etapa.

Pergunta no texto não é evento estruturado de bloqueio. A Inbox atual não deve ser vendida como Pendências confiáveis; lido/resolvido e classificação 'Possível pergunta' dependem da próxima entrega.

## Conclusão para os planos

Pode seguir a reorganização do painel de agente. Cuidados obrigatórios: pedidos antigos ausentes, resposta resumida na API de runs, ficha removida, transcript sem correlação comprovada e permissões por superfície.

A entrega de Agendas precisa validar CRUD em job de teste isolado e resolver o descompasso capabilities/rotas. Histórico completo e resultados de cronjobs Hermes não estão comprovados por HTTP; extensão de API, se necessária, é decisão separada. Nenhuma necessidade de alterar a política de aprovação foi demonstrada.

## Referências

- Código instalado: gateway/platforms/api_server.py:55,1594–1601,3290–3468; cron/jobs.py:1921–1969,3357–3395.
- Fork local: server/runs/manager.ts:13–38,88,106,318–324; server/inbox/http.ts:17–20,80–99; server/schedule/scheduler.ts:14–24.
- Docs oficiais consultadas: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server e https://hermes-agent.nousresearch.com/docs/developer-guide/cron-internals .
- Sonda temporária sanitizada: /root/.hermes/cache/scratch/probe-panel-sources.py; agregado: /root/.hermes/cache/scratch/panel-sources-summary.json. Não versionados; nenhum payload privado persistido.
