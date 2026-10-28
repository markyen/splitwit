import { describe, it, expect } from 'vitest';
import { buildVenmoLink, formatBreakdown } from './breakdown';

describe('formatBreakdown', () => {
  it('writes an item split n ways as its name, a space, then ÷ and n', () => {
    expect(formatBreakdown([{ name: 'Pizza', share: 10, splitCount: 3 }])).toBe('Pizza ÷3');
  });

  it('leaves an item someone had alone as its name, and joins items with +', () => {
    expect(
      formatBreakdown([
        { name: 'Pizza', share: 10, splitCount: 3 },
        { name: 'Beer', share: 7, splitCount: 1 },
        { name: 'Fries', share: 2.5, splitCount: 2 },
      ])
    ).toBe('Pizza ÷3 + Beer + Fries ÷2');
  });

  it('never writes a slash', () => {
    expect(formatBreakdown([{ name: 'Pizza', share: 10, splitCount: 3 }])).not.toContain('/');
  });
});

describe('buildVenmoLink', () => {
  it('builds the venmo:// charge link, with ÷ percent-encoded in the note', () => {
    const link = buildVenmoLink('charge', 12.5, 'Dinner - Pizza ÷3 + Beer');
    expect(link).toBe(
      'venmo://paycharge?recipients=&txn=charge&amount=12.50&note=Dinner%20-%20Pizza%20%C3%B73%20%2B%20Beer'
    );
  });

  it('round-trips: the note decodes back to the breakdown exactly', () => {
    const note = formatBreakdown([
      { name: 'Pizza', share: 10, splitCount: 3 },
      { name: 'Beer', share: 7, splitCount: 1 },
    ]);
    const link = buildVenmoLink('pay', 17, note);
    const url = new URL(link);
    expect(url.protocol).toBe('venmo:');
    expect(url.searchParams.get('txn')).toBe('pay');
    expect(url.searchParams.get('note')).toBe('Pizza ÷3 + Beer');
  });
});
