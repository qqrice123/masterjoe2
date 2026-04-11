# Master Joe Racing - 系統階段性功能與架構文件 (Phase 1.6)

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
- **視覺化堆疊與色彩統一**：
  - 柱狀圖由下而上疊加：`WIN (獨贏, 黃 #fff005)` + `QIN (連贏, 橘 #ff9205)` + `QPL (位置Q, 紫 #f953f7)`。
  - 全站包含數據表、走勢圖、頂部彩池卡片皆套用一致的主題色，輔以 `PLA (位置, 藍 #05b0ff)`。
  - **實戰找異常**：尋找「黃柱短（表面冷門），但橘柱或紫柱異常長（幕後資金托底）」的馬匹。

### 3. 異常資金警報系統 (Money Alerts)
- **大戶落飛 (Large Bet)**：比較過夜/賽前15分鐘賠率與當前賠率，跌幅 `≥ 20%` 時觸發，圖表顯示紅色圓點。
- **異常溢出 (Anomaly Overflow)**：當一匹馬的 QIN 預估資金或 QPL 預估資金大於其 WIN 資金的 1.2 倍 (`Max(QIN/WIN, QPL/WIN) > 1.2`) 時，系統判定為「幕後搏殺位」。

### 4. AI 動態學習引擎 (AI Learning Engine v2)
- **EV 值計算**：比較「AI 模型推算勝率」與「公眾彩池隱含勝率」，找出被市場低估的正 EV 馬匹。
- **特徵值正規化 (Feature Normalization)**：將基礎勝率、EV值 (縮放至 `[-0.5, 1]`)、資金溢出比例 (縮放至 `[0, 1]`) 與大戶落飛指標，轉換為同等數量級的特徵向量，避免單一特徵主導權重。
- **賽後回饋機制 (Softmax + SGD)**：使用者輸入真實賽果後，系統透過 Softmax 計算機率分佈，並利用梯度下降法（Gradient Descent）自動更新特徵權重。
- **防禦性設計與穩健性 (Robustness)**：
  - **動態學習率 (Decaying LR)**：隨訓練次數自動遞減學習率，防止模型後期震盪。
  - **深層合併 (Deep Merge)**：解決 LocalStorage 淺拷貝導致擴展屬性遺失的問題。
  - **SSR Safe (Lazy Singleton)**：利用 `Proxy` 延遲初始化，完美相容 Next.js / Netlify 等伺服器渲染環境。
  - **防禦性拷貝 (Defensive Copying)**：更新過程中採用 `draft` 工作副本，確保原子性寫入，防止例外狀況導致狀態破損。

### 5. UI/UX 深度優化
- **行動端體驗 (Mobile First)**：將「自動 ON/OFF」與「手動刷新」按鈕移至手機版右下角懸浮按鈕區 (FAB)，釋放頂部空間。
- **無障礙與排版細節**：全面採用自訂 SVG 下拉箭頭，修正 `padding` 避免文字與箭頭重疊；加入 ARIA 標籤與防抖動 (Memoization) 優化渲染效能。

---

## 🛠️ 技術架構 (Tech Stack)
- **前端**：React 18 + Vite + Tailwind CSS + Recharts (圖表)
- **後端 (Serverless)**：Netlify Functions (`api.ts` 作為 GraphQL 代理與數據聚合層)
- **資料來源**：HKJC GraphQL API (透過 `hkjc-api` 封裝)
- **狀態管理**：React Query (`useQuery` 處理 30 秒自動輪詢與快取)

---

## 🚀 下一步開發計畫 (Next Steps / Phase 2.0)

### 1. 雲端蜂巢大腦與歷史回測 (Cloud DB & Auto-Learning)
- **目標**：從單機版的 LocalStorage 遷移至雲端資料庫（如 Neon Serverless Postgres）。
- **用途**：讓後端自動抓取官方派彩結果並更新「黃金權重」，實現所有人共享最強 AI；同時支援「歷史賽事回測」，驗證不同權重組合的實際獲利表現（ROI）。

### 2. 時間序列折線圖 (Time-series Analytics)
- **目標**：實作 15 分鐘歷史賠率折線圖。
- **用途**：目前的「大戶落飛」是基於快照點（Snapshot）比對，若能視覺化連續的賠率急跌曲線（落飛加速度），對於捕捉最後 3 分鐘的「綠燈/啡燈」資金將更為直覺。

### 3. 跨場次彩池追蹤 (DBL / TT)
- **目標**：實作 DBL（孖寶）與三T等跨場次資金的深入分析。
- **用途**：透過分析大彩池的資金分佈，提前預判下一場次的大戶目標馬（過關膽）。

### 4. 效能與架構優化 (Refactoring)
- **目標**：將 `MoneyFlow.tsx` 與 `AnalyticsDashboard/index.tsx` 等巨型元件進一步拆分為獨立子組件（如 `InvestmentChart`, `OddsTable` 等）。
- **用途**：提升程式碼可維護性，減少 React Query 輪詢時的 DOM 重繪負擔。