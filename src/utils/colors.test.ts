import { describe, it, expect } from 'vitest';
import {
  getParticipantActiveChipClasses,
  getParticipantActiveChipClassesForParticipant,
  getParticipantChipClasses,
  getParticipantChipClassesForParticipant,
  getParticipantColor,
  getParticipantColorIndex,
} from './colors';

const participants = [
  { id: '3', name: 'Charlie', order: 2 },
  { id: '1', name: 'Alice', order: 0 },
  { id: '2', name: 'Bob', order: 1 },
];

describe('colors', () => {
  describe('getParticipantColor', () => {
    it('returns consistent color for same order', () => {
      const color1 = getParticipantColor(3);
      const color2 = getParticipantColor(3);
      expect(color1).toEqual(color2);
    });

    it('returns distinct colors for early participant orders', () => {
      const colors = Array.from({ length: 10 }, (_, index) => getParticipantColor(index).bg);
      expect(new Set(colors).size).toBe(colors.length);
    });

    it('keeps string fallback behavior for non-participant usage', () => {
      const color1 = getParticipantColor('Alice');
      const color2 = getParticipantColor('ALICE');
      const color3 = getParticipantColor('alice');
      expect(color1).toEqual(color2);
      expect(color2).toEqual(color3);
    });

    it('keeps string fallback behavior regardless of whitespace', () => {
      const color1 = getParticipantColor('Alice');
      const color2 = getParticipantColor('  Alice  ');
      expect(color1).toEqual(color2);
    });

    it('wraps around once the palette is exhausted', () => {
      expect(getParticipantColor(0)).toEqual(getParticipantColor(14));
    });

    it('returns valid color object with Tailwind classes', () => {
      const color = getParticipantColor('Test');
      expect(color).toHaveProperty('bg');
      expect(color).toHaveProperty('text');
      expect(color).toHaveProperty('border');
      expect(color).toHaveProperty('activeBg');
      expect(color).toHaveProperty('activeText');
      expect(color).toHaveProperty('activeBorder');
      expect(color.bg).toMatch(/^bg-\w+-\d+$/);
      expect(color.text).toMatch(/^text-\w+-\d+$/);
      expect(color.border).toMatch(/^border-\w+-\d+$/);
      expect(color.activeBg).toMatch(/^bg-\w+-\d+$/);
      expect(color.activeText).toMatch(/^text-\w+$/);
      expect(color.activeBorder).toMatch(/^border-\w+-\d+$/);
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

  describe('getParticipantColorIndex', () => {
    it('assigns colors by alphabetical participant order', () => {
      expect(getParticipantColorIndex(participants[1], participants)).toBe(0);
      expect(getParticipantColorIndex(participants[2], participants)).toBe(1);
      expect(getParticipantColorIndex(participants[0], participants)).toBe(2);
    });

    it('is stable across participant reordering', () => {
      const reordered = [participants[2], participants[0], participants[1]];
      expect(getParticipantColorIndex(participants[1], participants)).toBe(
        getParticipantColorIndex(participants[1], reordered)
      );
    });

    it('uses id as a tie-breaker for duplicate names', () => {
      const duplicates = [
        { id: 'b', name: 'Sam', order: 1 },
        { id: 'a', name: 'Sam', order: 0 },
      ];

      expect(getParticipantColorIndex(duplicates[1], duplicates)).toBe(0);
      expect(getParticipantColorIndex(duplicates[0], duplicates)).toBe(1);
    });
  });

  describe('getParticipantChipClasses', () => {
    it('returns a string of Tailwind classes', () => {
      const classes = getParticipantChipClasses(0);
      expect(typeof classes).toBe('string');
      expect(classes).toContain('bg-');
      expect(classes).toContain('text-');
      expect(classes).toContain('border-');
    });

    it('returns consistent classes for same name', () => {
      const classes1 = getParticipantChipClasses(1);
      const classes2 = getParticipantChipClasses(1);
      expect(classes1).toEqual(classes2);
    });

    it('includes all three class types', () => {
      const classes = getParticipantChipClasses(2);
      const parts = classes.split(' ');
      expect(parts).toHaveLength(3);
    });
  });

  describe('participant-aware chip helpers', () => {
    it('returns consistent classes for a participant regardless of list order', () => {
      const reordered = [participants[2], participants[0], participants[1]];

      expect(
        getParticipantChipClassesForParticipant(participants[1], participants)
      ).toEqual(
        getParticipantChipClassesForParticipant(participants[1], reordered)
      );
    });

    it('returns consistent active classes for a participant regardless of list order', () => {
      const reordered = [participants[2], participants[0], participants[1]];

      expect(
        getParticipantActiveChipClassesForParticipant(participants[2], participants)
      ).toEqual(
        getParticipantActiveChipClassesForParticipant(participants[2], reordered)
      );
    });
  });

  describe('getParticipantActiveChipClasses', () => {
    it('returns active classes with stronger contrast', () => {
      const classes = getParticipantActiveChipClasses(3);
      expect(typeof classes).toBe('string');
      expect(classes).toContain('bg-');
      expect(classes).toContain('text-');
      expect(classes).toContain('border-');
    });

    it('returns consistent active classes for same name', () => {
      const classes1 = getParticipantActiveChipClasses(4);
      const classes2 = getParticipantActiveChipClasses(4);
      expect(classes1).toEqual(classes2);
    });
  });
});
