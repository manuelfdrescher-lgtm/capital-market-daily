// Phase A der Editions-Pipeline: Markt-Schnappschuss von Alpha Vantage.
// Belegt 8 der budgetierten Abrufe (morgens 10, abends 12) und lässt den
// Rest für Unternehmensdaten (scripts/fetch-company-data.mjs).
// Priorität laut Redaktionsstatut: Indexdaten, 10-jährige US-Rendite,
// EUR/USD, Öl, Top-Gewinner/Verlierer.
//
// Aufruf: node scripts/fetch-market-data.mjs --slug 2026-07-11-morning --slot morning
// Ergebnis: .cache/market-data-<slug>.json
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlphaVantage, de, deltaString, direction, parseGlobalQuote,
} from "./lib/alphavantage.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug = getArg("slug");
const slot = getArg("slot");
if (!slug || !slot) {
  console.error("Aufruf: node scripts/fetch-market-data.mjs --slug JJJJ-MM-TT-slot --slot morning|evening");
  process.exit(1);
}

const av = new AlphaVantage(slug, slot);
const tiles = [];
const gaps = [];
const raw = {};

// Index-Kacheln über liquide ETFs als Näherung (Alpha Vantage Free Tier
// liefert keine Index-Stände). Kacheln tragen deshalb approx:true und
// eine note mit dem ETF-Namen.
const INDEX_PROXIES = [
  { symbol: "SPY", label: "S&P 500", note: "über ETF SPY" },
  { symbol: "QQQ", label: "Nasdaq 100", note: "über ETF QQQ" },
  { symbol: "DIA", label: "Dow Jones", note: "über ETF DIA" },
  { symbol: "IWM", label: "Russell 2000", note: "über ETF IWM" },
];

for (const { symbol, label, note } of INDEX_PROXIES) {
  try {
    const q = parseGlobalQuote(await av.call({ function: "GLOBAL_QUOTE", symbol }, `${label} (${symbol})`));
    if (!q) throw new Error("leere Antwort");
    tiles.push({
      label,
      value: `${de(q.price)} USD`,
      delta: deltaString(q.changePct),
      direction: direction(q.changePct),
      approx: true,
      note: `${note}, Schluss ${q.date}`,
    });
    raw[symbol] = q;
  } catch (err) {
    gaps.push(`${label}: ${err.message}`);
  }
}

// 10-jährige US-Staatsanleihenrendite
try {
  const data = await av.call({ function: "TREASURY_YIELD", interval: "daily", maturity: "10year" }, "US-Rendite 10 Jahre");
  const rows = (data.data ?? []).filter((r) => r.value !== ".");
  const [today, prev] = rows;
  if (!today) throw new Error("keine Daten");
  const diffBp = prev ? Math.round((Number(today.value) - Number(prev.value)) * 100) : null;
  tiles.push({
    label: "US-Rendite 10 Jahre",
    value: `${de(Number(today.value))} %`,
    delta: diffBp === null ? undefined : `${diffBp >= 0 ? "+" : ""}${diffBp} Bp.`,
    direction: diffBp === null ? "flat" : diffBp > 0 ? "up" : diffBp < 0 ? "down" : "flat",
    approx: false,
    note: `Stand ${today.date}`,
  });
  raw.treasury10y = rows.slice(0, 30);
} catch (err) {
  gaps.push(`US-Rendite 10 Jahre: ${err.message}`);
}

// EUR/USD
try {
  const data = await av.call(
    { function: "CURRENCY_EXCHANGE_RATE", from_currency: "EUR", to_currency: "USD" },
    "EUR/USD"
  );
  const r = data["Realtime Currency Exchange Rate"];
  if (!r) throw new Error("leere Antwort");
  tiles.push({
    label: "EUR/USD",
    value: de(Number(r["5. Exchange Rate"]), 4),
    direction: "flat",
    approx: false,
    note: `Stand ${r["6. Last Refreshed"]} UTC`,
  });
} catch (err) {
  gaps.push(`EUR/USD: ${err.message}`);
}

// Öl (WTI)
try {
  const data = await av.call({ function: "WTI", interval: "daily" }, "Öl (WTI)");
  const rows = (data.data ?? []).filter((r) => r.value !== ".");
  const [today, prev] = rows;
  if (!today) throw new Error("keine Daten");
  const pct = prev ? ((Number(today.value) - Number(prev.value)) / Number(prev.value)) * 100 : 0;
  tiles.push({
    label: "Öl (WTI)",
    value: `${de(Number(today.value))} USD`,
    delta: deltaString(pct),
    direction: direction(pct),
    approx: false,
    note: `Stand ${today.date}`,
  });
  raw.wti = rows.slice(0, 30);
} catch (err) {
  gaps.push(`Öl (WTI): ${err.message}`);
}

// Bitcoin
try {
  const data = await av.call(
    { function: "CURRENCY_EXCHANGE_RATE", from_currency: "BTC", to_currency: "USD" },
    "Bitcoin"
  );
  const r = data["Realtime Currency Exchange Rate"];
  if (!r) throw new Error("leere Antwort");
  tiles.push({
    label: "Bitcoin",
    value: `${de(Number(r["5. Exchange Rate"]), 0)} USD`,
    direction: "flat",
    approx: false,
    note: `Stand ${r["6. Last Refreshed"]} UTC`,
  });
} catch (err) {
  gaps.push(`Bitcoin: ${err.message}`);
}

// Top-Gewinner/Verlierer (US-Markt)
try {
  const data = await av.call({ function: "TOP_GAINERS_LOSERS" }, "Top-Gewinner/Verlierer");
  raw.topMovers = {
    lastUpdated: data.last_updated,
    gainers: (data.top_gainers ?? []).slice(0, 10),
    losers: (data.top_losers ?? []).slice(0, 10),
  };
} catch (err) {
  gaps.push(`Top-Gewinner/Verlierer: ${err.message}`);
}

// Kacheln, die der Free Tier nicht liefert: ausdrücklich als Lücke führen.
// Die Redaktion darf sie nur mit approx:true aus Tier-1/Tier-2-Quellen füllen.
gaps.push(
  "DAX: nicht über Alpha Vantage Free Tier verfügbar; nur mit approx:true aus Tier-1/2-Quelle füllen.",
  "VIX: nicht über Alpha Vantage Free Tier verfügbar; nur mit approx:true aus Tier-1/2-Quelle füllen.",
  "US-Leitzins: aus letzter FOMC-Entscheidung übernehmen (Tier 1, ändert sich nur an Sitzungsterminen)."
);

const out = {
  slug,
  slot,
  fetchedAt: new Date().toISOString(),
  budget: { used: av.used, max: av.max, remainingForCompanies: av.remaining() },
  tiles,
  gaps,
  raw,
};

mkdirSync(join(root, ".cache"), { recursive: true });
const outPath = join(root, ".cache", `market-data-${slug}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`\n✅ Markt-Schnappschuss: ${tiles.length} Kacheln, ${gaps.length} Lücken → ${outPath}`);
console.log(`   Budget: ${av.used}/${av.max} verbraucht, ${av.remaining()} Abrufe für Unternehmensdaten übrig.`);
