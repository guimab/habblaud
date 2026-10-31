# Entrega 5: Agendar agentes — Plano

Objetivo: marcar quando uma ficha trabalha sozinha ("todo dia às 9h, revise os PRs", "a cada 2 h, veja o cluster",
"sexta às 18h, faça o resumo da semana"). Na hora marcada, o Habblaud manda a mensagem para a ficha, que roda em
segundo plano. A resposta cai na Inbox como qualquer outra.

Fatos verificados:
- O Hermes tem `/api/jobs` (cron próprio), mas cada execução abre uma sessão nova, e a entrega sai pelos canais do
  Hermes. Sem a memória da ficha e fora da Inbox, e preso a um driver. Por isso não usamos.
- A entrega 4 já roda tudo o que é preciso: `RunManager.start` na sessão da ficha, com retomada e Inbox.

Decisão: agendador no próprio Habblaud, genérico (vale para qualquer driver com `startRun`). Só node:*, sem dependência.

Regras:
- Tipos de agenda (sem expressão cron, para ser fácil de ler e de editar na tela):
  1. uma vez: data e hora;
  2. a cada N minutos ou horas (mínimo 5 min);
  3. em dias da semana escolhidos, num horário (todo dia = os 7).
- Fuso: o do servidor (TZ do container). A tela mostra o fuso usado.
- Cada agenda pertence a uma ficha e tem: texto da mensagem, regra, ligada/pausada, última execução
  (hora, runId, resultado) e próxima execução.
- Na hora, a mensagem vai para a sessão atual da ficha. Se a ficha estiver ocupada (run ativo), a vez é pulada e
  registrada como "pulada: ficha ocupada", sem fila.
- Habblaud desligado na hora: ao voltar, roda uma vez só (não repete todas as vezes perdidas) se o atraso for de
  até 6 h. Mais que isso: registra "perdida" e segue para a próxima.
- "Uma vez" desliga sozinha depois de rodar.
- Apagar a ficha apaga as agendas dela.
- O item da Inbox mostra que veio de agenda ("⏰ nome da ficha").
- Gravação: `<dataDir>/schedules.json` (0600), como runs.json e inbox.json.
- Acesso remoto: exige a feature `agents`.

Tarefas (TDD, um commit cada):

0. Fuso do container: feito. O container tem TZ=America/Sao_Paulo; o `date` (sem tzdata) mostra UTC, mas o Node
   usa o fuso certo (verificado: `new Date().toString()` = GMT-0300, Intl = America/Sao_Paulo).
1. `server/schedule/rules.ts`: `nextRun(rule, after, now)` puro, com testes de virada de dia, semana, horário
   de verão (fuso sem DST também), mínimo do intervalo e "uma vez" no passado.
2. `server/schedule/scheduler.ts`: ScheduleStore (schedules.json) + Scheduler (relógio de 30 s, dispara pelo
   AgentService, pula se ocupado, recuperação ao iniciar, desliga "uma vez", limpa ao apagar ficha). Testes com
   relógio falso e driver falso.
3. `server/schedule/http.ts`: `/api/schedules` (listar, criar, editar, pausar/retomar, apagar, rodar agora) e
   ligação em app.ts/index.ts; Inbox marca origem "agenda". Teste real na 4750 com uma agenda de 1 min (uma vez).
4. Tela: seção "Agendas" na gaveta da ficha (lista com próxima/última execução, criar/editar com os três tipos,
   pausar, apagar, rodar agora); "⏰" nos itens da Inbox. i18n en/es/fr. Teste no navegador.
5. Deploy na 4747 (backup `habblaud:pre-schedules`) e teste real.
