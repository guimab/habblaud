# Agendas globais (cronjobs Hermes + agendas Habblaud) — Plano

Spec: docs/superpowers/specs/2026-10-31-painel-trabalho-agendas-design.md, seção "Agendas globais e administração".
Fatos de base: docs/superpowers/verification/2026-10-31-fontes-painel-jobs.md.

Objetivo: uma tela "Agendas" no painel lateral lista **todas** as rotinas das duas origens e administra cada uma
na própria origem: criar, editar, pausar/retomar, executar agora e excluir. Nada migra, nada duplica.

## Regras

- Identidade = origem + id nativo (`habblaud:<id>`, `hermes:<id>`). Cada ação vai só ao agendador de origem.
- Hermes: listar sempre com `include_disabled=true`; falha da fonte aparece como erro da origem, nunca lista vazia.
- Editar Hermes envia só os campos alterados da whitelist do PATCH (`name, schedule, prompt, deliver, skills, skill,
  repeat, enabled`). Campos fora dela (fuso, modelo, script, workdir) aparecem só leitura.
- `jobs_admin=false` no capabilities não esconde nada: decide o que a chamada real responde (401/403/404/501 viram
  aviso explícito na rotina).
- "Executar agora" mostra "disparado", não "concluído". Resultado = último conhecido (`latest_execution`,
  `last_status/last_error`); histórico completo de cron Hermes não existe por HTTP e a tela diz isso.
- Job Hermes sem vínculo comprovado aparece "Sem agente vinculado" (nada inferido de nome/prompt).
- Chave do Hermes fica no servidor. Escrita exige feature `agents` (remoto) e JSON/anti-CSRF.
- Criar pede a origem explicitamente: "Habblaud — sessão da ficha" ou "Hermes — job nativo".

## Tarefas

1. **Sonda de escrita isolada no Hermes real** (sem código): criar job de teste pausado, PATCH, pause/resume,
   run, delete; registrar status/campos no relatório de verificação; apagar o job ao fim. Prova o contrato antes
   de codar.
2. **Driver de jobs** (`server/drivers/hermes/jobs.ts` + teste com servidor falso): list/get/create/patch/
   pause/resume/run/delete, timeout, erros tipados, preserva `latest_execution` da lista.
3. **Rotas unificadas** (`server/routines/` + teste): `GET /api/routines` (duas origens, erro por origem),
   ações por `origin/id` delegando a `/api/schedules` local ou ao driver. Sem novo armazenamento.
4. **Modelo puro do cliente** (`client/src/ui/routines-model.ts` + teste): normalização, ordenação, rótulos de
   estado/resultado, diff de PATCH só com campos alterados.
5. **Interface Agendas** no Drawer (acesso global no topo): lista, filtro por origem, detalhe, formulários por
   origem, confirmação de exclusão com nome e origem; gerações contra respostas atrasadas; i18n.
6. **QA com fixture** (sem Hermes real) + suíte/typecheck/build; README/CHANGELOG. Revisão independente,
   commit local. Deploy/push só com autorização.

Fora: histórico completo de cron Hermes (exige extensão de API, decisão separada), Pendências, aprovações.
