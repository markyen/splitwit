'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineItem, Participant, EVERYONE_MARKER } from '@/types';

interface SummarySectionProps {
  lineItems: LineItem[];
  participants: Participant[];
  total: number | null;
  code: string;
  title: string | null;
}

interface ItemShare {
  name: string;
  share: number;
  splitCount: number;
}

interface ParticipantShare {
  participant: Participant;
  amount: number;
  items: ItemShare[];
}

export function SummarySection({ lineItems, participants, total, code, title }: SummarySectionProps) {
  const payer = participants[0];
  const [venmoMode, setVenmoMode] = useState<'charge' | 'pay'>('charge');
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    setShareUrl(`${window.location.origin}/expense/${code}`);
  }, [code]);

  const shares = useMemo(() => {
    const shareMap = new Map<string, ParticipantShare>();

    // Initialize shares for all participants
    for (const participant of participants) {
      shareMap.set(participant.id, {
        participant,
        amount: 0,
        items: [],
      });
    }

    // Calculate shares for each line item
    for (const item of lineItems) {
      if (item.assignedTo.length === 0) continue;

      let assignedParticipants: Participant[];

      if (item.assignedTo.includes(EVERYONE_MARKER)) {
        assignedParticipants = participants;
      } else {
        assignedParticipants = participants.filter((p) =>
          item.assignedTo.includes(p.id)
        );
      }

      if (assignedParticipants.length === 0) continue;

      const sharePerPerson = item.price / assignedParticipants.length;

      for (const participant of assignedParticipants) {
        const share = shareMap.get(participant.id);
        if (share) {
          share.amount += sharePerPerson;
          share.items.push({
            name: item.name,
            share: sharePerPerson,
            splitCount: assignedParticipants.length,
          });
        }
      }
    }

    const shares = Array.from(shareMap.values());

    // Scale shares by total/subtotal ratio to account for tax, tip, etc.
    if (total != null) {
      const subtotal = lineItems.reduce((sum, item) => sum + item.price, 0);
      if (subtotal > 0) {
        const ratio = total / subtotal;
        for (const share of shares) {
          share.amount *= ratio;
          for (const item of share.items) {
            item.share *= ratio;
          }
        }
      }
    }

    return shares;
  }, [lineItems, participants, total]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price);
  };

  const formatBreakdown = (items: ItemShare[]) => {
    return items
      .map((item) => {
        if (item.splitCount === 1) {
          return item.name;
        }
        return `${item.name} /${item.splitCount}`;
      })
      .join(' + ');
  };

  const buildVenmoLink = (amount: number, note: string) => {
    const params = [
      'recipients=',
      `txn=${venmoMode}`,
      `amount=${amount.toFixed(2)}`,
      `note=${encodeURIComponent(note)}`,
    ];
    return `venmo://paycharge?${params.join('&')}`;
  };

  if (!payer) return null;

  // Filter out payer from the "owes" list
  const nonPayerShares = shares.filter((s) => s.participant.id !== payer.id);

  return (
    <div className="rounded-lg bg-green-50 border border-green-200 p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-medium text-green-800">
          Summary
        </h3>
        <div className="inline-flex rounded-md border border-green-200 bg-white p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setVenmoMode('charge')}
            className={`px-2 py-1 rounded ${
              venmoMode === 'charge'
                ? 'bg-green-100 text-green-800 font-medium'
                : 'text-gray-500'
            }`}
          >
            I&apos;m collecting
          </button>
          <button
            type="button"
            onClick={() => setVenmoMode('pay')}
            className={`px-2 py-1 rounded ${
              venmoMode === 'pay'
                ? 'bg-green-100 text-green-800 font-medium'
                : 'text-gray-500'
            }`}
          >
            I&apos;m paying
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {nonPayerShares.map((share) => (
          <div
            key={share.participant.id}
            className="flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">
                {share.participant.name}
              </p>
              <p className="text-xs text-gray-500 truncate" title={formatBreakdown(share.items)}>
                {formatBreakdown(share.items)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <p className="text-lg font-bold text-green-700">
                {formatPrice(share.amount)}
              </p>
              <a
                href={buildVenmoLink(
                  share.amount,
                  `${title ? `${title} - ` : ''}${formatBreakdown(share.items)}${
                    shareUrl ? ` - ${shareUrl}` : ''
                  }`
                )}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Pay ${payer.name} ${formatPrice(share.amount)} on Venmo`}
                className="inline-flex items-center justify-center rounded-md bg-[#3D95CE] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#357fb0] active:opacity-80"
              >
                Venmo
              </a>
            </div>
          </div>
        ))}

        {nonPayerShares.length === 0 && (
          <p className="text-center text-gray-500">
            {participants.length === 1
              ? 'Add more participants to split the bill'
              : 'No amounts owed'}
          </p>
        )}

        {nonPayerShares.length > 1 && (
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-green-200">
            <span className="text-sm font-medium text-gray-600">Total owed to {payer.name}:</span>
            <span className="text-lg font-bold text-green-700 shrink-0">
              {formatPrice(nonPayerShares.reduce((sum, s) => sum + s.amount, 0))}
            </span>
          </div>
        )}
      </div>

      {/* Payer's portion */}
      {(() => {
        const payerShare = shares.find((s) => s.participant.id === payer.id);
        if (!payerShare) return null;
        return (
          <div className="mt-4 pt-4 border-t border-green-200">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-sm text-gray-600">{payer.name}&apos;s share:</span>
                <p className="text-xs text-gray-500 truncate" title={formatBreakdown(payerShare.items)}>
                  {formatBreakdown(payerShare.items)}
                </p>
              </div>
              <span className="text-sm font-medium text-gray-600 shrink-0">
                {formatPrice(payerShare.amount)}
              </span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
