# EduPilot AI — Mistake Analysis Backend Contract (Phase 13)

Like evaluation and assignment generation, mistake analysis needs a
**backend you deploy and control**, holding your AI provider credentials
server-side. The frontend's `AIMistakeAnalysisService.analyze()` (in
`index.html`) calls the URL configured on the **Settings** page. If that
field is empty, or the request fails, the app reports this honestly in the
student's submission view — it never fabricates a result.

This is a separate capability from the Evaluation Backend
(`EVALUATION_BACKEND.md`): evaluation grades a submission strictly against
a teacher-approved question set and marking scheme. Mistake analysis is
open-ended self-review for any submission — a written answer, a photo, or
a PDF — including ones with no linked assignment at all, so it needs its
own simpler contract.

## 1. Request

`POST <your-endpoint-url>`

Content-Type: `multipart/form-data`:

- `payload` — a JSON string (see shape below)
- `files` — zero or more files. Omitted entirely for `kind: "text"`
  (the answer text is already in `payload`); one or more images for
  `kind: "image"`; a single PDF for `kind: "document"` (other document
  types are not sent — the frontend only offers this action for PDFs,
  since reliably extracting DOC/DOCX text server-side needs its own
  library this project does not bundle)

```jsonc
// payload (stringified JSON)
{
  "title": "My Essay on Water Cycle",
  "board": "cbse",             // or "karnataka"
  "class": "5",
  "subject": "English",
  "kind": "text",               // "text" | "image" | "document"
  "textAnswer": "The water cycle describes..."   // present only for kind:"text", else null
}
```

## 2. Response

`200 OK`, JSON body:

```jsonc
{
  "overallAssessment": "correct",   // "correct" | "partially_correct" | "incorrect" | "uncertain"
  "summary": "Good overall explanation of the water cycle, with one small gap.",
  "items": [
    {
      "excerpt": "Water evaporates, forms clouds, and falls as rain.",
      "assessment": "partially_correct",
      "mistake": "Doesn't mention condensation as the step between evaporation and cloud formation.",
      "explanation": "Water vapour has to cool and condense into tiny droplets before clouds form — that step was skipped.",
      "correction": "Water evaporates, cools and condenses into clouds, then falls as rain (precipitation).",
      "steps": null,              // array of strings for math workings, else null
      "tip": "Remember the four stages in order: evaporation, condensation, precipitation, collection."
    }
  ],
  "flags": []                      // e.g. "illegible_handwriting", "low_confidence", "needs_teacher_review"
}
```

Never invent an answer the model cannot actually read — when handwriting or
a scan is unclear, that item's `assessment` should be `"uncertain"` with an
explanation of what's unclear, not a guessed result.

## 3. No results without a real model

If no AI provider is configured, respond `501` with
`{"errorCode":"NOT_CONFIGURED","message":"..."}`. There is deliberately no
local OCR/heuristic fallback here (unlike grading against a known question
set) — explaining *why* an answer is wrong requires real reasoning, and a
fabricated explanation would be actively misleading to a student. The
frontend shows this message as-is and never substitutes a fake analysis.

## 4. Security

Same requirements as `EVALUATION_BACKEND.md`: hold provider credentials
server-side only, validate upload size/type, don't log student work longer
than needed to serve the request, and enforce your own authentication —
this demo's role switch is not a real access-control boundary.

## 5. Reference implementation

`server/lib/claude.js` (`analyzeMistakesWithClaude`) and the
`POST /analyze-mistakes` route in `server/index.js` implement this contract
using the Claude API, reusing the same client setup as evaluation and
assignment generation. Run `cd server && npm start` and point Settings →
AI Mistake Analysis Backend at `http://127.0.0.1:8787/analyze-mistakes`.
