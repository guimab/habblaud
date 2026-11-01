# Painel único de trabalho e agendas — Design

Status: design aprovado pelo usuário; implementação depende da aprovação do plano de execução.

## Intenção

Manter o escritório visível e tornar o acompanhamento do trabalho legível. A gaveta atual mistura identidade, conversa, terminal, tarefas, subagentes, histórico e estatísticas. O usuário quer saber o que cada agente fez, o que está acontecendo e o que espera dele, além de administrar todos os cronjobs do Hermes pelo Habblaud.

## Decisões do usuário

- Escritório permanece visível com painel lateral maior.
- Abordagem 2: painel único por finalidade, em vez de apenas acrescentar abas à gaveta atual ou criar central separada.
- Incluir agendas do Habblaud e todos os cronjobs do Hermes conectado, inclusive criados fora do escritório.
- Administrar rotinas: criar, editar, pausar/retomar, executar agora e excluir.
- Lido não significa resolvido. Pergunta permanece pendente até resposta ou dispensa explícita.
- Começar pela interface; investigar por que faltam aprovações nas execuções do Habblaud depois. Não alterar política de aprovação nesta entrega.

## Objetivos

1. Um lugar por execução para pedido, andamento, resposta e decisões.
2. Configuração da identidade fora do caminho de acompanhar trabalho.
3. Pendências globais distinguindo não lido, pergunta, aprovação e falha.
4. Histórico global e por agente, ligado à execução real.
5. Administração global de rotinas sem duplicar agendadores.
6. Limitações de origem e dados ausentes explícitas, sem inventar atividade, resultado ou associação.

## Não-objetivos

- Redesenhar o escritório em pixel art ou criar cenários específicos para projetos.
- Alterar aprovação automática do Hermes ou fabricar pedidos de permissão.
- Migrar cronjobs Hermes para o agendador Habblaud.
- Alterar outros perfis Hermes, integrar múltiplos servidores automaticamente ou buscar seus arquivos diretamente. 'Todos' significa todos os jobs retornados pelo Hermes configurado, incluindo desabilitados; outros perfis/servidores ficam fora até conexão explícita.
- Prometer histórico ilimitado ou reconstruir execuções antigas sem dados.
- Executar turnos em sessões que a API recusa por origem.

## Anti-objetivos

Falha mesmo se funcionar quando:
- Configuração, terminal e resposta continuam em janelas concorrentes.
- Abrir ou acompanhar resposta ao vivo resolve uma pergunta silenciosamente.
- Status de início de agenda é apresentado como trabalho concluído.
- Uma pergunta é declarada pendente apenas porque o texto termina em '?'.
- Falha na fonte Hermes é apresentada como lista vazia de cronjobs.
- Uma rotina é duplicada, muda de origem ou passa a executar duas vezes.

## Abordagens consideradas

1. Abas na gaveta existente: menor mudança, preserva a duplicação entre canais e modelos.
2. Painel lateral único por finalidade: escolhido; centraliza leitura e ações mantendo o escritório.
3. Administração separada do escritório: comporta listas grandes, mas cria duas superfícies para o mesmo trabalho.

## Navegação proposta pelo assistente

Um painel lateral ampliado e redimensionável no desktop, com limite que preserve parte útil do escritório. Em tela estreita ocupa a área disponível como vista temporária, com voltar/fechar; a proporção exata é decisão de implementação, não do usuário.

- Cabeçalho: nome, projeto, estado operacional, origem e indicação clara de acesso somente leitura quando aplicável.
- Agente: Trabalho (padrão), Histórico, Configuração.
- Acessos globais: Pendências, Agendas, Histórico geral, usando o mesmo painel.
- Abrir item global leva ao detalhe da execução ou rotina dentro do painel. Voltar preserva filtros, seleção e posição da lista.
- Não empilhar modais de conversa, terminal e Inbox. Confirmações pontuais de exclusão são permitidas.
- Fechar painel ou trocar agente não interrompe run. Parar é ação explícita.

### Trabalho

Mostrar pedido que originou a execução, horário/origem, andamento observado e resposta completa. Resposta parcial deve ser distinguida de final. Enquanto executa, permitir ações já suportadas: redirecionar e parar; aprovação aparece apenas com pedido real. Quando ocioso, enviar novo pedido.

Dados técnicos — ferramentas, logs, estatísticas e subagentes — em Detalhes da execução, recolhidos por padrão. Conversa/terminal atual não devem manter compositores concorrentes. Fontes somente leitura usam a mesma estrutura visual, mas sem ações que não conseguem executar.

A ficha é identidade durável; sessão é conversa/execução no driver; run é turno rastreado nessa sessão. Não confluir ids nem afirmar que toda sessão é uma ficha. O estado visual de cochilo não prova ausência de trabalho.

### Histórico

Lista por agente e global: pedido, agente/vínculo conhecido, origem manual/agendada, início, fim quando conhecido, estado e prévia da resposta. Abrir leva ao mesmo detalhe usado em Trabalho. Filtros por agente, projeto, origem e estado; ordenação por recência.

Cobertura deve ser rotulada por origem. Runs Habblaud e transcripts de sessões externas não são automaticamente equivalentes: reconciliar só com identificadores confiáveis. Não duplicar uma execução exibida por run e transcript. Registros antigos sem pedido mantêm aviso de dado ausente.

### Configuração

Nome, papel, projeto, instruções, modelo e aparência da ficha. Sessões associadas/adotar/soltar são administração da identidade. Estatísticas não pertencem aqui. Agendas do agente oferecem ligação para Agendas global com filtro daquele agente, sem manter outro editor independente.

### Pendências

Dimensões independentes:
- Leitura: não lido/lido.
- Execução: em andamento, bloqueada, concluída, falha, interrompida ou desconhecida.
- Demanda humana: pergunta/decisão aberta, aprovação aberta ou nenhuma confirmada.

Pergunta aberta: abrir marca como lida; responder com entrega confirmada ou dispensar explicitamente resolve. Falha no envio mantém a pendência. O registro da resposta e do vínculo à pergunta precisa ser persistente; o próximo turno simplesmente terminar não prova resolução.

Aprovação aberta: só sai após confirmação do executor ou evidência de que o pedido expirou/deixou de estar pendente; não é dispensável como uma resposta comum. Preservar contrato atual sem mexer na política que gera aprovações.

Resposta pronta pode ser marcada como lida sem apagar o histórico. Falha deve oferecer inspecionar e reconhecer; isso não significa que a execução passou a ter sucesso.

Hoje o servidor classifica pergunta por /\?\s*$/ e ignora runs vistos. Essa heurística não atende o requisito. Antes de implementar a parte semântica, verificar se o Hermes fornece demanda humana estruturada. Se não, a proposta é permitir marcar explicitamente 'Precisa de resposta' e tratar inferências como 'Possível pergunta', sem declará-las bloqueio real. Este fallback requer validação do usuário se a investigação confirmar ausência de sinal estruturado.

## Agendas globais e administração

União visual de duas origens, sem migração:
- Habblaud: scheduler local, rotina ligada à ficha e execução por RunManager.
- Hermes: jobs nativos via driver HTTP; origem, entrega e regras continuam no Hermes.

Identidade de rotina: origem + id nativo; nunca usar só o id nem traduzir regra de forma destrutiva. Mostrar agente conhecido ou 'Sem agente vinculado'. Um vínculo de apresentação não altera a memória ou sessão usada pelo cronjob Hermes.

Lista: nome/instrução, origem, agente/projeto quando conhecidos, regra/frequência, fuso, próxima execução, última tentativa e resultado conhecido, ativa/pausada. Resultado 'started' do scheduler Habblaud não é conclusão: buscar desfecho pelo runId. Execução atual desconhecida deve aparecer como desconhecida.

Controles: criar, editar, pausar/retomar, executar agora e excluir. Criação informa executor: 'Habblaud — sessão da ficha' versus 'Hermes — job nativo'. Não escolher origem silenciosamente. Formulários compartilham apresentação, mas preservam campos específicos; Hermes pode ter expressão cron, skills, repetição e entrega que não existem nas regras locais.

Editar usa somente campos aceitos por aquela API, preservando campos não editados. Excluir pede confirmação com nome e origem; não implica cancelar execução já iniciada. Executar agora deve confirmar aceite/início, não anunciar sucesso antes do resultado. Releitura da fonte confirma cada alteração. Botões respeitam capacidades e autorização remota já existentes.

### Fatos verificados no código local

- Habblaud: GET /api/schedules lista todas; filtro ?card= é opcional. Schedule.last guarda a última tentativa e opcional runId; não é histórico completo de todas as tentativas.
- RunManager persiste pedido/resposta e mantém por padrão 200 registros; buffer de eventos não é histórico durável completo de ferramentas. Histórico além disso exige novo armazenamento, não só UI.
- Hermes: API implementa GET/POST /api/jobs; GET/PATCH/DELETE /api/jobs/{id}; POST /pause, /resume e /run.
- Listagem Hermes precisa include_disabled=true; sem isso não cobre todos.
- Criação aceita name, schedule, prompt, deliver, skills, repeat e campos de pausa. Não assumir vínculo com ficha.
- Rotas de histórico de execuções de cronjobs não foram comprovadas nesta leitura.

### Etapa de verificação antes do plano técnico

Consulta somente leitura ao Hermes conectado: capacidades, todos os jobs, campos e estados reais, acesso a resultados/histórico e entrega. Não imprimir segredos. Não criar/executar jobs para essa descoberta.

Se histórico/resultado não tiver API, não ler state.db nem inventar dados. Registrar o limite, verificar alternativa HTTP suportada e decidir uma extensão mínima com o usuário. Para execuções futuras acompanhadas pelo Habblaud, um registro durável pode ser necessário, mas polling sozinho pode perder execuções curtas; especificar a garantia real.

## Restrições técnicas e entrega

Reutilizar TypeScript, Node, canvas/UI atuais e contrato de driver. Sem dependência nova por padrão. Credenciais ficam no servidor, nunca no navegador. Escritas seguem JSON/anti-CSRF e leitura de confirmação. Respeitar portas local/remota e features de acesso; não ampliar privilégios silenciosamente.

Não modificar instrumentação local preexistente em client/src/ui/drawer.ts sem avaliar sua finalidade. Desenvolvimento em /root/habblaud-dev; testes isolados antes de deploy. Não fazer push ou deploy nesta fase de design.

Sequência proposta:
1. Verificação somente leitura de fontes/capacidades e definição de dados faltantes.
2. Painel único e Trabalho/Histórico/Configuração, reutilizando recursos existentes.
3. Pendências com leitura separada de resolução e dados confiáveis.
4. Agendas globais e CRUD de ambas as origens; histórico conforme contrato validado.
5. Testes integrados, atualização dos dois READMEs e deploy somente após autorização.

## Critérios de aceite

- Clicar personagem abre Trabalho e mantém escritório visível no desktop.
- Pedido e resposta são legíveis sem abrir janela concorrente; dados técnicos recolhidos.
- Voltar de execução/rotina preserva contexto da lista.
- Fechar painel não interrompe run; parar é explícito.
- Pergunta lida permanece pendente e sobrevive a recarregamento/reinício; envio recusado não resolve.
- Aprovações exibidas correspondem a pedidos reais; nenhuma política alterada nesta etapa.
- Agendas incluem jobs desabilitados e criados fora do Habblaud no servidor conectado.
- Operações atingem uma única origem, preservam campos e são verificadas por leitura.
- Fonte indisponível, vínculo ausente e histórico incompleto ficam explícitos.
- Sem afirmação de resultado/conclusão baseado apenas em disparo aceito.
- Interface mantém idiomas suportados, acesso por teclado e comportamento em telas estreitas.

## Complementos após revisão do desenho

Decisões propostas pelo assistente (não atribuídas ao usuário):
- Ao abrir ficha com várias sessões: priorizar execução com decisão humana confirmada; depois run ativo mais recente; depois execução mais recente. Mostrar seletor para acessar as demais, sem sugerir que duas execuções são uma. Personagem externo abre sua própria sessão.
- Reconhecer falha retira o aviso de Pendências, mas conserva estado de falha e histórico. Reexecução é ação separada.
- Na ausência de vínculo confiável run/transcript, não fundir nem declarar duas execuções confirmadas: mostrar fontes separadas com aviso de vínculo não confirmado.
- Responder à pergunta inicia um turno na sessão vinculada somente quando permitido. Sessão ocupada ou somente leitura oferece o caminho disponível e mantém a pendência, sem simular entrega. Resposta dada fora do Habblaud só resolve automaticamente se houver evidência confiável correlacionada; caso contrário, permitir resolução explícita.
- Primeira versão do histórico usa registros existentes e declara cobertura/retenção. Não apagar nem encurtar dados atuais. Histórico durável completo de rotinas é objetivo a detalhar após verificar fontes; não prometer completude com os 200 runs atuais.
- Plano técnico deverá definir testes objetivos de painel desktop/tela estreita, navegação de teclado e filtros; verificar CRUD com jobs de teste autorizados e isolados, sem tocar em rotinas do usuário. Descoberta somente leitura não vale como prova de escrita.

Decisão do usuário: na ausência de sinal estruturado, aceita mostrar 'Possível pergunta', claramente diferenciada de pendência confirmada, com opção manual 'Precisa de resposta'. A inferência não deve mudar o estado para bloqueado nem simular pedido de aprovação. O método técnico e seus testes serão definidos no plano; pontuação isolada não é prova de demanda humana.

## Investigação de aprovações, posterior

Relato do usuário: um pedido de aprovação feito nesta conversa apareceu no Habblaud, a primeira ocorrência observada apesar do uso frequente dos agentes diretamente no escritório. Comparar o caminho desta superfície com o de fichas/runs iniciados no Habblaud. Não atribuir causa à configuração, driver ou UI sem rastrear geração, transporte e renderização dos eventos.
