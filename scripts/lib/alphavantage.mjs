// Alpha-Vantage-Client mit hartem Abruf-Budget.
// Free Tier: 25 Abrufe pro Tag, 1 pro Sekunde. Budget je Ausgabe:
// maximal 10 Abrufe morgens, 12 abends, strikt sequenziell.
// Der Budgetstand wird je Ausgabe in .cache/av-budget-<slug>.json geführt,
// damit auch Folgeprozesse (fetch-company-data.mjs) das Budget respektieren.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cacheDir = join(root, ".cache");
mkdirSync(cacheDir, { recursive: true });

// Intraday-Updates verbrauchen kein Alpha-Vantage-Budget (25 Abrufe/Tag
// reichen nur für Morgen- und Abendausgabe); sie übernehmen die Kacheln
// der letzten Vollausgabe oder belegen Werte mit approx aus Tier-1/2-Quellen.
export const BUDGETS = {
  morning: 10,
  evening: 12,
  "update-10": 0,
  "update-13": 0,
  "update-16": 0,
  "update-19": 0,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AlphaVantage {
  constructor(slug, slot) {
    this.key = process.env.ALPHAVANTAGE_API_KEY;
    if (!this.key) {
      throw new Error(
        "ALPHAVANTAGE_API_KEY ist nicht gesetzt. Key kostenlos unter https://www.alphavantage.co/support/#api-key"
      );
    }
    this.slug = slug;
    this.max = BUDGETS[slot] ?? 10;
    this.budgetFile = join(cacheDir, `av-budget-${slug}.json`);
    this.used = existsSync(this.budgetFile)
      ? JSON.parse(readFileSync(this.budgetFile, "utf8")).used
      : 0;
    this.lastCall = 0;
  }

  remaining() {
    return this.max - this.used;
  }

  _persist() {
    writeFileSync(this.budgetFile, JSON.stringify({ used: this.used, max: this.max }) + "\n");
  }

  // Ein Abruf. Wirft, wenn das Budget erschöpft ist.
  async call(params, label) {
    if (this.remaining() <= 0) {
      throw new Error(`Alpha-Vantage-Budget erschöpft (${this.max} Abrufe für diese Ausgabe).`);
    }
    // Sequenziell, höchstens 1 Abruf pro Sekunde (plus Puffer)
    const wait = 1300 - (Date.now() - this.lastCall);
    if (wait > 0) await sleep(wait);

    const qs = new URLSearchParams({ ...params, apikey: this.key });
    const url = `https://www.alphavantage.co/query?${qs}`;
    this.lastCall = Date.now();
    this.used++;
    this._persist();

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status} (${label})`);
    const data = await res.json();
    if (data.Note || data.Information) {
      // Rate-Limit oder Hinweis des Anbieters: als Fehler behandeln, Budget bleibt verbraucht
      throw new Error(`Alpha Vantage: ${data.Note ?? data.Information} (${label})`);
    }
    if (data["Error Message"]) {
      throw new Error(`Alpha Vantage: ${data["Error Message"]} (${label})`);
    }
    console.log(`  📡 ${label} (Abruf ${this.used}/${this.max})`);
    return data;
  }
}

// ---------- Formatierung (deutsches Zahlenformat) ----------

export function de(value, decimals = 2) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function direction(changePct) {
  if (changePct > 0.05) return "up";
  if (changePct < -0.05) return "down";
  return "flat";
}

export function deltaString(changePct) {
  const sign = changePct > 0 ? "+" : "";
  return `${sign}${de(changePct)} %`;
}

// GLOBAL_QUOTE → Kachel-Rohdaten
export function parseGlobalQuote(data) {
  const q = data["Global Quote"];
  if (!q || !q["05. price"]) return null;
  return {
    price: Number(q["05. price"]),
    changePct: Number((q["10. change percent"] ?? "0").replace("%", "")),
    date: q["07. latest trading day"],
  };
}

// TIME_SERIES_DAILY (compact) → [{t, v}] aufsteigend, letzte n Handelstage
export function parseDailySeries(data, n = 30) {
  const ts = data["Time Series (Daily)"];
  if (!ts) return null;
  return Object.entries(ts)
    .map(([t, row]) => ({ t, v: Number(row["4. close"]) }))
    .sort((a, b) => (a.t < b.t ? -1 : 1))
    .slice(-n);
}
