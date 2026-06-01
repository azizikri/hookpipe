import { HttpDestinationAdapter } from './http.js';

export class DestinationRegistry {
  constructor() {
    this._adapters = new Map();
    this.register(new HttpDestinationAdapter());
  }

  register(adapter) {
    this._adapters.set(adapter.type, adapter);
  }

  getAdapter(type) {
    const adapter = this._adapters.get(type);
    if (!adapter) {
      throw new Error(`No destination adapter registered for type: "${type}"`);
    }
    return adapter;
  }

  getTypes() {
    return [...this._adapters.keys()];
  }

  has(type) {
    return this._adapters.has(type);
  }
}

export const registry = new DestinationRegistry();
