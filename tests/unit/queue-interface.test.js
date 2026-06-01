import { describe, it, expect } from 'vitest';
import { QueueInterface } from '../../src/queue/interface.js';

describe('QueueInterface', () => {
  it('exports QueueInterface class', () => {
    expect(QueueInterface).toBeDefined();
    expect(typeof QueueInterface).toBe('function');
  });

  it('can be instantiated', () => {
    const queue = new QueueInterface();
    expect(queue).toBeInstanceOf(QueueInterface);
  });

  describe('method contracts', () => {
    let queue;

    beforeEach(() => {
      queue = new QueueInterface();
    });

    it('enqueue() throws not implemented', async () => {
      await expect(queue.enqueue({ deliveryId: '1' }))
        .rejects.toThrow('QueueInterface.enqueue() not implemented');
    });

    it('dequeue() throws not implemented', async () => {
      await expect(queue.dequeue())
        .rejects.toThrow('QueueInterface.dequeue() not implemented');
    });

    it('ack() throws not implemented', async () => {
      await expect(queue.ack('job-1'))
        .rejects.toThrow('QueueInterface.ack() not implemented');
    });

    it('nack() throws not implemented', async () => {
      await expect(queue.nack('job-1', new Error('fail'), new Date()))
        .rejects.toThrow('QueueInterface.nack() not implemented');
    });

    it('moveToDeadLetter() throws not implemented', async () => {
      await expect(queue.moveToDeadLetter('job-1', new Error('exhausted')))
        .rejects.toThrow('QueueInterface.moveToDeadLetter() not implemented');
    });

    it('getStats() throws not implemented', async () => {
      await expect(queue.getStats())
        .rejects.toThrow('QueueInterface.getStats() not implemented');
    });
  });
});
