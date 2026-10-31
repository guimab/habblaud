// Pedaços do bundle baixados na primeira abertura (Meu dia, terminal). Depois de atualizar o Habblaud, uma aba aberta
// antes da atualização pede o pedaço antigo, que não existe mais (404): sem aviso, o botão "não fazia nada". Aqui a
// falha vira uma pergunta visível para recarregar a página.
import { tr } from '../../../shared/i18n';

/** A falha é de pedaço que não baixou (atualização ou rede), e não erro do próprio módulo? */
export function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Loading chunk/i.test(msg);
}

/** Avisa e oferece recarregar; devolve true se a página vai recarregar. */
export function offerReload(err: unknown, ask: (text: string) => boolean = (t) => window.confirm(t), reload: () => void = () => location.reload()): boolean {
  if (!isChunkError(err)) return false;
  if (!ask(tr('O Habblaud foi atualizado e esta página ficou desatualizada. Recarregar agora?'))) return false;
  reload();
  return true;
}
