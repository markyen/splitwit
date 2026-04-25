import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { vi } from 'vitest';
import { LineItemList } from './LineItemList';
import { LineItem, Participant } from '@/types';

const updateLineItem = vi.fn();

vi.mock('@/services/expenses', () => ({
  addLineItem: vi.fn(),
  updateLineItem: (...args: unknown[]) => updateLineItem(...args),
  removeLineItemsBatch: vi.fn(),
}));

const participants: Participant[] = [
  { id: 'alice', name: 'Alice', order: 0 },
  { id: 'bob', name: 'Bob', order: 1 },
];

const lineItems: LineItem[] = [
  { id: 'item-1', name: 'Burger', price: 12, order: 0, assignedTo: [] },
];

describe('LineItemList', () => {
  it('toggles assignment when a participant chip is selected and an item is clicked', async () => {
    render(
      <DndContext>
        <LineItemList
          code="ABC123"
          lineItems={lineItems}
          participants={participants}
          selectedParticipantId="alice"
        />
      </DndContext>
    );

    fireEvent.click(screen.getByText('Burger'));

    await waitFor(() => {
      expect(updateLineItem).toHaveBeenCalledWith('ABC123', 'item-1', { assignedTo: ['alice'] });
    });
  });
});
