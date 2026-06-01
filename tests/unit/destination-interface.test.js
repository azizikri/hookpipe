import { describe, it, expect } from 'vitest';
import { DestinationAdapter } from '../../src/destinations/interface.js';

describe('DestinationAdapter', () => {
  it('exports the DestinationAdapter class', () => {
    expect(DestinationAdapter).toBeDefined();
    expect(typeof DestinationAdapter).toBe('function');
  });

  it('type getter throws "Not implemented" in base class', () => {
    const adapter = new DestinationAdapter();
    expect(() => adapter.type).toThrow('Not implemented');
  });

  it('send() throws "Not implemented" in base class', async () => {
    const adapter = new DestinationAdapter();
    await expect(
      adapter.send({}, {}, { deliveryId: '1', pipelineId: 'p1', attempt: 1, headers: {} })
    ).rejects.toThrow('Not implemented');
  });

  it('healthCheck() returns { healthy: true } by default', async () => {
    const adapter = new DestinationAdapter();
    const result = await adapter.healthCheck({});
    expect(result).toEqual({ healthy: true });
  });
});
