# Splitwit

A mobile-friendly web app for splitting bills with friends. Scan a receipt or manually enter items, assign them to participants, and see exactly what everyone owes.

## Features

- **Receipt Scanning** - Take a photo of your receipt and automatically extract line items using OCR (Azure Document Intelligence with Tesseract.js fallback)
- **Drag & Drop Assignment** - Drag participants onto items to assign who's paying for what
- **Shareable Sessions** - Share a 6-character code with friends so everyone can view and edit the expense in real-time
- **Smart Totals** - Add tip, tax, and adjustments on top of the subtotal with quick percentage buttons
- **Per-Person Summary** - See exactly what each person owes once all items are assigned
- **No Account Required** - Just create an expense and start splitting

## How It Works

1. **Create or Join** - Create a new expense or enter a share code to join an existing one
2. **Add Participants** - Add the names of everyone splitting the bill (first person is marked as the payer)
3. **Add Items** - Scan a receipt or manually add line items with prices
4. **Assign Items** - Drag participant pills onto items to assign them. Use "Everybody" to split an item evenly among all participants
5. **Set the Total** - Enter the final amount charged (including tip, tax, and any adjustments)
6. **View Summary** - Once all items are assigned, see what each person owes the payer

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project (for Firestore database)
- Optional: Azure Document Intelligence account (for better OCR)

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

# Azure Document Intelligence (optional - improves OCR accuracy)
AZURE_DOC_INTEL_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOC_INTEL_KEY=your-key
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
- **OCR**: [Azure Document Intelligence](https://azure.microsoft.com/en-us/products/ai-services/ai-document-intelligence) + [Tesseract.js](https://tesseract.projectnaptha.com/)
- **Testing**: [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/react)

## Project Structure

```
src/
├── app/                    # Next.js app router pages
│   ├── page.tsx           # Home page (create/join expense)
│   ├── expense/[code]/    # Expense page (main app interface)
│   └── api/ocr/           # Server-side OCR endpoint
├── components/            # React components
│   ├── dnd/               # Drag and drop provider
│   ├── line-items/        # Line item list and editors
│   ├── participants/      # Participant pills and modals
│   ├── receipt/           # Receipt upload and OCR
│   ├── share/             # Share button
│   ├── summary/           # Per-person summary
│   └── total/             # Total editor with tip shortcuts
├── hooks/                 # Custom React hooks
├── services/              # Business logic
│   ├── ocr/               # OCR providers (Azure, Tesseract, fallback)
│   ├── expenses.ts        # Firestore CRUD operations
│   └── firebase.ts        # Firebase initialization
├── types/                 # TypeScript type definitions
└── utils/                 # Utility functions (colors, etc.)
```

## OCR Architecture

The app uses a fallback pattern for receipt scanning:

1. **Primary**: Azure Document Intelligence (prebuilt receipt model)
   - Higher accuracy for structured receipts
   - Extracts line items, prices, subtotal, and total
   - Free tier: 500 pages/month

2. **Fallback**: Tesseract.js (client-side)
   - Works offline
   - No API costs
   - Uses regex patterns to parse receipt text

If Azure fails (quota exceeded, not configured, or errors), the app automatically falls back to Tesseract.

## Testing

```bash
# Run tests in watch mode
npm test

# Run tests once (CI)
npm run test:run
```

Test coverage includes:
- Receipt text parsing logic
- OCR fallback behavior
- Participant color assignment
- Share code validation

## Security

- **Firestore Rules**: Strict validation on all document operations
- **Share Codes**: 6-character alphanumeric codes (ambiguous characters removed)
- **API Keys**: Azure credentials are server-side only (not exposed to browser)
- **No Authentication**: Intentional design choice for frictionless sharing

## Deployment

Deploy to [Vercel](https://vercel.com) (recommended):

```bash
npm install -g vercel
vercel
```

Remember to add environment variables in the Vercel dashboard.

## License

MIT
