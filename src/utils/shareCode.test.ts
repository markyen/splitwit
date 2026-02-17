import { describe, it, expect } from 'vitest';

// Share code validation logic (mirroring Firestore rules)
const SHARE_CODE_PATTERN = /^[A-Z2-9]{6}$/;

function isValidShareCode(code: string): boolean {
  return SHARE_CODE_PATTERN.test(code);
}

describe('Share Code Validation', () => {
  describe('valid codes', () => {
    it('accepts 6 uppercase letters', () => {
      expect(isValidShareCode('ABCDEF')).toBe(true);
    });

    it('accepts 6 digits (2-9)', () => {
      expect(isValidShareCode('234567')).toBe(true);
    });

    it('accepts mixed letters and digits', () => {
      expect(isValidShareCode('ABC234')).toBe(true);
      expect(isValidShareCode('A2B3C4')).toBe(true);
    });

    it('accepts codes without ambiguous characters', () => {
      // These should be valid (no 0, 1, I, O)
      expect(isValidShareCode('HJKLMN')).toBe(true);
      expect(isValidShareCode('PQRSTU')).toBe(true);
    });
  });

  describe('invalid codes', () => {
    it('rejects lowercase letters', () => {
      expect(isValidShareCode('abcdef')).toBe(false);
      expect(isValidShareCode('AbCdEf')).toBe(false);
    });

    it('rejects codes shorter than 6 characters', () => {
      expect(isValidShareCode('ABC')).toBe(false);
      expect(isValidShareCode('ABCDE')).toBe(false);
    });

    it('rejects codes longer than 6 characters', () => {
      expect(isValidShareCode('ABCDEFG')).toBe(false);
      expect(isValidShareCode('ABCDEFGH')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidShareCode('')).toBe(false);
    });

    it('rejects codes with 0 (zero)', () => {
      expect(isValidShareCode('ABC0DE')).toBe(false);
    });

    it('rejects codes with 1 (one)', () => {
      expect(isValidShareCode('ABC1DE')).toBe(false);
    });

    it('rejects codes with special characters', () => {
      expect(isValidShareCode('ABC-DE')).toBe(false);
      expect(isValidShareCode('ABC_DE')).toBe(false);
      expect(isValidShareCode('ABC DE')).toBe(false);
    });

    it('rejects codes with unicode characters', () => {
      expect(isValidShareCode('ÀBCDÉF')).toBe(false);
    });
  });

  describe('security considerations', () => {
    it('pattern prevents path traversal', () => {
      expect(isValidShareCode('../..')).toBe(false);
      expect(isValidShareCode('../../')).toBe(false);
    });

    it('pattern prevents injection', () => {
      expect(isValidShareCode('<scrip')).toBe(false);
      expect(isValidShareCode("'; --")).toBe(false);
    });
  });
});
