import { Prediction } from "../../../services/api"

export interface LargeBetTransaction {
  type: "WIN" | "QIN" | "QPL"
  time: string
  runnerNumbers: string[] // for WIN it's [no], for QIN/QPL it's [no1, no2]
  odds: number
  amount: number
  isAlert: boolean
}

// Parses the 4-column parallel pasted text format
export function parsePastedLargeBets(text: string): LargeBetTransaction[] {
  if (!text) return []
  
  const lines = text.trim().split("\n").filter(l => l.trim().length > 0)
  const txns: LargeBetTransaction[] = []
  
  // Skip headers if present
  let startIndex = 0
  if (lines[0].includes("WIN交易") || lines[0].includes("時間")) {
    startIndex = 1
    if (lines[1] && lines[1].includes("時間")) {
      startIndex = 2
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const tokens = lines[i].split(/\s+/)
    if (tokens.length < 20) continue // Expecting 4 groups of 5 columns = 20 tokens

    // 1. WIN Group 1 (Tokens 0-4)
    if (tokens[1] !== "-") {
      txns.push({
        type: "WIN",
        time: tokens[0],
        runnerNumbers: [tokens[1]],
        odds: parseFloat(tokens[2]),
        amount: parseAmount(tokens[3]),
        isAlert: tokens[4] === "Y"
      })
    }

    // 2. WIN Group 2 (Tokens 5-9)
    if (tokens[6] !== "-") {
      txns.push({
        type: "WIN",
        time: tokens[5],
        runnerNumbers: [tokens[6]],
        odds: parseFloat(tokens[7]),
        amount: parseAmount(tokens[8]),
        isAlert: tokens[9] === "Y"
      })
    }

    // 3. QIN Group (Tokens 10-14)
    if (tokens[11] !== "-") {
      txns.push({
        type: "QIN",
        time: tokens[10],
        runnerNumbers: tokens[11].split(","),
        odds: parseFloat(tokens[12]),
        amount: parseAmount(tokens[13]),
        isAlert: tokens[14] === "Y"
      })
    }

    // 4. QPL Group (Tokens 15-19)
    if (tokens[16] !== "-") {
      txns.push({
        type: "QPL",
        time: tokens[15],
        runnerNumbers: tokens[16].split(","),
        odds: parseFloat(tokens[17]),
        amount: parseAmount(tokens[18]),
        isAlert: tokens[19] === "Y"
      })
    }
  }

  return txns
}

function parseAmount(amtStr: string): number {
  return parseFloat(amtStr.replace(/[^0-9.-]+/g, ""))
}

export function mergeLargeBetsIntoPredictions(predictions: Prediction[], txns: LargeBetTransaction[]): Prediction[] {
  if (!txns.length) return predictions

  // 1. Aggregate amounts per horse
  const horseAgg: Record<string, { win: number, qin: number, qpl: number, alertCount: number }> = {}
  
  predictions.forEach(p => {
    horseAgg[p.runnerNumber] = { win: 0, qin: 0, qpl: 0, alertCount: 0 }
  })

  txns.forEach(t => {
    if (t.type === "WIN") {
      const num = t.runnerNumbers[0]
      if (horseAgg[num]) {
        horseAgg[num].win += t.amount
        if (t.isAlert) horseAgg[num].alertCount++
      }
    } else if (t.type === "QIN" || t.type === "QPL") {
      // Split pool money evenly among combination members for simple estimation
      const num1 = t.runnerNumbers[0]
      const num2 = t.runnerNumbers[1]
      const splitAmount = t.amount / 2

      if (horseAgg[num1]) {
        if (t.type === "QIN") horseAgg[num1].qin += splitAmount
        else horseAgg[num1].qpl += splitAmount
        if (t.isAlert) horseAgg[num1].alertCount++
      }
      if (horseAgg[num2]) {
        if (t.type === "QIN") horseAgg[num2].qin += splitAmount
        else horseAgg[num2].qpl += splitAmount
        if (t.isAlert) horseAgg[num2].alertCount++
      }
    }
  })

  // 2. Clone and enrich predictions
  return predictions.map(p => {
    const agg = horseAgg[p.runnerNumber]
    if (!agg || (agg.win === 0 && agg.qin === 0 && agg.qpl === 0)) {
      return p
    }

    const newP = { ...p }
    
    // Override estimated investments with actual parsed data
    if (agg.win > 0) newP.estWinInvestment = agg.win
    if (agg.qin > 0) newP.estQINInvestment = agg.qin
    if (agg.qpl > 0) newP.estQPLInvestment = agg.qpl

    // Calculate ratio
    const qinTotal = agg.qin + agg.qpl
    const ratio = agg.win > 0 ? qinTotal / agg.win : 0

    // Evaluate Large Bet Alert based on your criteria
    // e.g. AlertCount > 0 AND Ratio > 1.5x
    if (agg.alertCount > 0 && ratio >= 1.5) {
      newP.moneyAlert = "large_bet"
    } else if (newP.moneyAlert === "large_bet" && agg.alertCount === 0) {
      // Reset if our manual data says no alerts
      newP.moneyAlert = "steady"
    }

    return newP
  })
}
