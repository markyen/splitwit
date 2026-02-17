import { describe, it, expect } from 'vitest';
import { getParticipantColor, getParticipantColorClasses } from './colors';

describe('colors', () => {
  describe('getParticipantColor', () => {
    it('returns consistent color for same name', () => {
      const color1 = getParticipantColor('Alice');
      const color2 = getParticipantColor('Alice');
      expect(color1).toEqual(color2);
    });

    it('returns consistent color regardless of case', () => {
      const color1 = getParticipantColor('Alice');
      const color2 = getParticipantColor('ALICE');
      const color3 = getParticipantColor('alice');
      expect(color1).toEqual(color2);
      expect(color2).toEqual(color3);
    });

    it('returns consistent color regardless of whitespace', () => {
      const color1 = getParticipantColor('Alice');
      const color2 = getParticipantColor('  Alice  ');
      expect(color1).toEqual(color2);
    });

    it('returns different colors for different names', () => {
      const colorAlice = getParticipantColor('Alice');
      const colorBob = getParticipantColor('Bob');
      expect(colorAlice).toBeDefined();
      expect(colorBob).toBeDefined();
    });

    it('returns valid color object with Tailwind classes', () => {
      const color = getParticipantColor('Test');
      expect(color).toHaveProperty('bg');
      expect(color).toHaveProperty('text');
      expect(color).toHaveProperty('border');
      expect(color.bg).toMatch(/^bg-\w+-\d+$/);
      expect(color.text).toMatch(/^text-\w+-\d+$/);
      expect(color.border).toMatch(/^border-\w+-\d+$/);
    });

    it('handles empty string', () => {
      const color = getParticipantColor('');
      expect(color).toBeDefined();
      expect(color.bg).toBeDefined();
    });

    it('handles special characters', () => {
      const color = getParticipantColor('José María');
      expect(color).toBeDefined();
      expect(color.bg).toBeDefined();
    });

    it('handles very long names', () => {
      const longName = 'A'.repeat(1000);
      const color = getParticipantColor(longName);
      expect(color).toBeDefined();
      expect(color.bg).toBeDefined();
    });
  });

  describe('getParticipantColorClasses', () => {
    it('returns a string of Tailwind classes', () => {
      const classes = getParticipantColorClasses('Alice');
      expect(typeof classes).toBe('string');
      expect(classes).toContain('bg-');
      expect(classes).toContain('text-');
      expect(classes).toContain('border-');
    });

    it('returns consistent classes for same name', () => {
      const classes1 = getParticipantColorClasses('Bob');
      const classes2 = getParticipantColorClasses('Bob');
      expect(classes1).toEqual(classes2);
    });

    it('includes all three class types', () => {
      const classes = getParticipantColorClasses('Charlie');
      const parts = classes.split(' ');
      expect(parts).toHaveLength(3);
    });
  });
});
