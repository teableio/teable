import { describe, it, expect } from 'vitest';
import { recordCompressionNegotiation } from './compression-metrics';

describe('recordCompressionNegotiation', () => {
  it('reports a websocket connection whose offer survived the proxy', () => {
    expect(
      recordCompressionNegotiation('websocket', 'permessage-deflate; client_max_window_bits')
    ).toBe('negotiated');
  });

  it('flags a websocket connection whose offer never reached the pod', () => {
    // Every current browser offers permessage-deflate, so its absence on a
    // websocket upgrade means something in front of us removed the header.
    expect(recordCompressionNegotiation('websocket', undefined)).toBe('offer_missing');
    expect(recordCompressionNegotiation('websocket', 'x-webkit-deflate-frame')).toBe(
      'offer_missing'
    );
  });

  it('does not count the xhr-streaming fallback as a stripped offer', () => {
    expect(recordCompressionNegotiation('xhr-streaming', undefined)).toBe('not_applicable');
  });
});
