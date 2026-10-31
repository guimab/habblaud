import { describe, expect, it } from 'vitest';
import { parseHermesConfig } from '../config';

describe('HABBLAUD_HERMES_*', () => {
  it('sem URL ou sem chave = consultor desligado', () => {
    expect(parseHermesConfig({})).toBeUndefined();
    expect(parseHermesConfig({ HABBLAUD_HERMES_URL: 'http://h:8642' })).toBeUndefined();
    expect(parseHermesConfig({ HABBLAUD_HERMES_KEY: 'k' })).toBeUndefined();
    expect(parseHermesConfig({ HABBLAUD_HERMES_URL: '  ', HABBLAUD_HERMES_KEY: 'k' })).toBeUndefined();
  });

  it('com as duas, preenche e tira a barra final', () => {
    const h = parseHermesConfig({ HABBLAUD_HERMES_URL: ' http://h:8642/ ', HABBLAUD_HERMES_KEY: ' segredo ' });
    expect(h?.baseUrl).toBe('http://h:8642');
    expect(h?.key).toBe('segredo');
  });

  it('URL que não é http(s) é recusada', () => {
    expect(parseHermesConfig({ HABBLAUD_HERMES_URL: 'file:///etc', HABBLAUD_HERMES_KEY: 'k' })).toBeUndefined();
  });

  it('a chave não aparece em JSON nem em String', () => {
    const h = parseHermesConfig({ HABBLAUD_HERMES_URL: 'http://h:8642', HABBLAUD_HERMES_KEY: 'segredo-xyz' });
    expect(JSON.stringify({ h })).not.toContain('segredo-xyz');
    expect(String(h)).not.toContain('segredo-xyz');
  });
});
