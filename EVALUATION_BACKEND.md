# EduPilot AI — Evaluation Backend Contract (Phase 5)

EduPilot AI's frontend is a single static HTML file with no server of its own.
It never holds, embeds, or sends an OCR/vision AI provider's API key — doing
so in client-side JavaScript would expose it to anyone who views the page
source. Real OCR and AI evaluation of handwritten submissions therefore
requires a **backend you deploy and control**, which holds your provider
credentials server-side and does the actual OCR + grading work.

The frontend's `AIEvaluationService.evaluateSubmission()` (in `index.html`)
makes a real `fetch()` call to the URL you configure on the **Settings**
page. If that field is empty, or the request fails, the app reports this
honestly in the UI — it never fabricates a result and labels it "AI output."

This document specifies the contract your backend must implement, and the
security and privacy requirements it must meet, since it will be handling
students' handwritten work.

## 1. Request

`POST <your-endpoint-url>`

Content-Type: `multipart/form-data`, with two parts:

- `payload` — a JSON string (see shape below)
- `images` — one or more image files (JPEG/PNG/WEBP), the student's
  photographed answer sheets, in the order the teacher attached them

```jsonc
// payload (stringified JSON)
{
  "submissionId": "sub_xxxxx",
  "assignmentId": "asg_xxxxx",
  "board": "cbse",
  "class": "5",
  "subject": "Mathematics",
  "expectedLevel": {
    "label": "Elementary (Classes 3-5)",
    "style": "simple, clear language with everyday examples",
    "answerLength": "one to two short sentences"
  },
  "questions": [
    {
      "id": "q_xxxxx",
      "type": "mcq",                 // "mcq" | "short" | "long" | "sum"
      "text": "Which one of these is correct about \"Adding like fractions\"?",
      "options": ["...", "...", "...", "..."],  // mcq only, else null
      "correctIndex": 1,                         // mcq only, else null
      "suggestedAnswer": "Add two fractions with the same denominator",
      "markingScheme": "Award full marks (1) for selecting option B; 0 marks otherwise.",
      "marks": 1,
      "topicTag": "Adding like fractions"
    }
  ]
}
```

The `questions` array comes directly from a **teacher-approved** assignment
(status `Approved` or `Published` in the Assignment Generator) — your backend
should treat it as the answer key and rubric to grade against, not invent its
own. Independently re-verify server-side that `assignmentId` actually owns
this question set in your own database before grading; never trust a client
to assert that a marking scheme has been approved.

## 2. Response

On success, `200 OK` with:

```jsonc
{
  "ocr": {
    "overallConfidence": 0.86,           // 0–1
    "extractedText": [
      { "questionId": "q_xxxxx", "text": "...transcribed handwriting...", "confidence": 0.91 }
    ]
  },
  "grading": {
    "suggestedTotal": 7,
    "questionResults": [
      {
        "questionId": "q_xxxxx",
        "suggestedMarks": 1,
        "maxMarks": 1,
        "reasoning": "Student correctly identified the matching objective.",
        "misconceptions": [],              // short strings, or []
        "confidence": 0.9,                 // 0–1, grading confidence (distinct from OCR confidence)
        "flags": []                        // see §3
      }
    ]
  }
}
```

On failure, a non-2xx status with a plain-text or JSON body describing the
error; the frontend surfaces your status code and body to the teacher
verbatim, so make the message actionable.

The frontend always routes a successful response into a **teacher review
screen** — extracted text and marks are editable, and nothing is written to
the student's official score until the teacher clicks Approve. Your backend
must never be the thing that finalizes a grade.

## 3. Required flags

Per-question `flags` (array of strings) should be set whenever applicable, so
the frontend can surface them instead of silently guessing:

- `illegible_handwriting` — OCR could not confidently read the answer
- `low_confidence_ocr` — text was extracted but confidence is below your threshold
- `uncertain_question_match` — unclear which question this answer belongs to
- `ambiguous_grading` — the answer doesn't clearly map to full/zero marks

When any of these apply, prefer a lower `confidence` and a clear note in
`reasoning` over guessing a specific mark — the UI treats every result as
"needs teacher review" regardless, but these flags make genuinely uncertain
cases visible rather than buried among confident ones.

## 4. Security and privacy requirements

Handwritten student work and scores are sensitive. Your backend must, at minimum:

- **Authenticate every request.** This demo frontend has no login system —
  do not deploy your backend without adding your own auth (e.g. a signed
  session token or API key issued to the teacher's account) and check it on
  every call. An unauthenticated endpoint that accepts arbitrary images and
  returns grading data is not safe to expose publicly.
- **Authorize per-student access on every read, not just on upload.** The
  per-student performance view (evidence, topic mastery, AI-suggested
  feedback) calls the same backend surface to read records back. Before
  returning anything, check server-side that the authenticated teacher is
  actually assigned to that student's class/section — never trust a
  student name or ID supplied by the client as proof of authorization.
  The frontend's role switch (Teacher/Student/Administrator) is a UI
  convenience only; it enforces nothing.
- **Verify the student's own identity for the student-facing feedback
  view.** This demo's "Who are you?" picker lets anyone select any
  student's name on the client — it is explicitly a stand-in for a real
  login, not a security control. A real backend must derive the requesting
  student's identity from their authenticated session and return only
  *that* student's own published feedback, ignoring (or rejecting) any
  student name/ID the client tries to supply. It must also never return a
  `Draft`, `Pending Teacher Review`, or `Approved`-but-not-`Published`
  feedback record to a student under any circumstance, nor a teacher's
  private notes.
- **Keep provider credentials server-side only** — environment variables or
  a secrets manager, never committed to source control, never sent to the client.
- **Re-validate uploads server-side**: file type (magic-byte sniffing, not
  just the client's claimed MIME type), file size, and image dimensions.
  Never trust client-side validation alone.
- **Verify the question set belongs to the assignment** named in the
  payload, from your own database — don't grade against whatever marking
  scheme the client happens to send.
- **Minimize retention.** Store uploaded images only as long as needed for
  grading and teacher review, then delete them (or encrypt at rest with a
  retention policy) per your institution's data policy. Do not log raw
  image bytes or full extracted text in plaintext application logs.
- **Encrypt in transit** (HTTPS only) and **at rest** for anything you do
  retain.
- **Rate-limit and size-limit** requests to control cost and abuse.
- **Comply with applicable student-data regulations** for your jurisdiction
  (e.g. FERPA in the US, or your local equivalent) — this is a product
  decision for you to make with appropriate legal review, not something
  this reference implementation can certify.

## 5. Minimal illustrative sketch

This is **not** a production server — no auth, no validation, no error
handling beyond the basics. It exists only to show the shape of a real
implementation using Node/Express and a vision-capable LLM provider's SDK.
Replace the provider call with whatever OCR/vision AI service you choose,
and add everything listed in §4 before deploying it anywhere real.

```js
// server/evaluate.js  (illustrative only — not production-ready)
import express from 'express';
import multer from 'multer';

const app = express();
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });

app.post('/api/ai/evaluate-submission', upload.array('images'), async (req, res) => {
  // TODO: authenticate the request before doing anything else.
  let payload;
  try {
    payload = JSON.parse(req.body.payload);
  } catch {
    return res.status(400).send('Invalid payload JSON.');
  }
  // TODO: verify payload.assignmentId owns payload.questions in your own DB.
  // TODO: re-validate req.files (type/size/dimensions) server-side.

  try {
    // Call your chosen OCR/vision-capable AI provider here, passing
    // req.files (the images) and payload.questions (the answer key +
    // marking scheme). Keep the provider's API key in process.env, never
    // in source control.
    const result = await callYourVisionAIProvider(req.files, payload);
    res.json(result); // must match the §2 response shape
  } catch (err) {
    res.status(502).send('Evaluation provider error: ' + err.message);
  }
});

export default app;
```

## 6. Configuring the frontend

Once your backend is deployed, open **Settings → AI Evaluation Backend** in
EduPilot AI and paste its URL. The frontend stores this in `localStorage`
(plain text, as with everything else in this browser-only demo — it is not
a secret, since it's just a URL) and uses it for every "AI Evaluate" action
on the Student Submissions page from then on.
