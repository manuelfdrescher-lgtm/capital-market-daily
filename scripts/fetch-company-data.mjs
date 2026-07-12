// Phase B der Editions-Pipeline: Kursreihe und Kennzahlen für ein
// Fokus-Unternehmen. Respektiert das Restbudget der Ausgabe
// (2 Abrufe je Unternehmen: TIME_SERIES_DAILY compact + COMPANY_OVERVIEW).
//
// Aufruf: node scripts/fetch-company-data.mjs --slug 2026-07-11-morning --slot morning --ticker MU
// Optional: --series-only (nur 1 Abruf, ohne COMPANY_OVERVIEW)
// Ergebnis: .cache/company-<slug>-<TICKER>.json
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AlphaVantage, de, parseDailySeries } from "./lib/alphavantage.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug = getArg("slug");
const slot = getArg("slot");
const ticker = getArg("ticker");
const seriesOnly = args.includes("--series-only");

if (!slug || !slot || !ticker) {
  console.error("Aufruf: node scripts/fetch-company-data.mjs --slug JJJJ-MM-TT-slot --slot morning|evening --ticker SYMBOL [--series-only]");
  process.exit(1);
}

const av = new AlphaVantage(slug, slot);
const needed = seriesOnly ? 1 : 2;
if (av.remaining() < needed) {
  console.error(`❌ Budget reicht nicht: ${av.remaining()} Abrufe übrig, ${needed} benötigt. Datenlücke im Faktencheck-Protokoll ausweisen.`);
  process.exit(2);
}

const out = { ticker, slug, fetchedAt: new Date().toISOString() };

const seriesData = await av.call(
  { function: "TIME_SERIES_DAILY", symbol: ticker, outputsize: "compact" },
  `Kursreihe ${ticker}`
);
out.priceSeries = parseDailySeries(seriesData, 30);
out.priceSeriesSource = "Alpha Vantage, TIME_SERIES_DAILY (Tagesschlusskurse)";

if (!seriesOnly) {
  const ov = await av.call({ function: "OVERVIEW", symbol: ticker }, `Kennzahlen ${ticker}`);
  if (ov.Symbol) {
    out.overview = {
      name: ov.Name,
      exchange: ov.Exchange,
      currency: ov.Currency,
      marketCap: ov.MarketCapitalization,
      peRatio: ov.PERatio,
      evToEbitda: ov.EVToEBITDA,
      profitMargin: ov.ProfitMargin,
      revenueTTM: ov.RevenueTTM,
      dividendYield: ov.DividendYield,
      sector: ov.Sector,
      industry: ov.Industry,
      description: ov.Description,
    };
  } else {
    out.overviewMissing = "COMPANY_OVERVIEW lieferte keine Daten (Ticker prüfen; Datenlücke ausweisen).";
  }
}

if (out.priceSeries?.length) {
  const last = out.priceSeries[out.priceSeries.length - 1];
  const prev = out.priceSeries[out.priceSeries.length - 2];
  if (prev) {
    const pct = ((last.v - prev.v) / prev.v) * 100;
    out.lastClose = { date: last.t, price: last.v, changePct: Number(de(pct).replace(",", ".")) };
  }
}

mkdirSync(join(root, ".cache"), { recursive: true });
const outPath = join(root, ".cache", `company-${slug}-${ticker}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`✅ ${ticker}: ${out.priceSeries?.length ?? 0} Kurs-Punkte${out.overview ? " + Kennzahlen" : ""} → ${outPath}`);
console.log(`   Budget: ${av.used}/${av.max} verbraucht.`);
