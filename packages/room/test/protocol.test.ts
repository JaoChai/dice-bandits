import { describe, expect, it } from 'vitest';
import { parseClientMsg, validName } from '../src/protocol';
import { CODE_ALPHABET, generateCode } from '../src/model';

describe('room protocol', () => {
  it('rejects messages larger than 4 KB', () => {
    expect(parseClientMsg(JSON.stringify({ type: 'join', name: 'x'.repeat(4100) }))).toBeNull();
  });

  it('rejects unknown message types and malformed seats', () => {
    expect(parseClientMsg('{"type":"explode"}')).toBeNull();
    expect(parseClientMsg('{"type":"claim","seat":4}')).toBeNull();
    expect(parseClientMsg('{"type":"claim","seat":-1}')).toBeNull();
  });

  it('validates and trims 1–16 character names', () => {
    expect(validName('  Ada  ')).toBe('Ada');
    expect(validName(' ')).toBeNull();
    expect(validName('x'.repeat(17))).toBeNull();
    expect(parseClientMsg('{"type":"join","name":" "}')).toBeNull();
  });

  it('generates five-character codes only from the documented alphabet', () => {
    const code = generateCode(() => 0.5);
    expect(code).toHaveLength(5);
    expect([...code].every((character) => CODE_ALPHABET.includes(character))).toBe(true);
  });
});
