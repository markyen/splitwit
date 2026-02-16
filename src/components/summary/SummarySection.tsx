'use client';

import { useMemo } from 'react';
import { LineItem, Participant, EVERYONE_MARKER } from '@/types';

interface SummarySectionProps {
  lineItems: LineItem[];
  participants: Participant[];
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

export function SummarySection({ lineItems, participants }: SummarySectionProps) {
  const payer = participants[0];

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

    return Array.from(shareMap.values());
  }, [lineItems, participants]);

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

  if (!payer) return null;

  // Filter out payer from the "owes" list
  const nonPayerShares = shares.filter((s) => s.participant.id !== payer.id);

  return (
    <div className="rounded-lg bg-green-50 border border-green-200 p-4">
      <h3 className="text-sm font-medium text-green-800 mb-3">
        Summary
      </h3>

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
            <p className="text-lg font-bold text-green-700 shrink-0">
              {formatPrice(share.amount)}
            </p>
          </div>
        ))}

        {nonPayerShares.length === 0 && (
          <p className="text-center text-gray-500">
            {participants.length === 1
              ? 'Add more participants to split the bill'
              : 'No amounts owed'}
          </p>
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
