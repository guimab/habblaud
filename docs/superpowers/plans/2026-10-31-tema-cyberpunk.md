# Entrega: tema do escritório "Cyberpunk" (6ª entrega)

## Objetivo

Um tema a mais no seletor **Configurações › Aparência › Tema do escritório** (`Automático`, `Nenhum`,
`Natal`, `Halloween`), usando o **mesmo pipeline** dos sazonais: escolha manual, aplicada pelo renderer
(`SeasonalTheme`), sem tocar no calendário do `Automático`.

Visual = vocabulário genérico do escritório em versão neon: paleta escura (parede/piso/tapete), trilho de
neon no alto das paredes no lugar da guirlanda, brilho neon nas luminárias, janelas com chuva e reflexo de
letreiro, painel holográfico no elevador e dois props novos (holograma e terminal) nos lugares das plantas.
Nada de cenário sob medida: as mesmas salas, móveis e personagens.

## Fora do escopo (entrega separada, se o usuário quiser)

Levar o tema ao **prédio no World** (o que os outros visitantes veem): exige `shared/world/protocol.ts`,
`shared/world/schema.json`, a validação em `server/world/http.ts` + `server/world/theme.ts`, a fachada
(`client/src/world/city/facade.ts`) e `net/world.ts`/`world-model.ts`. Tokens e i18n mudam junto.

## Tarefas

1. **Plumbing + paleta base (parede, piso, tapete)**
   - `client/src/world/api.ts`: `'cyberpunk'` em `SeasonalTheme`/`OfficeTheme`; `seasonalThemeFor` segue
     igual (o novo tema não entra no automático).
   - `client/src/ui/prefs.ts` (sanitize do `theme`) e `client/src/ui/settings.ts` (opção no `segmented`
     + dica), com as traduções em `shared/locales/{en,es,fr,all}.ts`.
   - `client/src/world/render/seasonal.ts`: em `seasonalWallStyle` parede escura com trim neon;
     `seasonalRugColor` + `decorateSeasonalRug` (tapete escuro com faixas de neon).
   - Testes: `seasonalThemeFor`/escolha fixa (`client/src/world/theme.test.ts`) e paleta pura do tema novo.

2. **Luz e janela**
   - `drawSeasonalLights` (halo magenta/ciano), `drawSeasonalWindow` (chuva + letreiro refletido) e
     `decorateElevator` (painel holográfico) no mesmo arquivo.
   - Teste puro das cores/opacidade que o tema novo devolve.

3. **Props novos**
   - `client/src/art/seasonal.ts`: `SeasonalProp` ganha `holo` e `terminal` (pixel art na mesma escala);
     `client/src/world/render/seasonal.ts` (`seasonalFurniture`) reusa os footprints de `plant_tall` /
     `plant_small` — nenhuma colisão ou caminho novo.

4. **Personagem (opcional, só se a tarefa 3 ficar barata)**
   - `seasonalCostume` com um acessório neon (viseira) em `client/src/art/character/render.ts`.

5. **Verificação real e commit**
   - Suíte inteira (`npx vitest run`), `npm run -s typecheck`, `npm run -s build`.
   - Servidor dev na **4750** (pasta de dados própria), `theme: 'cyberpunk'` nas prefs via CDP, captura de
     tela conferida (visual) e confirmação de que `Automático`/`Nenhum` seguem iguais.
   - Commit por tarefa, no padrão do repo (`git -c user.name=guimab -c user.email=guimab@users.noreply.github.com`).
   - Deploy no container só depois do "go" do usuário (`docker tag habblaud:local habblaud:pre-tema`,
     build + `up -d --force-recreate`, `healthy`, 4747/4748 como estão).

## Pendências conhecidas

- O tema do prédio no World fica como entrega própria (item acima).
- Com o ciclo dia/noite em `Automático`, o tema fica mais escuro que o normal de dia; a dica do seletor
  avisa que "Sempre noite" combina mais (sem forçar a preferência do usuário).
