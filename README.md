# Splitwit

A mobile-friendly web app for splitting bills with friends. Scan a receipt or manually enter items, assign them to participants, and see exactly what everyone owes.

## Features

- **Receipt Scanning** - Take a photo of your receipt, or paste a Toast receipt link, and automatically extract line items using OCR (Amazon Textract with Tesseract.js fallback)
- **Drag & Drop Assignment** - Drag participants onto items to assign who's paying for what
- **Shareable Sessions** - Share a 6-character code with friends so everyone can view and edit the expense in real-time
- **Smart Totals** - Add tip, tax, and adjustments on top of the subtotal with quick percentage buttons
- **Per-Person Summary** - See exactly what each person owes once all items are assigned
- **No Account Required** - Just create an expense and start splitting

## How It Works

1. **Create or Join** - Create a new expense or enter a share code to join an existing one
2. **Add Participants** - Add the names of everyone splitting the bill (first person is marked as the payer)
3. **Add Items** - Scan a receipt or manually add line items with prices
4. **Assign Items** - Select a participant chip, then tap items to toggle assignments. Use "Everyone" to split an item evenly among all participants
5. **Set the Total** - Enter the final amount charged (including tip, tax, and any adjustments)
6. **View Summary** - Once all items are assigned, see what each person owes the payer

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project (for Firestore database)
- Optional: an AWS account for cloud OCR (see [Receipt OCR](#receipt-ocr))

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/splitwit.git
cd splitwit

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local
```

### Configuration

Edit `.env.local` with your credentials:

```bash
# Firebase (required)
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id

# Cloud OCR (optional; see Receipt OCR below)
OCR_PROVIDER=none
TEXTRACT_REGION=us-east-1
```

### Firebase Setup

1. Create a project at [Firebase Console](https://console.firebase.google.com)
2. Enable Firestore Database
3. Deploy security rules:
   ```bash
   firebase deploy --only firestore:rules
   ```

### Running Locally

```bash
# Development server
npm run dev

# Run tests
npm test

# Production build
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) with App Router
- **Database**: [Firebase Firestore](https://firebase.google.com/docs/firestore)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Drag & Drop**: [dnd-kit](https://dndkit.com/)
- **OCR**: [Amazon Textract](https://aws.amazon.com/textract/) + [Tesseract.js](https://tesseract.projectnaptha.com/)
- **Testing**: [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/react)

## Project Structure

```
src/
├── app/                    # Next.js app router pages
│   ├── page.tsx           # Home page (create/join expense)
│   ├── expense/[code]/    # Expense page (main app interface)
│   ├── api/ocr/           # Server-side OCR endpoint
│   └── api/receipt-link/  # Reads a Toast receipt link
├── components/            # React components
│   ├── dnd/               # Drag and drop provider
│   ├── line-items/        # Line item list and editors
│   ├── participants/      # Participant chips and modals
│   ├── receipt/           # Receipt upload and OCR
│   ├── share/             # Share button
│   ├── summary/           # Per-person summary
│   └── total/             # Total editor with tip shortcuts
├── hooks/                 # Custom React hooks
├── services/              # Business logic
│   ├── ocr/               # OCR providers (cloud, Tesseract, fallback; server/ holds Textract)
│   ├── receipt-link/      # Toast receipt page parser
│   ├── expenses.ts        # Firestore CRUD operations
│   ├── firebase.ts        # Firebase initialization
│   └── post.ts            # POST to an API route with the body's SHA-256
├── types/                 # TypeScript type definitions
└── utils/                 # Utility functions (colors, etc.)
```

## Receipt OCR

A scanned photo goes through two providers in order:

1. **Cloud**: the browser downscales the photo to a JPEG (long edge 2000 px) and posts it with
   the expense's share code to `/api/ocr`, which reads it with Amazon Textract's AnalyzeExpense
   and returns the line items, subtotal, tax, tip and total. The app holds the image in memory
   for the one call and neither stores nor logs it. Textract's own handling of the image follows
   AWS's terms for the service, which allow AWS to keep inputs to improve it unless the account
   opts out through an AWS Organizations policy.
2. **Fallback**: Tesseract.js in the browser, parsing the text with regular expressions.

The route falls back on any failure, and refuses images that are not JPEG or PNG, larger than
4 MB, or sent without the share code of an existing expense.

The server needs no AWS access key. On AWS Lambda, the SDK's default credential chain picks up
the execution role's short-lived credentials, and the role allows one Textract action. Locally the
chain uses whatever credentials the shell provides, so leave `OCR_PROVIDER` at `none` unless you
mean to call Textract with your own. Environment variables:

- `OCR_PROVIDER`: `textract`, or `none` (the default) to use Tesseract for every scan
- `TEXTRACT_REGION`: optional, the region Textract is called in (default `us-east-1`)

`infra/` holds the OpenTofu stack that runs the site on AWS: the Lambda function (the image by
digest, an execution role with its one Textract permission), its function URL, CloudFront in front
of it, and the alarms and spend stop. The function URL takes only requests that CloudFront signed
(origin access control), so the app is reachable only through CloudFront, which redirects HTTP and
`www` and adds the security headers. An alarm emails when Textract requests exceed 60 an hour, and
another on function errors. The spend stop: once Textract costs more than
`textract_monthly_limit_usd` (default $5) in a month, an AWS Budgets action attaches a deny policy to
the function's role and scans fall back to Tesseract. The stop is a backstop rather than a cap:
Budgets works from billing data that lags, so it can act up to about a day late, and the hourly alarm
is the faster signal. It stays on into the next month until the action is reversed in the Budgets
console (or the policy is detached; see `infra/budget.tf`). `infra/bootstrap/` holds what the first
deploy needs first: the image repository, the build, and the certificate.

## Testing

```bash
# Run tests in watch mode
npm test

# Run tests once (CI)
npm run test:run

# The CloudFront redirect function
node --test infra/cdn/www-redirect.test.mjs

# infra/deploy.sh, offline, with stubs for aws, tofu, git, curl and dig
node --test infra/deploy.test.mjs

# The OpenTofu stacks, offline (no AWS access needed)
(cd infra && tofu init -backend=false && tofu test)
(cd infra/bootstrap && tofu init -backend=false && tofu test)
(cd infra/dns && tofu init -backend=false && tofu test)
```

Test coverage includes:
- Receipt text parsing logic
- OCR fallback behavior
- Participant color assignment
- Share code validation

## Security

- **Firestore Rules**: Strict validation on all document operations
- **Share Codes**: 6-character alphanumeric codes (ambiguous characters removed)
- **Cloud OCR**: no access keys; the server runs with its Lambda execution role, which allows one
  Textract action
- **Signed origin**: the browser sends every POST to an API route with `x-amz-content-sha256`, the
  SHA-256 of its body (`src/services/post.ts`). CloudFront signs the requests it forwards to the
  Lambda function URL, and the function URL accepts a signed POST only with that hash, so the
  function can't be called directly around CloudFront
- **Rate limit**: CloudFront's web ACL blocks an address that sends more than 30 POSTs to the API
  in five minutes (`infra/waf.tf`), on CloudFront's flat-rate Free plan
- **No Authentication**: Intentional design choice for frictionless sharing

## Deployment

The site runs on AWS: a Lambda function behind CloudFront, built by CodeBuild (see `infra/`), with
its DNS at Cloudflare (`infra/dns`). Every step needs an AWS CLI profile signed in (`AWS_PROFILE`),
OpenTofu, jq, curl and dig, and shows its plan before a typed `yes`. Copy the `.example` files in
`infra/`, `infra/bootstrap/` and `infra/dns/` first. The `--dns` steps ask for a Cloudflare API
token with Zone · DNS · Edit and Zone · Zone · Read on the site's zone alone, and an end date; they
refuse a token that reaches any other zone. Before anything that costs money, `deploy.sh` reads the
account's plan and stops if it is AWS's Free plan, which can't take CloudFront's flat-rate plans.

Once, in order:

0. `infra/deploy.sh --state`: the private, versioned S3 bucket the stacks keep their state in, and
   the three gitignored `backend.hcl` files that name it.
1. `infra/deploy.sh --dns adopt`: brings the zone's records under `infra/dns`. It imports the ones
   it describes, and stops before any change if the zone holds one it doesn't. It adds CAA for
   Amazon's certificate authority and the records that say the domain sends no mail, and then
   checks that each of the zone's nameservers serves every record.
2. `infra/deploy.sh --bootstrap`: the image repository, the build project and the site's
   certificate. It refuses to start until the zone's CAA admits Amazon.
3. `infra/deploy.sh --dns apply`: adds the certificate's validation records. Wait for the
   certificate to be issued.
4. `infra/deploy.sh`: builds the pushed HEAD of `main` in CodeBuild (the tests run inside the image
   build), reads the image's digest back from ECR, and applies `infra/` with it. Then it checks
   that the function URL refuses a direct call, and that the site, its HSTS header and the HTTP and
   `www` redirects answer through CloudFront. The distribution and its web ACL go on CloudFront's
   flat-rate Free plan; if the plan refuses the subscription, `deploy.sh` removes the web ACL at
   once, so nothing bills for it, and stops.
5. `infra/deploy.sh --dns cutover`: points the apex and `www` at CloudFront. It may only replace
   those two records. `infra/deploy.sh --dns rollback` points them back.

`infra/deploy.sh --check` runs only the checks a deploy ends with, read-only: among them whether
the alert email's subscription is confirmed (AWS emails a link that must be clicked) and whether
the site's own DNS reaches CloudFront yet.

After that, every deploy is `infra/deploy.sh`. To go back, `infra/deploy.sh --digest sha256:...`
deploys an image already in ECR without a build; the repository keeps the last 10. If an apply
fails because a role made moments before isn't visible to AWS yet, run the same command again.

A deploy runner can run the same script without a person: `DEPLOY_NONINTERACTIVE=1` with
`AWS_PROFILE=splitwit-deploy`, a deploy role whose profile is in the runner's own
`AWS_CONFIG_FILE`, and `DEPLOY_COMMIT`, the commit whose tree, without `.git`, the runner hands
over and has checked. That tree is the commit: git never runs, and the build's source is the tree's
files without the gitignored tfvars and `backend.hcl`. Nothing is asked. A plan that passes its
mode's checks is applied, and any other ends with `RESULT: REFUSED (...)` and nothing applied.
Runner mode refuses `--state` and any IAM
change the deploy role may not make, and the `--dns` steps read the Cloudflare token from the file
`CLOUDFLARE_API_TOKEN_FILE` names. A deploy role that may make or change the site's roles only
with a permissions boundary needs that boundary on them first: set `permissions_boundary_arn` in
`infra/terraform.tfvars.json` and `infra/bootstrap/terraform.tfvars.json`, then run
`infra/deploy.sh --attach-boundary`, which applies a plan only if it changes nothing but the
boundary of `splitwit-app`, `splitwit-keep-warm`, `splitwit-budgets-action` and `splitwit-build`.

## License

MIT
