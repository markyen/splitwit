import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { TotalEditor } from '@/components/total/TotalEditor';

vi.mock('@/services/expenses', () => ({
  updateExpenseTotal: vi.fn(),
}));

describe('TotalEditor', () => {
  it('selects the full total value when edit mode opens', async () => {
    render(
      <TotalEditor
        code="ABC123"
        total={18.5}
        subtotal={15}
      />
    );

    fireEvent.click(screen.getByText('$18.50'));

    const input = screen.getByDisplayValue('18.50') as HTMLInputElement;

    await waitFor(() => {
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    });
  });
});
