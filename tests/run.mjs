// npm test: parser + ratings tests (no network).
import { spawnSync } from "child_process";
let bad = 0;
for (const f of ["routes.test.mjs", "ratings.test.mjs", "engine.test.mjs", "datajob.test.mjs", "tracker.test.mjs", "bets.test.mjs", "betsapi.test.mjs"]) { const r = spawnSync(process.execPath, [new URL(f, import.meta.url).pathname], { stdio: "inherit" }); bad += r.status ? 1 : 0; }
process.exit(bad ? 1 : 0);
