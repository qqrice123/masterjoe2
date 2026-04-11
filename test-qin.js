import { HorseRacingAPI, HKJCClient } from "hkjc-api"
import { horseOddsQuery } from "hkjc-api/dist/query/horseRacingQuery.js"

const hkjcClient = new HKJCClient()

async function test() {
  const res = await hkjcClient.request(horseOddsQuery, {
    date: "2026-04-12",
    venueCode: "ST",
    raceNo: 1,
    oddsTypes: ["QIN"],
  })
  console.log(JSON.stringify(res.raceMeetings[0].pmPools[0].oddsNodes.slice(0, 3), null, 2))
}
test()
