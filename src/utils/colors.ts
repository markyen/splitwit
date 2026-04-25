import { Participant } from '@/types';

// Participant chip colors - muted jewel tones for quieter default chips and strong active states
const CHIP_COLORS = [
  { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300', activeBg: 'bg-slate-700', activeText: 'text-white', activeBorder: 'border-slate-700' },
  { bg: 'bg-stone-100', text: 'text-stone-700', border: 'border-stone-300', activeBg: 'bg-stone-700', activeText: 'text-white', activeBorder: 'border-stone-700' },
  { bg: 'bg-zinc-100', text: 'text-zinc-700', border: 'border-zinc-300', activeBg: 'bg-zinc-700', activeText: 'text-white', activeBorder: 'border-zinc-700' },
  { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300', activeBg: 'bg-emerald-700', activeText: 'text-white', activeBorder: 'border-emerald-700' },
  { bg: 'bg-teal-50', text: 'text-teal-800', border: 'border-teal-300', activeBg: 'bg-teal-700', activeText: 'text-white', activeBorder: 'border-teal-700' },
  { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-300', activeBg: 'bg-cyan-700', activeText: 'text-white', activeBorder: 'border-cyan-700' },
  { bg: 'bg-sky-50', text: 'text-sky-800', border: 'border-sky-300', activeBg: 'bg-sky-700', activeText: 'text-white', activeBorder: 'border-sky-700' },
  { bg: 'bg-indigo-50', text: 'text-indigo-800', border: 'border-indigo-300', activeBg: 'bg-indigo-700', activeText: 'text-white', activeBorder: 'border-indigo-700' },
  { bg: 'bg-violet-50', text: 'text-violet-800', border: 'border-violet-300', activeBg: 'bg-violet-700', activeText: 'text-white', activeBorder: 'border-violet-700' },
  { bg: 'bg-fuchsia-50', text: 'text-fuchsia-800', border: 'border-fuchsia-300', activeBg: 'bg-fuchsia-700', activeText: 'text-white', activeBorder: 'border-fuchsia-700' },
  { bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-300', activeBg: 'bg-rose-700', activeText: 'text-white', activeBorder: 'border-rose-700' },
  { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-300', activeBg: 'bg-red-700', activeText: 'text-white', activeBorder: 'border-red-700' },
  { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-300', activeBg: 'bg-orange-700', activeText: 'text-white', activeBorder: 'border-orange-700' },
  { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300', activeBg: 'bg-amber-700', activeText: 'text-white', activeBorder: 'border-amber-700' },
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

function normalizeParticipantName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function sortParticipantsAlphabetically(participants: Pick<Participant, 'id' | 'name'>[]) {
  return [...participants].sort((a, b) => {
    const nameCompare = normalizeParticipantName(a.name).localeCompare(normalizeParticipantName(b.name));
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return a.id.localeCompare(b.id);
  });
}

/**
 * Get a consistent color for a participant based on their order within an expense.
 * String input is kept as a fallback for any non-participant usage.
 */
export function getParticipantColor(seed: number | string): typeof CHIP_COLORS[0] {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return CHIP_COLORS[Math.abs(seed) % CHIP_COLORS.length];
  }

  const hash = hashString(String(seed).toLowerCase().trim());
  return CHIP_COLORS[hash % CHIP_COLORS.length];
}

export function getParticipantColorIndex(
  participant: Pick<Participant, 'id' | 'name'>,
  participants: Pick<Participant, 'id' | 'name'>[]
): number {
  const sortedParticipants = sortParticipantsAlphabetically(participants);
  const index = sortedParticipants.findIndex(({ id }) => id === participant.id);

  return index >= 0 ? index : hashString(participant.id) % CHIP_COLORS.length;
}

/**
 * Get Tailwind classes for a participant chip
 */
export function getParticipantChipClasses(seed: number | string): string {
  const color = getParticipantColor(seed);
  return `${color.bg} ${color.text} ${color.border}`;
}

export function getParticipantActiveChipClasses(seed: number | string): string {
  const color = getParticipantColor(seed);
  return `${color.activeBg} ${color.activeText} ${color.activeBorder}`;
}

export function getParticipantChipClassesForParticipant(
  participant: Pick<Participant, 'id' | 'name'>,
  participants: Pick<Participant, 'id' | 'name'>[]
): string {
  return getParticipantChipClasses(getParticipantColorIndex(participant, participants));
}

export function getParticipantActiveChipClassesForParticipant(
  participant: Pick<Participant, 'id' | 'name'>,
  participants: Pick<Participant, 'id' | 'name'>[]
): string {
  return getParticipantActiveChipClasses(getParticipantColorIndex(participant, participants));
}
