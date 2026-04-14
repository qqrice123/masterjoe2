require('dotenv').config()
const { handler } = require("./netlify/functions/poll-odds.ts")

async function test() {
  const result = await handler({ queryStringParameters: { force: 'true' }, headers: {} }, {})
  console.log(result)
}
test()
