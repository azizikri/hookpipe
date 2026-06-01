import { describe, it, expect, vi } from 'vitest';
import { renderTemplate, registerHelper } from '../../src/templates/handlebars.js';

describe('renderTemplate', () => {
  it('renders simple interpolation', () => {
    const result = renderTemplate('{{name}}', { name: 'test' });
    expect(result).toBe('test');
  });

  it('renders nested access', () => {
    const result = renderTemplate('{{repo.name}}', { repo: { name: 'hookpipe' } });
    expect(result).toBe('hookpipe');
  });

  it('renders missing variable as empty string', () => {
    const result = renderTemplate('{{missing}}', {});
    expect(result).toBe('');
  });

  it('caches compiled templates', () => {
    const template = 'Hello {{name}}';
    const result1 = renderTemplate(template, { name: 'first' });
    const result2 = renderTemplate(template, { name: 'second' });
    expect(result1).toBe('Hello first');
    expect(result2).toBe('Hello second');
  });
});

describe('built-in helpers', () => {
  it('json helper stringifies payload', () => {
    const data = { payload: { key: 'value' } };
    const result = renderTemplate('{{json payload}}', data);
    expect(result).toBe('{"key":"value"}');
  });

  it('upper helper uppercases string', () => {
    const result = renderTemplate('{{upper str}}', { str: 'hello' });
    expect(result).toBe('HELLO');
  });

  it('lower helper lowercases string', () => {
    const result = renderTemplate('{{lower str}}', { str: 'HELLO' });
    expect(result).toBe('hello');
  });

  it('default helper uses fallback for missing value', () => {
    const result = renderTemplate('{{default missing "fallback"}}', {});
    expect(result).toBe('fallback');
  });

  it('default helper uses value when present', () => {
    const result = renderTemplate('{{default name "fallback"}}', { name: 'actual' });
    expect(result).toBe('actual');
  });
});

describe('registerHelper', () => {
  it('registers and uses a custom helper', () => {
    registerHelper('reverse', (str) => str.split('').reverse().join(''));
    const result = renderTemplate('{{reverse name}}', { name: 'abc' });
    expect(result).toBe('cba');
  });
});
