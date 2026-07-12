// Validiert alle Editionen unter content/editions/ gegen das Zod-Schema.
// Wird vor jedem Build ausgeführt (npm run build). Exit-Code 1 bei Fehlern.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEdition } from "../src/lib/edition-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "content", "editions");

const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error("❌ Keine Editionen unter content/editions/ gefunden.");
  process.exit(1);
}

let failed = false;
for (const file of files.sort()) {
  const expected = /^\d{4}-\d{2}-\d{2}-(morning|update-(10|13|16|19)|evening)\.json$/;
  if (!expected.test(file)) {
    console.error(`❌ ${file}: Dateiname muss JJJJ-MM-TT-{morning|update-10|update-13|update-16|update-19|evening}.json sein.`);
    failed = true;
    continue;
  }
  try {
    const json = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const edition = parseEdition(json, file);
    const slugFromName = file.replace(/\.json$/, "");
    const slugFromContent = `${edition.edition.date}-${edition.edition.slot}`;
    if (slugFromName !== slugFromContent) {
      throw new Error(
        `❌ ${file}: Dateiname passt nicht zu edition.date/slot (${slugFromContent}).`
      );
    }
    console.log(`✅ ${file} – Ausgabe Nr. ${edition.edition.number}, ${edition.articles.length} Artikel`);
  } catch (err) {
    console.error(err.message);
    failed = true;
  }
}

if (failed) {
  console.error("\nBuild abgebrochen: mindestens eine Edition ist invalide.");
  process.exit(1);
}
console.log(`\nAlle ${files.length} Edition(en) valide.`);
