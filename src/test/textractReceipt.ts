// Synthetic Textract AnalyzeExpense responses for tests. They copy the response's shape only:
// typed line-item fields and summary fields, each with the printed text as its value. Every name
// and amount is made up.
import type { AnalyzeExpenseResponse, ExpenseField, LineItemFields } from '@aws-sdk/client-textract';

export const field = (type: string, text: string, confidence = 99): ExpenseField => ({
  Type: { Text: type, Confidence: confidence },
  ValueDetection: { Text: text, Confidence: confidence },
});

// A line item as Textract returns one: the typed parts plus the whole row's text
export const lineItem = (item: string, price: string, extra: Record<string, string> = {}): LineItemFields => ({
  LineItemExpenseFields: [
    field('ITEM', item),
    field('PRICE', price),
    ...Object.entries(extra).map(([type, text]) => field(type, text)),
    field('EXPENSE_ROW', `${extra.QUANTITY ? `${extra.QUANTITY} ` : ''}${item} ${price}`),
  ],
});

// A row Textract could not split into ITEM and PRICE
export const rowOnly = (text: string): LineItemFields => ({
  LineItemExpenseFields: [field('EXPENSE_ROW', text)],
});

export const summary = (fields: Record<string, string>): ExpenseField[] =>
  Object.entries(fields).map(([type, text]) => field(type, text));

export function textractResponse(
  groups: LineItemFields[][],
  summaryFields: ExpenseField[] = summary({ SUBTOTAL: '10.00', TAX: '1.00', GRATUITY: '2.00', TOTAL: '13.00' })
): AnalyzeExpenseResponse {
  return {
    DocumentMetadata: { Pages: 1 },
    ExpenseDocuments: [
      {
        ExpenseIndex: 1,
        SummaryFields: [field('VENDOR_NAME', 'Test Bistro'), ...summaryFields],
        LineItemGroups: groups.map((lines, index) => ({
          LineItemGroupIndex: index + 1,
          LineItems: lines,
        })),
      },
    ],
  };
}
