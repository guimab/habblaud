import { describe, expect, it } from 'vitest';
import { parseSse } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

async function all(chunks: string[]) {
  const out: { event?: string; data: string }[] = [];
  for await (const f of parseSse(streamOf(chunks))) out.push(f);
  return out;
}

describe('parseSse', () => {
  it('lê event + data e ignora id', async () => {
    expect(await all(['id: 3\nevent: assistant.delta\ndata: {"delta":"oi"}\n\n'])).toEqual([
      { event: 'assistant.delta', data: '{"delta":"oi"}' },
    ]);
  });

  it('junta frames divididos entre pedaços', async () => {
    expect(await all(['event: a\nda', 'ta: 1\n', '\nevent: b\ndata: 2\n\n'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('aceita CRLF, frame sem event e várias linhas de data', async () => {
    expect(await all(['data: x\r\ndata: y\r\n\r\n'])).toEqual([{ data: 'x\ny' }]);
  });

  it('ignora comentários e frame final sem linha em branco', async () => {
    expect(await all([': ping\n\n', 'data: fim'])).toEqual([{ data: 'fim' }]);
  });
});
