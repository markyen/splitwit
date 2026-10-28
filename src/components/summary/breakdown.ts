export interface ItemShare {
  name: string;
  share: number;
  splitCount: number;
}

// What each person's share is made of: an item they had alone by its name, an item split n ways
// as "name ÷n". The same text shows under each person and goes in the Venmo charge's note.
export function formatBreakdown(items: ItemShare[]): string {
  return items
    .map((item) => (item.splitCount === 1 ? item.name : `${item.name} ÷${item.splitCount}`))
    .join(' + ');
}

export function buildVenmoLink(mode: 'charge' | 'pay', amount: number, note: string): string {
  const params = [
    'recipients=',
    `txn=${mode}`,
    `amount=${amount.toFixed(2)}`,
    `note=${encodeURIComponent(note)}`,
  ];
  return `venmo://paycharge?${params.join('&')}`;
}
