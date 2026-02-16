import Tesseract from 'tesseract.js';
import { ReceiptData, ReceiptItem } from '@/types';
import { OCRProvider } from './provider';

export class TesseractProvider implements OCRProvider {
  readonly name = 'tesseract';

  async extractReceipt(image: Blob): Promise<ReceiptData> {
    // Convert blob to data URL for Tesseract
    const dataUrl = await this.blobToDataUrl(image);

    // Run OCR
    const result = await Tesseract.recognize(dataUrl, 'eng', {
      logger: (info) => {
        if (info.status === 'recognizing text') {
          console.log(`OCR progress: ${Math.round(info.progress * 100)}%`);
        }
      },
    });

    const text = result.data.text;
    console.log('Raw OCR text:', text);

    // Parse the text to extract receipt data
    return this.parseReceiptText(text);
  }

  private async blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private parseReceiptText(text: string): ReceiptData {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const items: ReceiptItem[] = [];
    let subtotal: number | null = null;
    let total: number | null = null;

    // Common patterns for prices
    const pricePattern = /\$?\s*(\d+[.,]\d{2})\s*$/;
    const subtotalPattern = /sub\s*total|subtotal/i;
    const totalPattern = /^total|grand\s*total|amount\s*due|balance/i;
    const skipPatterns = [
      /^tax/i,
      /^tip/i,
      /^gratuity/i,
      /^discount/i,
      /^payment/i,
      /^change/i,
      /^cash/i,
      /^credit/i,
      /^debit/i,
      /^card/i,
      /^visa/i,
      /^mastercard/i,
      /^amex/i,
      /thank\s*you/i,
    ];

    for (const line of lines) {
      // Skip lines that are clearly not items
      if (skipPatterns.some((pattern) => pattern.test(line))) {
        continue;
      }

      const priceMatch = line.match(pricePattern);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[1].replace(',', '.'));
      if (isNaN(price) || price <= 0) continue;

      // Get the item name (everything before the price)
      const nameEndIndex = line.lastIndexOf(priceMatch[0]);
      let name = line.substring(0, nameEndIndex).trim();

      // Clean up name - remove quantity prefixes like "1x" or "2 "
      name = name.replace(/^\d+\s*[xX]?\s*/, '').trim();

      // Skip if no name
      if (!name) continue;

      // Check if this is subtotal
      if (subtotalPattern.test(name)) {
        subtotal = price;
        continue;
      }

      // Check if this is total
      if (totalPattern.test(name)) {
        total = price;
        continue;
      }

      // Add as item
      items.push({ name, price });
    }

    // If we didn't find a subtotal, calculate it
    if (subtotal === null && items.length > 0) {
      subtotal = items.reduce((sum, item) => sum + item.price, 0);
    }

    return {
      items,
      subtotal,
      total,
      raw: text,
    };
  }
}
