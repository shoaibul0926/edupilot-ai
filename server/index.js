require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { recognizeImages, terminateWorker } = require('./lib/ocr');
const { gradeWithHeuristics } = require('./lib/grading');
const { isClaudeConfigured, evaluateWithClaude, generateWithClaude, generateLessonPlanWithClaude, analyzeMistakesWithClaude, discoverResourcesWithClaude } = require('./lib/claude');

const app = express();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
const PORT = process.env.PORT || 8787;

// CORS: by default, allows a locally-opened EduPilot AI frontend to reach
// this from any localhost/127.0.0.1 port, for local development. When
// deploying this publicly (e.g. so the hosted demo can opt into real AI
// via Settings), set ALLOWED_ORIGINS to a comma-separated list of exact
// origins — e.g. your Vercel demo's URL — so arbitrary sites can't drive
// paid API calls through this server from a browser. This does not stop
// direct (non-browser) requests to a public URL; see README.md "Security
// notice" for what a real production deployment still needs on top.
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const extraOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || LOCAL_ORIGIN_RE.test(origin) || extraOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed by CORS: ' + origin));
  },
}));
app.use(express.json({ limit: '2mb' }));

// Every AI-backed route costs real money once ANTHROPIC_API_KEY is funded.
// This is a blunt per-IP cap, not real abuse protection (no auth exists at
// all here) — it exists so a stray script or a burst of clicks can't burn
// through a small credit balance unattended. Tune via env if needed.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AI_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { errorCode: 'RATE_LIMITED', message: 'Too many AI requests from this client — please wait a few minutes and try again.' },
});

app.get('/health', (req, res) => {
  res.json({ ok: true, mode: isClaudeConfigured() ? 'claude-vision' : 'tesseract-heuristic' });
});

// Matches the contract in ../EVALUATION_BACKEND.md
app.post('/evaluate', aiLimiter, upload.array('images'), async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.payload);
  } catch {
    return res.status(400).send('Invalid or missing `payload` field (must be a JSON string).');
  }
  if (!payload || !Array.isArray(payload.questions) || !payload.questions.length) {
    return res.status(400).send('payload.questions must be a non-empty array.');
  }
  const files = req.files || [];
  if (!files.length) return res.status(400).send('At least one image is required in the `images` field.');

  try {
    if (isClaudeConfigured()) {
      const result = await evaluateWithClaude(payload, files);
      return res.json(result);
    }
    const ocrResults = await recognizeImages(files.map(f => f.buffer));
    const result = gradeWithHeuristics(payload, ocrResults);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(502).send('Evaluation failed: ' + (err && err.message ? err.message : 'unknown error'));
  }
});

// Matches the contract in ../ASSIGNMENT_GENERATOR_BACKEND.md. There is no
// local heuristic fallback for this one — generating new question text
// without any real language model would mean fabricating lecture content,
// which this project does not do. Without ANTHROPIC_API_KEY, the frontend
// is expected to use its own built-in deterministic demo generator instead
// (see AIService.generateAssignmentQuestions in index.html).
app.post('/generate-assignment', aiLimiter, async (req, res) => {
  if (!isClaudeConfigured()) {
    return res.status(501).json({
      errorCode: 'NOT_CONFIGURED',
      message: 'No ANTHROPIC_API_KEY is set on this server, so real question generation is unavailable. The frontend will fall back to its built-in demo generator.',
    });
  }
  try {
    const result = await generateWithClaude(req.body || {});
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(502).send('Generation failed: ' + (err && err.message ? err.message : 'unknown error'));
  }
});

// Matches the contract in ../LESSON_PLAN_BACKEND.md. There is no local
// fallback, for the same reason as /generate-assignment: generating a lesson
// plan requires real reasoning grounded in the lecture content, not a
// deterministic transform, so without a configured model this reports
// NOT_CONFIGURED honestly instead of fabricating a plan.
app.post('/generate-lesson-plan', aiLimiter, async (req, res) => {
  if (!isClaudeConfigured()) {
    return res.status(501).json({
      errorCode: 'NOT_CONFIGURED',
      message: 'No ANTHROPIC_API_KEY is set on this server, so real lesson plan generation is unavailable. The frontend will fall back to its built-in demo generator.',
    });
  }
  try {
    const result = await generateLessonPlanWithClaude(req.body || {});
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(502).send('Generation failed: ' + (err && err.message ? err.message : 'unknown error'));
  }
});

// Matches the contract in ../MISTAKE_ANALYSIS_BACKEND.md. Open-ended mistake
// analysis for submissions with no approved question set to grade against
// (Phase 13). There is no local heuristic fallback, for the same reason as
// /generate-assignment: explaining *why* something is wrong requires real
// reasoning, not just OCR text extraction, so without a configured model
// this reports NOT_CONFIGURED honestly instead of fabricating an analysis.
app.post('/analyze-mistakes', aiLimiter, upload.array('files'), async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.payload);
  } catch {
    return res.status(400).send('Invalid or missing `payload` field (must be a JSON string).');
  }
  if (!payload || !payload.kind) return res.status(400).send('payload.kind is required.');
  if (payload.kind === 'text' && !(payload.textAnswer || '').trim()) {
    return res.status(400).send('payload.textAnswer is required for kind "text".');
  }
  const files = req.files || [];
  if (payload.kind !== 'text' && !files.length) {
    return res.status(400).send('At least one file is required in the `files` field for non-text submissions.');
  }

  if (!isClaudeConfigured()) {
    return res.status(501).json({
      errorCode: 'NOT_CONFIGURED',
      message: 'No ANTHROPIC_API_KEY is set on this server, so AI mistake analysis is unavailable. There is no local heuristic fallback for open-ended analysis (unlike grading against an approved question set) — configure a key to enable it.',
    });
  }
  try {
    const result = await analyzeMistakesWithClaude(payload, files);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(502).send('Analysis failed: ' + (err && err.message ? err.message : 'unknown error'));
  }
});

// Matches the contract in ../RESOURCE_DISCOVERY_BACKEND.md. There is no
// local heuristic fallback for this one — turning a free-text prompt into
// well-targeted search ideas requires real reasoning, not a deterministic
// transform, so without a configured model this reports NOT_CONFIGURED
// honestly instead of fabricating generic results. (The frontend still has
// its own simpler, clearly-labeled demo template so the UI never dead-ends.)
app.post('/discover-resources', aiLimiter, async (req, res) => {
  if (!isClaudeConfigured()) {
    return res.status(501).json({
      errorCode: 'NOT_CONFIGURED',
      message: 'No ANTHROPIC_API_KEY is set on this server, so AI resource curation is unavailable. The frontend will fall back to its built-in demo template.',
    });
  }
  try {
    const result = await discoverResourcesWithClaude(req.body || {});
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(502).send('Discovery failed: ' + (err && err.message ? err.message : 'unknown error'));
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && String(err.message || '').startsWith('Origin not allowed by CORS')) {
    return res.status(403).json({ errorCode: 'ORIGIN_NOT_ALLOWED', message: err.message });
  }
  console.error(err);
  res.status(500).json({ errorCode: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
});

const server = app.listen(PORT, () => {
  console.log(`EduPilot AI reference backend listening on http://127.0.0.1:${PORT}`);
  console.log(`Mode: ${isClaudeConfigured() ? 'Claude vision/text AI (ANTHROPIC_API_KEY set)' : 'Local OCR + heuristic grading only (no ANTHROPIC_API_KEY — see README.md)'}`);
});

async function shutdown() {
  await terminateWorker();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
