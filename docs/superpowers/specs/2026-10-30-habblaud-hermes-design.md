# Habblaud como central de trabalho do Hermes — Design

Status: pronto para aprovação (30/10/2026)

## Intenção

Fazer do Habblaud o lugar onde o usuário faz quase tudo com seus agentes: ver, criar, conversar, aprovar, redirecionar,
agendar. O dashboard do Hermes fica só para configuração (credenciais, perfis), usado raramente.

Por quê: hoje o Habblaud só observa (via adaptador que traduz o `state.db` para o formato do Claude Code); agir exige
trocar de ferramenta. O objetivo é produtividade: menos cliques, teclado primeiro, tudo num lugar.

## Objetivos

1. Integração com o Hermes bem feita e prioritária.
2. Ações no escritório: criar agente/projeto, conversar, responder perguntas, aprovar, redirecionar, parar, agendar.
3. Consultor: conversas rápidas com um especialista, sem ocupar uma sala.
4. Representação visual clara e divisão fácil por projeto.

## Não-objetivos (agora)

- Drivers para outros frameworks (LangChain etc.). O contrato deve permitir, mas nenhum outro driver é feito agora.
- Substituir a configuração do Hermes (credenciais, perfis, provedores).
- Deploy no Kubernetes / CI-CD (tratado à parte).

## Anti-objetivos (falhou mesmo se funcionar)

- Acoplar o Habblaud às tabelas internas do Hermes ou a detalhes que mudam entre versões.
- Botão que aparece e não funciona para aquele agente.
- Expor ações sobre sessões fora do loopback ou da porta remota com login.

## Restrições

- O repo é um clone de `marmottajr/habblaud` (sem permissão de escrita); o trabalho vai para o fork `guimab/habblaud`,
  que diverge do original de vez: sem PRs ao upstream, a estrutura pode mudar livremente (o patch local de cartões de
  uso vira commit normal no fork).
- Container read-only, porta principal só no loopback (regra do próprio Habblaud).
- Hermes roda no mesmo host (pve3); a API (`api_server`) exige chave (`API_SERVER_KEY`).
- Entrega de mensagens pela API só vale para sessões de origem `api_server`/`bot_room` (regra do Hermes).

## Abordagens consideradas

1. Ler o `state.db` direto no Habblaud. Rápido e sem latência, mas prende o projeto ao schema interno do Hermes
   e não permite agir (só ler).
2. Manter o adaptador atual e acrescentar auxiliares. Funciona hoje, mas é uma camada de tradução frágil
   (finge ser o Claude Code) e cada ação nova vira mais um serviço.
3. Driver por contrato, falando com a API HTTP do Hermes. **Escolhida.** O Habblaud conversa com um driver que
   implementa um contrato pequeno; o driver do Hermes usa só a API versionada e lê `/v1/capabilities` para decidir
   os botões. Outro framework entra depois implementando o mesmo contrato.

Leitura do `state.db` fica permitida apenas como complemento opcional e somente leitura, se a API não cobrir algo.

## Contrato do driver (rascunho)

Cada driver declara capacidades e implementa as que tiver:

- observar: listar agentes, eventos ao vivo (status, ferramenta atual, pergunta pendente)
- conversar: mandar mensagem, receber resposta em stream
- criar: novo agente (com projeto/pasta, papel, modelo)
- aprovar, redirecionar (steer), parar
- bifurcar (fork)
- agendar: rotinas (cron)
- modelo: trocar modelo do agente

O escritório só mostra uma ação se o driver a declarar.

## Rotas do Hermes que suportam isso (pelo código; não testadas uma a uma)

`/v1/capabilities`, `/v1/runs` (+ `events`, `approval`, `clarify`, `steer`, `stop`, `resolve-unknown`),
`/api/sessions` (+ `messages`, `chat/stream`, `fork`, `model`), `/api/jobs` (+ `pause`, `resume`, `run`),
`/v1/skills`, `/api/model/options`.

O que o código mostra (revisão do construtor):

- `/v1/capabilities` descreve o servidor inteiro, não cada sessão. A decisão de quais botões mostrar por agente
  cruza capacidades do servidor + origem da sessão + estado da run.
- `/v1/runs` não tem listagem; `events`, `approval`, `clarify`, `steer` e `stop` só valem para runs criadas pela API.
- `/api/sessions` lista sessões de qualquer origem (`list_sessions_rich`, filtro `?source=`), mas sem eventos ao vivo
  para as que não nasceram pela API — só polling de `messages`.

Consequência: agentes criados pelo Habblaud (origem `api_server`) têm todas as ações; sessões de TUI, Telegram e CLI
aparecem no escritório e podem ser lidas, mas sem ações.

## Modelo de dados do Habblaud

Tudo isto é do Habblaud (arquivos JSON no diretório de dados), não do Hermes; o driver só traduz.

- **Projeto**: id, nome, pastas (zero ou mais), contexto fixo, modelo padrão. Vira uma sala. Pasta que não pertence a
  nenhum projeto continua virando sala sozinha (comportamento atual). Ações na sala: "Transformar em projeto",
  "Juntar com…".
- **Agente** (ficha, identidade fixa): nome, papel, projeto, instruções, modelo, ferramentas/conectores, gatilhos
  (manual, rotina, mensagem de canal, alerta), canais de entrada e de aviso, quem pode falar com ele, política de
  aprovação (o que faz sozinho e o que pede), memória/base própria. Pode estar sem sessão ativa.
- **Sessão**: cada execução do agente (rodada de rotina, conversa, tarefa). Vem do driver.
- **Personagem**: aparência do agente (não da sessão); o mesmo boneco sempre.
- **Inbox**: perguntas e aprovações de todos os agentes num lugar.
- Papéis especiais: Consultor = visitante sem ficha, arquiva sozinho; promover = criar ficha num projeto.
  Subagente = temporário, como hoje. Sessão de TUI/Telegram/CLI = convidado só leitura, pode ser "adotada" numa ficha.
- Driver Hermes: instruções → mensagem de sistema; modelo → parâmetro da sessão; rotina → `/api/jobs`;
  canais → gateways do Hermes; ferramentas → toolsets/MCP.

## Vocabulário visual (fixo, igual para todos os projetos)

O Habblaud não ganha cenário sob medida por projeto; cada projeto só preenche dados.

- Estado: trabalhando, esperando você (mão levantada), parado, agendado (relógio com a próxima execução),
  dormindo (sem sessão), com erro.
- Origem do trabalho atual: ícone pequeno (manual, rotina, canal, alerta).
- Com quem fala: balão "conversando com X via Y".
- Ferramenta em uso: "usando X" (já existe).
- Ficha ao clicar: instruções, sessões recentes, custo, erros, ações (conversar, editar, duplicar, chamar para
  trabalhar).
- Depois (fora da 1ª versão): indicadores publicados pelo agente (nome, valor, cor) listados na ficha/sala.

## Casos de validação (só para testar o modelo, sem nada específico no Habblaud)

1. Triagem de service desk: agente com rotina a cada N min, conectores de chamados e Teams, política "atribui
   sozinho, avisa só quando alguém é marcado", caso duvidoso vai à inbox.
2. Base de conhecimento + cluster: dois agentes no mesmo projeto. Bibliotecário (gatilho: mensagem de pessoa
   autorizada; busca e grava na base vetorial). Plantonista k8s (gatilhos: rotina e alerta; leitura livre, conserto só
   em lista permitida, resto pede aprovação na inbox; avisa por canal).

Não verificado: gateway Teams no Hermes; sistema de chamados; base vetorial existente.

## Funcionalidades (ordem de entrega proposta)

1. Driver do Hermes + Consultor (painel lateral, sessão nova, contexto opcional, sem presets; arquiva sozinho).
2. Projetos: `projects.json`, sala = projeto, várias pastas, "Transformar em projeto"/"Juntar com…"; promover
   consulta = criar agente num projeto.
3. Fichas de agente: identidade fixa, personagem ligado à ficha, estados "dormindo"/"agendado", ficha ao clicar,
   adotar sessão convidada.
4. Inbox única: perguntas (`clarify`) e aprovações de todos os agentes, respondidas no lugar.
5. Gatilhos e rotinas na ficha (cron via driver); canais e política de aprovação.
6. Paleta de comandos (Ctrl+K); redirecionar e parar durante a execução.
7. Modelo de time (fichas prontas aplicadas a um projeto); fork para comparar abordagens; indicadores.

## Decidido pelo assistente (revisar)

- Primeira entrega é o driver + consultor, porque exercita o contrato de ponta a ponta e já é útil.
- O adaptador atual continua rodando até o driver novo cobrir a observação; depois é desligado.
- O contrato de driver é novo e fica ao lado do `AgentSource`; a parte de observação do driver do Hermes se registra
  como um `AgentSource` (assim o escritório atual continua igual), e as ações ficam no contrato do driver.
- Sessões sem stream: polling de `/api/sessions` e `messages` a cada 2 s, só das sessões ativas nos últimos 30 min.
- `API_SERVER_KEY` entra como variável de ambiente pelo `.env` do Habblaud (mesmo padrão das outras opções).
- Pasta do agente: a API não aceita diretório de trabalho; a pasta é dita no texto do primeiro turno (como os
  auxiliares atuais já fazem) e fixada no lado do Habblaud.
- Consultor arquiva (não apaga) a sessão após 30 min sem uso; contexto da tela vai como texto no primeiro turno
  (nome do agente, sala, última atividade).
- Acesso remoto já existe (porta 4748 com login, `HABBLAUD_REMOTE_ALLOW`); ações novas entram na mesma regra.
- Itens 2 a 7 ganham plano próprio quando chegar a vez; o modelo de dados acima é a referência.

## Decisões do usuário

- Sessões de TUI/Telegram/CLI só para leitura no escritório: aceito.
- Consultor sem especialistas pré-definidos; contexto personalizável por sessão.
- Fork diverge do original de vez.
- Sala = projeto (várias pastas; agente sem pasta pode entrar num projeto).
- Agente = ficha fixa; sessão = execução; personagem = aparência do agente.
- Visual genérico, sem cenário sob medida por projeto.
