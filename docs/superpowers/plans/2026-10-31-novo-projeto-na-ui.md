# Entrega: criar projeto pela interface (7ª entrega)

## Objetivo

Um botão **"Novo projeto"** na barra lateral (seção Escritório) que abre um formulário inline com **nome do projeto** e
**pasta** (opcional) e cria tudo pela UI, sem `curl`:

1. `POST /api/projects {name, paths}` — o projeto (pasta absoluta, validada antes no cliente);
2. `POST /api/cards {name, projectId}` — a **primeira ficha**, com o mesmo nome do projeto, porque é ela que faz a sala
   existir no escritório: sala sem agente/ficha é removida (`dropEmptyRooms`), então um projeto vazio não apareceria.

Depois o usuário abre a personagem recém-criada (a UI já seleciona) e usa **Conversar** — o primeiro turno cria a sessão
do Hermes com a identidade e o contexto do projeto (o `CardService` já manda `Projeto: <nome> (pastas: …)` ao agente).

## Por que não nos botões que já existem

- "+ Novo agente" (na ficha da sala) não aparece no container: depende de `HABBLAUD_PTY=1` e o Docker desliga o pty.
- "Transformar em projeto" (ficha da sala) exige uma sala que já exista — que só existe com agente/ficha nela.
- A barra lateral está sempre visível, então é o lugar certo para começar do zero.

## Escopo

Dentro: formulário na barra lateral, validação no cliente, criação do projeto + primeira ficha, mensagens de erro,
traduções (en/es/fr), seleção do agente novo.

Fora: criar a pasta no host (o container só monta a conta do adaptador, somente leitura — quem cria a pasta é o agente,
quando pedido); transformar projeto em sala vazia no escritório (mexe em slots/alocação de salas, entrega própria).

## Tarefas

1. **Modelo puro** (`client/src/ui/newproject-model.ts` + teste): valida nome (1..`PROJECT_NAME_MAX`, espaços
   colapsados) e pasta (vazia = projeto só de conversa; senão caminho absoluto, como o servidor exige), e monta os
   corpos das duas chamadas (`projectBody`, `firstCardBody`). Textos de erro via `tr()`.
2. **UI**: botão "+" (`iconButton`) no cabeçalho da barra lateral ao lado da busca, alternando um formulário inline
   (nome, pasta, "Criar", "Agora não") no estilo de `ProjectSection`/`NewCardRow`; visível só com
   `access().projects && access().agents`; ao criar, seleciona `card:<id>` (mesma tentativa+retry do `NewCardRow`) e
   mostra o resultado/erro na própria linha. Erro de uma chamada depois da outra (card falhou) precisa dizer que o
   projeto foi criado e que a ficha não — sem deixar o usuário achando que nada aconteceu.
3. **Traduções** em `shared/locales/{en,es,fr}.ts` e `npm run -s i18n:check` sem sobras novas.
4. **Verificação real** no servidor de teste da 4750 (pasta de dados própria, modo demonstração), clicando de verdade
   pelo `browser_exec`: criar um projeto com pasta, conferir `GET /api/projects`, a sala nova no `GET /api/snapshot` e
   a ficha dormindo; testar o caso de erro (nome repetido/pasta inválida) e o "Agora não"; apagar o projeto de teste no
   fim (`DELETE /api/projects/:id`) e arquivar fichas/sessões de teste. Suíte inteira + `typecheck` + `build`.
5. **Deploy** (tag de volta + build + `--force-recreate`) só depois do "go" do usuário.

## Pendências conhecidas

- Projeto sem nenhuma ficha continua invisível no escritório (por desenho: sala = quem está nela). Se o usuário quiser
  ver projetos vazios, é entrega à parte (alocação de sala/slot).
- Criar a pasta no host não é possível pelo container; a UI só registra o caminho.
