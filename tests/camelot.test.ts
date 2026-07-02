import { describe, expect, it } from 'vitest';
import { toCamelot } from '@core/camelot';

describe('toCamelot', () => {
  it('converte notazione classica minore', () => {
    expect(toCamelot('Am')).toBe('8A');
    expect(toCamelot('C#m')).toBe('12A');
    expect(toCamelot('F# minor')).toBe('11A');
    expect(toCamelot('Dbm')).toBe('12A');
  });

  it('converte notazione classica maggiore', () => {
    expect(toCamelot('C')).toBe('8B');
    expect(toCamelot('F# major')).toBe('2B');
    expect(toCamelot('Gb')).toBe('2B');
    expect(toCamelot('B')).toBe('1B');
  });

  it('accetta Camelot già pronta e Open Key', () => {
    expect(toCamelot('8A')).toBe('8A');
    expect(toCamelot('12b')).toBe('12B');
    expect(toCamelot('1d')).toBe('8B'); // Open Key 1d = C maggiore = 8B
    expect(toCamelot('1m')).toBe('8A');
  });

  it('gestisce alterazioni unicode', () => {
    expect(toCamelot('F♯m')).toBe('11A');
    expect(toCamelot('B♭')).toBe('6B');
  });

  it('ritorna null su input non valido', () => {
    expect(toCamelot(null)).toBeNull();
    expect(toCamelot('')).toBeNull();
    expect(toCamelot('H#m')).toBeNull();
    expect(toCamelot('boh')).toBeNull();
  });
});
