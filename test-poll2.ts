import * as dotenv from "dotenv"
dotenv.config()
import { handler } from "./netlify/functions/poll-odds"

async function test() {
  const result = await handler({ queryStringParameters: { force: 'true' }, headers: {} } as any, {} as any)
  console.log(result)
}
test()
