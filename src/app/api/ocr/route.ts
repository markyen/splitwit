import { NextRequest, NextResponse } from 'next/server';
import { AzureKeyCredential, DocumentAnalysisClient, DocumentArrayField, DocumentCurrencyField, DocumentObjectField } from '@azure/ai-form-recognizer';
import { ReceiptData, ReceiptItem } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const endpoint = process.env.AZURE_DOC_INTEL_ENDPOINT;
    const key = process.env.AZURE_DOC_INTEL_KEY;

    if (!endpoint || !key) {
      return NextResponse.json(
        { error: 'Azure Document Intelligence not configured' },
        { status: 503 }
      );
    }

    // Get the image from the request
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;

    if (!imageFile) {
      return NextResponse.json(
        { error: 'No image provided' },
        { status: 400 }
      );
    }

    const arrayBuffer = await imageFile.arrayBuffer();

    // Call Azure Document Intelligence
    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
    const poller = await client.beginAnalyzeDocument('prebuilt-receipt', arrayBuffer);
    const result = await poller.pollUntilDone();

    if (!result.documents || result.documents.length === 0) {
      return NextResponse.json(
        { error: 'No receipt data found in image' },
        { status: 422 }
      );
    }

    const receipt = result.documents[0];
    const fields = receipt.fields;

    const items: ReceiptItem[] = [];
    let subtotal: number | null = null;
    let total: number | null = null;

    // Extract line items
    const itemsField = fields?.['Items'] || fields?.['LineItems'];
    if (itemsField && itemsField.kind === 'array') {
      const itemsArray = itemsField as DocumentArrayField;
      for (const item of itemsArray.values || []) {
        if (item.kind === 'object') {
          const itemObj = item as DocumentObjectField;
          const descriptionField = itemObj.properties?.['Description'];
          const totalPriceField = itemObj.properties?.['TotalPrice'] || itemObj.properties?.['Price'];

          const description = descriptionField?.kind === 'string'
            ? descriptionField.value
            : undefined;

          let totalPrice: number | undefined;
          if (totalPriceField?.kind === 'currency') {
            const currencyField = totalPriceField as DocumentCurrencyField;
            totalPrice = currencyField.value?.amount;
          } else if (totalPriceField?.kind === 'number') {
            totalPrice = (totalPriceField as { value?: number }).value;
          }

          if (description && totalPrice !== undefined) {
            items.push({
              name: description,
              price: totalPrice,
            });
          }
        }
      }
    }

    // Extract subtotal
    const subtotalField = fields?.['Subtotal'];
    if (subtotalField?.kind === 'currency') {
      const currencyField = subtotalField as DocumentCurrencyField;
      subtotal = currencyField.value?.amount ?? null;
    }

    // Extract total
    const totalField = fields?.['Total'];
    if (totalField?.kind === 'currency') {
      const currencyField = totalField as DocumentCurrencyField;
      total = currencyField.value?.amount ?? null;
    }

    // If no subtotal found, calculate from items
    if (subtotal === null && items.length > 0) {
      subtotal = items.reduce((sum, item) => sum + item.price, 0);
    }

    const receiptData: ReceiptData = {
      items,
      subtotal,
      total,
      raw: result.content || '',
    };

    return NextResponse.json(receiptData);
  } catch (error) {
    console.error('[API /ocr] Error:', error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    // Check for quota/rate limit errors
    if (message.includes('429') || message.includes('quota') || message.includes('rate limit')) {
      return NextResponse.json(
        { error: 'Azure quota exceeded', fallback: true },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: message, fallback: true },
      { status: 500 }
    );
  }
}
