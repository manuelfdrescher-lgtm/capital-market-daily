// Nimmt extern angelieferte Editions-JSONs an (z. B. aus einem
// Claude-Cowork-Prozess), validiert sie gegen das Schema und sortiert
// sie unter content/editions/ ein.
//
//   npm run ingest <datei.json>
//   Optionen: --commit (direkt committen)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseEdition } from "../src/lib/edition-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const doCommit = process.argv.includes("--commit");

const src = args[0];
if (!src) {
  console.error("Aufruf: npm run ingest <datei.json> [-- --commit]");
  process.exit(1);
}
if (!existsSync(src)) {
  console.error(`❌ Datei nicht gefunden: ${src}`);
  process.exit(1);
}

let json;
try {
  json = JSON.parse(readFileSync(src, "utf8"));
} catch (err) {
  console.error(`❌ Kein gültiges JSON: ${err.message}`);
  process.exit(1);
}

let edition;
try {
  edition = parseEdition(json, src);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const slug = `${edition.edition.date}-${edition.edition.slot}`;
const dest = join(root, "content", "editions", `${slug}.json`);
if (existsSync(dest)) {
  console.error(`❌ Es gibt bereits eine Ausgabe ${slug} (${dest}). Erst entfernen, dann erneut einsortieren.`);
  process.exit(1);
}

writeFileSync(dest, JSON.stringify(json, null, 2) + "\n");
console.log(`✅ Valide. Einsortiert als content/editions/${slug}.json (Ausgabe Nr. ${edition.edition.number}, ${edition.articles.length} Artikel).`);

// Fehlende Logos gleich mitziehen
try {
  execFileSync("node", ["scripts/fetch-logos.mjs"], { cwd: root, stdio: "inherit" });
} catch {
  console.warn("⚠️  Logo-Abruf fehlgeschlagen; Fallback-Chips greifen.");
}

if (doCommit) {
  execFileSync("git", ["add", "content/", "public/logos/"], { cwd: root, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `Ausgabe ${slug} (extern angeliefert)`], { cwd: root, stdio: "inherit" });
  console.log("✅ Committet. Zum Veröffentlichen: git push");
}
