// Synthetic Square receipt pages for tests. They copy the page's structure only: the merchant and
// payment headers, one .modern-line-item table per line, the .modern-totals table and the tender
// section. Every name and value is made up.

const priceCell = (price: string) =>
  `<td align="right" style="vertical-align: top; text-align: right; white-space: nowrap; width: 1%;"><div style="text-align: right;">${price}</div></td>`;

export const lineItem = (name: string, price: string, details = '', extraRows = '') =>
  `<table border="0" cellpadding="0" cellspacing="0" class="modern-line-item" role="presentation" style="width: 100%; padding: 12px 0;" width="100%"><tbody style="width: 100%;"><tr><td style="vertical-align: top; padding-right: 16px;"><div class="modern-item-details"><div class="modern-item-name">${name}</div>${details}</div></td>${priceCell(price)}</tr>${extraRows}</tbody></table>`;

export const modifier = (text: string) => `<div class="modern-item-modifier">${text}</div>`;

export const extraRow = (label: string, price: string) =>
  `<tr><td style="vertical-align: top;"><div class="modern-item-modifier">${label}</div></td>${priceCell(price)}</tr>`;

export const totalsRow = (label: string, amount: string) =>
  `<tr><td style="width: 72%; padding: 4px 0; vertical-align: top;">${label}</td><td align="right" style="width: 28%; padding: 4px 0; text-align: right; white-space: nowrap;">${amount}</td></tr>`;

export const totals = (rows: string) =>
  `<!--Totals Section--><table border="0" cellpadding="0" cellspacing="0" class="modern-totals" role="presentation" style="table-layout: fixed; width: 100%;" width="100%"><tbody style="width: 100%;"><!--Subtotals-->${rows}<!--Change--></tbody></table>`;

const header = (amount: string) =>
  `<div class="preheader" style="display: none">Receipt for ${amount} at Test Bistro on Jan 1 2000 at 12:00 PM.</div>` +
  '<div class="modern-card"><div class="modern-merchant-header"><img width="64" height="64" alt="Merchant logo" src="logo.png" />' +
  '<div class="modern-merchant-name">Test Bistro</div></div></div>' +
  '<main><div class="modern-card"><table border="0" cellpadding="0" cellspacing="0" class="modern-payment-header" role="presentation" width="100%"><tbody><tr>' +
  `<td><div class="modern-payment-amount"><span class="money-currency-symbol">$</span><span class="money-whole">0</span><span class="money-decimal-mark">.</span><span class="money-decimal">01</span></div></td>` +
  '<td align="right" class="modern-payment-meta"><div>#TEST</div><div>Jan 1 2000 at 12:00 PM</div></td></tr></tbody></table><!--Line Items-->';

export const tender = (amount: string) =>
  '<div class="modern-divider"></div><table border="0" cellpadding="0" cellspacing="0" class="modern-tender-section" role="presentation" width="100%"><tbody>' +
  '<tr><td><div class="modern-tender-left"><div class="modern-tender-card">TESTCARD 0000 (Chip)</div></div><div class="color-text-subtle">TEST CARDHOLDER</div></td></tr>' +
  `<tr><td><table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tr><td>Jan 1 2000 at 12:00 PM</td></tr></table>` +
  `<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tr><td>Total</td><td>${amount}</td></tr></table></td></tr></tbody></table>`;

const footer =
  '<div class="modern-divider"></div><div style="text-align: center;"><div class="p receipt-profile-name">Test Bistro</div>' +
  '<div class="p receipt-address"><a href="tel:(000) 000-0000">(000) 000-0000</a></div></div></div></main>' +
  '<div class="modern-footer"><div class="modern-footer-settings">Manage settings</div></div>';

export function squareReceiptPage(body: string, after = tender('$0.01')): string {
  return `<!DOCTYPE html><html lang="en-US"><head><meta charset="utf-8" /><title>Receipt from Test Bistro #TEST</title></head><body>
<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tbody><tr><td align="center">
<table border="0" cellpadding="0" cellspacing="0" class="modern-receipt color-text-standard color-background-subtle" role="presentation" width="100%"><tbody><tr><td>
${header('$0.01')}
${body}
${after}
${footer}
</td></tr></tbody></table>
</td></tr></tbody></table>
</body></html>`;
}
