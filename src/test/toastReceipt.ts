// Synthetic Toast receipt pages for tests. They copy the page's structure only: the header rows,
// two-column item rows, &nbsp;-indented modifiers, the totals block and the payment rows. Every
// name and value is made up.

export const row = (label: string, price = '') =>
  `<tr><td style="">${label}</td><td class="right" align="right" style="text-align:right;">${price}</td></tr>`;

export const spacer = () => row('&nbsp;');

export const modifier = (label: string, price = '') => row(`&nbsp;${label}`, price);

const header = [
  '<tr><td colspan="2" align="center" style="text-align:center;"><img src="logo.png" alt="Test Bistro" title="Test Bistro" style="max-width:100%;"><br><br></td></tr>',
  '<tr><td colspan="2" align="center" style="text-align:center;">Test Bistro<br><br>1 Example Street<br>Testville</td></tr>',
  spacer(),
  row('Check #0000'),
  row('Test Server', '01/01/2000 12:00 PM'),
  spacer(),
].join('\n');

export const payment = (amount: string) =>
  [
    spacer(),
    row('TESTCARD XXXX0000', amount),
    row('Auth Code', '000000'),
    row('Reference', '000000'),
  ].join('\n');

const footer = '<tr><td colspan="2" align="center" style="text-align:center;">Thank you</td></tr>';

export function toastReceiptPage(body: string, payments = payment('$0.01')): string {
  return `<!DOCTYPE html>
<html>
<head><style>.receipt-body td { padding: 2px; }</style></head>
<body>
<div class="receipt">
  <div class="receipt-header"></div>
  <div class="receipt-body">
    <table width="100%" cellspacing="0" cellpadding="0">
${header}
${body}
${payments}
${footer}
    </table>
  </div>
</div>
</body>
</html>`;
}
