// Leitor de Server-Sent Events: transforma o corpo de uma resposta em frames {event, data}.

export interface SseFrame {
  event?: string;
  data: string;
}

function frameOf(block: string): SseFrame | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  return event === undefined ? { data: data.join('\n') } : { event, data: data.join('\n') };
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseFrame> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const f = frameOf(buf.slice(0, cut));
        buf = buf.slice(cut + 2);
        if (f) yield f;
      }
    }
    buf += decoder.decode().replace(/\r\n?/g, '\n');
    const f = frameOf(buf);
    if (f) yield f;
  } finally {
    reader.releaseLock();
  }
}
