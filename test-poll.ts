import { handler } from "./netlify/functions/poll-odds.ts"
import { config } from "dotenv"
config({ path: ".env" })

async function run() {
  console.log("Running poll-odds...")
  const res = await handler({} as any, {} as any)
  console.log("Result:", res)
}
run()
