import { handler } from "./netlify/functions/api.js"

const race = process.argv[2] || "1";
const event = {
  httpMethod: "GET",
  path: `/api/predict/ST/${race}`,
}

async function run() {
  const res: any = await handler(event as any, {} as any);
  if (res && res.body) {
    const data = JSON.parse(res.body);
    const p10 = data.predictions.find((p: any) => String(p.runnerNumber) === "10");
    if (!p10) {
      console.log(`No runner 10 in Race ${race}`);
      return;
    }
    
    // Log what the server actually calculated for top 4
    const validPredictions = data.predictions.filter((p: any) => !String(p.runnerNumber).startsWith("R"));
    const uniqueWinProbs = Array.from(new Set(validPredictions.map((p: any) => p.winProbModel))).sort((a: any, b: any) => b - a);
    const top4ProbThreshold = uniqueWinProbs.length >= 4 ? uniqueWinProbs[3] : uniqueWinProbs[uniqueWinProbs.length - 1];
    const top4Numbers = validPredictions.filter((p: any) => p.winProbModel >= top4ProbThreshold).map((p: any) => String(p.runnerNumber));

    console.log(`Prediction #10 in Race ${race}:`, {
      runnerName: p10.runnerName,
      winOdds: p10.winOdds,
      modelOdds: p10.modelOdds,
      winProbModel: p10.winProbModel,
      top4Threshold: top4ProbThreshold,
      top4Numbers,
      isTop4: top4Numbers.includes("10"),
      isBlueStar: p10.isBlueStar,
      raceTypeCode: data.oddsStructure?.raceTypeCode
    });
  } else {
    console.log("No body", res);
  }
}
run().catch(console.error);