# Master Joe Racing - 系統階段性功能文件 (Phase 1.5)

## 📌 系統簡介
Master Joe Racing 是一個專為香港賽馬（HKJC）打造的「資金流與賽局結構分析系統」。核心理念在於透過即時賠率數據，逆向推算幕後資金流向（Smart Money），並結合 EV（預期價值）與 AI 權重模型，為使用者提供高勝率或高值博率的投注決策輔助。

---

## 🎯 核心功能模組 (已完成)

### 1. 賽局結構定調 (Odds Structure Analysis)
- **原理**：透過分析前四熱門（od1~od4）的賠率結構與比例，自動將賽事歸類為三種基本型態，為後續分析定調：
  - **馬膽局 (BANKER)**：大熱門賠率極低且穩固（如 `< 2.5`），適合尋找冷腳拖位置。
  - **分立局 (SPLIT)**：兩至三匹熱門馬勢均力敵，互相擠壓賠率，容易出現冷門偷襲。
  - **混亂局 (CHAOTIC)**：大熱門賠率偏高（如 `> 3.5`）或全場資金分散，強烈建議尋找具備正 EV 值的冷門博大霧。

### 2. 資金流向與堆疊圖表 (Money Flow & Stacked Bar Chart)
- **彩池聚合演算法 (Aggregation)**：
  - 將 HKJC 以「組合」為單位的 QIN（連贏）與 QPL（位置Q）彩池，透過數學聚合，反推回單匹馬的「預估被投注額」。
- **視覺化堆疊**：
  - 柱狀圖由下而上疊加：`WIN (獨贏, 黃)` + `QIN (連贏, 橘)` + `QPL (位置Q, 紫)`。
  - **實戰找異常**：尋找「黃柱短（表面冷門），但橘柱或紫柱異常長（幕後資金托底）」的馬匹。

### 3. 異常資金警報系統 (Money Alerts)
- **大戶落飛 (Large Bet)**：比較過夜/賽前15分鐘賠率與當前賠率，跌幅 `≥ 20%` 時觸發，圖表顯示紅色圓點。
- **異常溢出 (Anomaly Overflow)**：當一匹馬的 QIN 或 QPL 預估資金大於其 WIN 資金的 1.2 倍 (`Ratio > 1.2`) 時，系統判定為「幕後搏殺位」。

### 4. EV 價值矩陣與 AI 動態學習 (EV Matrix & AI Engine)
- **EV 值計算**：比較「AI 模型推算勝率」與「公眾彩池隱含勝率」，找出被市場低估的正 EV 馬匹（粉紅標記）。
- **AILearningEngine (動態權重評分)**：
  - 根據不同賽局結構（馬膽/分立/混亂），賦予基礎勝率、EV 值、異常溢出比例、大戶警報不同的權重。
  - **賽後回饋機制**：使用者可輸入真實賽果（頭馬），系統會透過類似梯度下降（Gradient Descent）的演算法自動調整並儲存權重（LocalStorage），讓「AI首選（藍色1號標記）」越用越精準。

---

## 🛠️ 技術架構 (Tech Stack)
- **前端**：React 18 + Vite + Tailwind CSS + Recharts (圖表)
- **後端 (Serverless)**：Netlify Functions (`api.ts` 作為 GraphQL 代理與數據聚合層)
- **資料來源**：HKJC GraphQL API (透過 `hkjc-api` 封裝)
- **狀態管理**：React Query (`useQuery` 處理 30 秒自動輪詢與快取)

---

## 🚀 下一步開發計畫 (Next Steps / Phase 2.0)

### 1. 歷史數據庫與回測系統 (Neon DB Integration)
- **目標**：目前 AI 學習權重僅存在本地（LocalStorage），且賽果需手動輸入。下一步需將賽果與賽前最終賠率自動寫入雲端資料庫（如 Neon Serverless Postgres）。
- **用途**：支援「歷史賽事回測」，驗證不同權重組合在過去一個賽季的實際獲利表現（ROI）。

### 2. 進階圖表與時間序列分析 (Time-series Analytics)
- **目標**：在資金追蹤頁面補上 `WinPoolChart`（15分鐘歷史賠率折線圖）。
- **用途**：目前的「大戶落飛」是基於快照點（Snapshot）比對，若能視覺化連續的賠率急跌曲線（落飛加速度），對於捕捉最後 3 分鐘的「綠燈/啡燈」資金將更為直覺。

### 3. 跨場次彩池追蹤 (DBL / TT / SixUP)
- **目標**：目前已在 UI 預留了 DBL（孖寶）欄位，但尚未實作跨場次資金分析。
- **用途**：透過分析「孖寶」或「三T」等大彩池的資金分佈，可以提前預判下一場次甚至下下場次的大戶目標馬（即所謂的「過關膽」）。

### 4. 效能與架構優化 (Refactoring)
- **目標**：將 `MoneyFlow.tsx` 與 `AnalyticsDashboard/index.tsx` 中過於龐大的元件進一步拆分為獨立的子組件（如 `InvestmentChart`, `OddsTable` 等）。
- **用途**：提升程式碼可維護性，並透過更細粒度的 `React.memo` 減少 React Query 輪詢時不必要的 DOM 重繪。