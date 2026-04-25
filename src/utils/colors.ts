// Participant chip colors - a set of distinct, accessible background colors
const PILL_COLORS = [
  { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200', activeBg: 'bg-red-700', activeText: 'text-white', activeBorder: 'border-red-700' },
  { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200', activeBg: 'bg-orange-700', activeText: 'text-white', activeBorder: 'border-orange-700' },
  { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', activeBg: 'bg-amber-700', activeText: 'text-white', activeBorder: 'border-amber-700' },
  { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-200', activeBg: 'bg-yellow-500', activeText: 'text-white', activeBorder: 'border-yellow-500' },
  { bg: 'bg-lime-100', text: 'text-lime-800', border: 'border-lime-200', activeBg: 'bg-lime-700', activeText: 'text-white', activeBorder: 'border-lime-700' },
  { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200', activeBg: 'bg-green-700', activeText: 'text-white', activeBorder: 'border-green-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', activeBg: 'bg-emerald-700', activeText: 'text-white', activeBorder: 'border-emerald-700' },
  { bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-200', activeBg: 'bg-teal-700', activeText: 'text-white', activeBorder: 'border-teal-700' },
  { bg: 'bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-200', activeBg: 'bg-cyan-700', activeText: 'text-white', activeBorder: 'border-cyan-700' },
  { bg: 'bg-sky-100', text: 'text-sky-800', border: 'border-sky-200', activeBg: 'bg-sky-700', activeText: 'text-white', activeBorder: 'border-sky-700' },
  { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200', activeBg: 'bg-blue-700', activeText: 'text-white', activeBorder: 'border-blue-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200', activeBg: 'bg-indigo-700', activeText: 'text-white', activeBorder: 'border-indigo-700' },
  { bg: 'bg-violet-100', text: 'text-violet-800', border: 'border-violet-200', activeBg: 'bg-violet-700', activeText: 'text-white', activeBorder: 'border-violet-700' },
  { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200', activeBg: 'bg-purple-700', activeText: 'text-white', activeBorder: 'border-purple-700' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800', border: 'border-fuchsia-200', activeBg: 'bg-fuchsia-700', activeText: 'text-white', activeBorder: 'border-fuchsia-700' },
  { bg: 'bg-pink-100', text: 'text-pink-800', border: 'border-pink-200', activeBg: 'bg-pink-700', activeText: 'text-white', activeBorder: 'border-pink-700' },
  { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200', activeBg: 'bg-rose-700', activeText: 'text-white', activeBorder: 'border-rose-700' },
];

/**
 * Simple hash function for strings
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get a consistent color for a participant based on their name
 */
export function getParticipantColor(name: string): typeof PILL_COLORS[0] {
  const hash = hashString(name.toLowerCase().trim());
  return PILL_COLORS[hash % PILL_COLORS.length];
}

/**
 * Get Tailwind classes for a participant chip
 */
export function getParticipantChipClasses(name: string): string {
  const color = getParticipantColor(name);
  return `${color.bg} ${color.text} ${color.border}`;
}

export function getParticipantActiveChipClasses(name: string): string {
  const color = getParticipantColor(name);
  return `${color.activeBg} ${color.activeText} ${color.activeBorder}`;
}
