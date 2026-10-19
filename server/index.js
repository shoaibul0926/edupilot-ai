require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { recognizeImages, terminateWorker } = require('./lib/ocr');
const { gradeWithHeuristics } = require('./lib/grading');
const { isClaudeConfigured, evaluateWithClaude, generateWithClaude, analyzeMistakesWithClaude } = require('./lib/claude');

const app = express();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
const PORT = process.env.PORT || 8787;

// Demo-only CORS: wide open so a locally-opened EduPilot AI frontend can
// reach this from any origin/port. Do not deploy this as-is to the public
// internet — see README.md "Security notice."
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, mode: isClaudeConfigured() ? 'claude-vision' : 'tesseract-heuristic' });
});

// Matches the contract in ../EVALUATION_BACKEND.md
app.post('/evaluate', upload.array('images'), async (req, res) => {
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
app.post('/generate-assignment', async (req, res) => {
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

// Matches the contract in ../MISTAKE_ANALYSIS_BACKEND.md. Open-ended mistake
// analysis for submissions with no approved question set to grade against
// (Phase 13). There is no local heuristic fallback, for the same reason as
// /generate-assignment: explaining *why* something is wrong requires real
// reasoning, not just OCR text extraction, so without a configured model
// this reports NOT_CONFIGURED honestly instead of fabricating an analysis.
app.post('/analyze-mistakes', upload.array('files'), async (req, res) => {
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
