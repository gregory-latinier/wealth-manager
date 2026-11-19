import { pool } from '../db/index'
import { runSnapshot } from '../lib/snapshot'
import { createFrankfurter } from '../sources/fx/frankfurter'
import { getSources } from '../sources/registry'

// Takes a snapshot straight from the command line, without the HTTP endpoint.
// Dev:  pnpm --filter server snapshot:run
// Prod: node dist/scripts/snapshot-run.js   (needs DATABASE_URL in the environment)
async function main() {
  const summary = await runSnapshot({ sources: getSources(), fx: createFrankfurter() })
  console.log(JSON.stringify(summary, null, 2))
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
