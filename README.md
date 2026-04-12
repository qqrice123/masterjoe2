# Master Joe Racing

A system for analyzing Hong Kong Jockey Club (HKJC) horse racing odds, smart money flow, and race structures.

## Setup

1. Configure environment variables (Vite, Neon, Web Push)
2. Install dependencies: `npm install`
3. Run development server: `npm run dev`

## Infrastructure

- **Frontend:** React + Vite + TailwindCSS
- **Backend (Serverless):** Netlify Functions
- **Database:** Neon PostgreSQL
- **Automation:** Netlify Scheduled Functions (Cron) + GitHub Actions (Neon Branching)
