import {
  AnalyzeExpenseCommand,
  TextractClient,
  type AnalyzeExpenseResponse,
  type ExpenseField,
} from '@aws-sdk/client-textract';
import type { ReceiptData } from '@/types';
import { ServerOCRProvider, UnusableReceiptError } from './provider';

// Amazon Textract AnalyzeExpense, called synchronously with the image bytes. Credentials come from
// the SDK's default chain: on Lambda, the execution role's short-lived credentials that the
// platform puts in the function's environment; nothing long-lived is configured. Locally the chain
// finds whatever the shell provides, so leave OCR_PROVIDER at "none" unless a real scan is wanted.
//
// The response is a tree: ExpenseDocuments[].LineItemGroups[].LineItems[].LineItemExpenseFields,
// each field typed ITEM, PRICE, QUANTITY or EXPENSE_ROW (the whole printed line), and
// ExpenseDocuments[].SummaryFields typed SUBTOTAL, TOTAL, TAX, GRATUITY and others. Prices are
// text as printed. A modifier priced on its own line is its own item, as it is a separate row;
// the client's sum-to-subtotal check catches rows that should have been folded in.

interface Line {
  name: string;
  cents: number;
}

// "$1,234.50", "1234.50", "-$5.00", "5.00-": an optional currency sign, thousands commas, exactly
// two decimals, and a leading or trailing minus for a discount. Anything else is not a price.
const PRICE = /^(-)?\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s*(-)?$/;

export function toCents(text: string | undefined): number | null {
  const match = text ? PRICE.exec(text.trim()) : null;
  if (!match) return null;
  const cents = Number(match[2].replace(/,/g, '')) * 100 + Number(match[3]);
  return match[1] || match[4] ? -cents : cents;
}

// The value text of each field, by its type; the first of a repeated type wins
function byType(fields: ExpenseField[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of fields ?? []) {
    const type = field.Type?.Text;
    const text = field.ValueDetection?.Text?.replace(/\s+/g, ' ').trim();
    if (type && text && !map.has(type)) map.set(type, text);
  }
  return map;
}

// A counted line keeps its count in the name, at its line total ("2 Item C", $18.00), unless the
// printed name already starts with it
function withCount(name: string, quantity: string | undefined): string {
  const count = quantity && /^\d+$/.test(quantity) ? Number(quantity) : 1;
  if (count <= 1 || name.startsWith(`${count} `)) return name;
  return `${count} ${name}`;
}

export function toReceiptData(response: AnalyzeExpenseResponse): ReceiptData {
  const lines: Line[] = [];
  const summary = new Map<string, number>();

  for (const document of response.ExpenseDocuments ?? []) {
    for (const group of document.LineItemGroups ?? []) {
      for (const item of group.LineItems ?? []) {
        const fields = byType(item.LineItemExpenseFields);
        const name = fields.get('ITEM') ?? fields.get('EXPENSE_ROW');
        const cents = toCents(fields.get('PRICE'));
        if (!name || cents === null) continue;
        lines.push({ name: withCount(name, fields.get('QUANTITY')), cents });
      }
    }

    for (const [type, text] of byType(document.SummaryFields)) {
      const cents = toCents(text);
      if (cents !== null && !summary.has(type)) summary.set(type, cents);
    }
  }

  if (lines.length === 0) {
    throw new UnusableReceiptError('No items found in receipt');
  }

  const subtotal = summary.get('SUBTOTAL') ?? lines.reduce((sum, line) => sum + line.cents, 0);
  const total = summary.get('TOTAL');
  const tax = summary.get('TAX');
  const tip = summary.get('GRATUITY');

  return {
    items: lines.map((line) => ({ name: line.name, price: line.cents / 100 })),
    subtotal: subtotal / 100,
    total: total === undefined ? null : total / 100,
    ...(tax === undefined ? {} : { tax: tax / 100 }),
    ...(tip === undefined ? {} : { tip: tip / 100 }),
  };
}

let client: { region: string; textract: TextractClient } | null = null;

// One client per function instance and region: the SDK caches the credentials in it
function getClient(): TextractClient {
  // Not AWS_REGION: on Lambda that name belongs to the platform and follows the function's region
  const region = process.env.TEXTRACT_REGION || 'us-east-1';
  if (client?.region !== region) {
    client = { region, textract: new TextractClient({ region }) };
  }
  return client.textract;
}

export class TextractProvider implements ServerOCRProvider {
  readonly name = 'textract';

  async analyze(bytes: Uint8Array): Promise<ReceiptData> {
    const response = await getClient().send(new AnalyzeExpenseCommand({ Document: { Bytes: bytes } }));
    return toReceiptData(response);
  }
}
