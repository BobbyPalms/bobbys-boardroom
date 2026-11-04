// Before each Cloudflare deploy: make sure the bet slips database (D1) exists and write wrangler.toml so the deploy
// binds it to the site's /api functions as DB. The tables themselves are created by the function on first use.
// If the Cloudflare key can't manage D1 yet, the site still deploys; /api answers "storage isn't connected yet".
import { writeFileSync } from "fs";
const { CF_TOKEN, CF_ACCOUNT, CF_PROJECT = "bobbys-boardroom" } = process.env, NAME = "bobbys-boardroom-bets";
const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database`;
const cf = (url, opts = {}) => fetch(url, { ...opts, headers: { Authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" } }).then(r => r.json().then(j => ({ status: r.status, j })));
const toml = id => [`name = "${CF_PROJECT}"`, `pages_build_output_dir = "dist"`, `compatibility_date = "2024-09-23"`,
  ...(id ? ["", "[[d1_databases]]", `binding = "DB"`, `database_name = "${NAME}"`, `database_id = "${id}"`] : []), ""].join("\n");
let id = null;
try {
  const list = await cf(`${base}?name=${NAME}`);
  if (!list.j.success) throw new Error(`can't list D1 databases (HTTP ${list.status}: ${list.j.errors?.[0]?.message || "error"})`);
  id = list.j.result.find(d => d.name === NAME)?.uuid || null;
  if (!id) {
    const made = await cf(base, { method: "POST", body: JSON.stringify({ name: NAME }) });
    if (!made.j.success) throw new Error(`can't create the D1 database (HTTP ${made.status}: ${made.j.errors?.[0]?.message || "error"})`);
    id = made.j.result.uuid;
    console.log(`created D1 database ${NAME}`);
  }
  console.log(`bet slips database: ${NAME} (${id})`);
} catch (e) {
  console.log(`::warning title=Bet slips storage not connected::${e.message}. Give the Cloudflare API token "Account · D1 · Edit" permission and the next deploy connects it.`);
}
writeFileSync("wrangler.toml", toml(id));
