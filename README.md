# EduPilot AI

An AI-powered teaching assistant demo for CBSE schools, Classes 1–10. Single static HTML file, no login — open `index.html` in a browser to run it.

**Live demo:** https://edupilot-ai-nine.vercel.app

Covers: AI resource discovery, assignment/question-paper generation, lesson plan generation, handwritten submission uploads, AI evaluation, student performance tracking with AI-suggested feedback, and a reference library with resource comparison.

## Running it

- **Frontend only (demo mode):** open `index.html` directly, or serve the folder with any static file server.
- **With a real AI backend:** see [`server/README.md`](server/README.md) — a working Node/Express reference backend that does real OCR grading and, with your own `ANTHROPIC_API_KEY`, real AI question generation, evaluation and mistake analysis. Run it locally, or deploy it (e.g. to Render, one-click via the included `render.yaml`) so the live demo can opt into it too — see "Deploying publicly" in `server/README.md`. Point Settings → the relevant Backend URL field at it once running, locally or deployed.

## Phase 10 — Testing & Demo Readiness

Full feature audit, live workflow testing, fixed defects, and a school-demo script: **[Phase 10 Report](https://claude.ai/artifact/QyMhJCGUcfV6XUow38MLRk)**
