// Formatierungshelfer für Datum und Zahlen (deutsches Format).

const MONATE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const WOCHENTAGE = [
  "Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag",
];

export function formatDateLong(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WOCHENTAGE[date.getUTCDay()]}, ${d}. ${MONATE[m - 1]} ${y}`;
}

export function formatDateShort(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

const SLOT_LABELS = {
  morning: "Morgenausgabe",
  "update-10": "Update 10 Uhr",
  "update-13": "Update 13 Uhr",
  "update-16": "Update 16 Uhr",
  "update-19": "Update 19 Uhr",
  evening: "Abendausgabe",
};

// Reihenfolge innerhalb eines Tages (für die Archiv-Sortierung)
export const SLOT_ORDER = ["morning", "update-10", "update-13", "update-16", "update-19", "evening"];

export function slotLabel(slot) {
  return SLOT_LABELS[slot] ?? slot;
}

// Deutsche Zahlformatierung für Chart-Labels (aus number → "1.234,5")
export function formatNumberDE(value, maxDecimals = 2) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}
