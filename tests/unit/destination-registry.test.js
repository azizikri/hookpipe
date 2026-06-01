import { describe, it, expect } from 'vitest';
import { DestinationRegistry, registry } from '../../src/destinations/index.js';
import { HttpDestinationAdapter } from '../../src/destinations/http.js';

describe('DestinationRegistry', () => {
  it('getAdapter("http") returns HttpDestinationAdapter instance', () => {
    const reg = new DestinationRegistry();
    expect(reg.getAdapter('http')).toBeInstanceOf(HttpDestinationAdapter);
  });

  it('getAdapter("http").type === "http"', () => {
    const reg = new DestinationRegistry();
    expect(reg.getAdapter('http').type).toBe('http');
  });

  it('getAdapter("unknown") throws Error with descriptive message', () => {
    const reg = new DestinationRegistry();
    expect(() => reg.getAdapter('unknown')).toThrow(/unknown/i);
  });

  it('getTypes() includes "http"', () => {
    const reg = new DestinationRegistry();
    expect(reg.getTypes()).toContain('http');
  });

  it('has("http") returns true', () => {
    const reg = new DestinationRegistry();
    expect(reg.has('http')).toBe(true);
  });

  it('has("unknown") returns false', () => {
    const reg = new DestinationRegistry();
    expect(reg.has('unknown')).toBe(false);
  });

  it('custom adapter can be registered and retrieved', () => {
    const reg = new DestinationRegistry();
    const custom = { type: 'slack', send: () => {} };
    reg.register(custom);
    expect(reg.getAdapter('slack')).toBe(custom);
    expect(reg.has('slack')).toBe(true);
    expect(reg.getTypes()).toContain('slack');
  });

  it('exports a default singleton instance', () => {
    expect(registry).toBeInstanceOf(DestinationRegistry);
    expect(registry.has('http')).toBe(true);
  });
});
