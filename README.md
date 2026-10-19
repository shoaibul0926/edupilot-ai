# EduPilot AI

An AI-powered teaching assistant demo for CBSE and Karnataka State Board schools, Classes 1–10. Single static HTML file, no login — open `index.html` in a browser to run it.

Covers: AI resource discovery, assignment/question-paper generation, handwritten submission uploads, AI evaluation, student performance tracking with AI-suggested feedback, and a reference library with resource comparison.

## Running it

- **Frontend only (demo mode):** open `index.html` directly, or serve the folder with any static file server.
- **With a real AI backend:** see [`server/README.md`](server/README.md) — a working Node/Express reference backend that does real OCR grading and, with your own `ANTHROPIC_API_KEY`, real AI question generation and evaluation. Point Settings → AI Evaluation Backend / Assignment Generator Backend at it once running.

## Phase 10 — Testing & Demo Readiness

Full feature audit, live workflow testing, fixed defects, and a school-demo script: **[Phase 10 Report](https://claude.ai/artifact/QyMhJCGUcfV6XUow38MLRk)**
