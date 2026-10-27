/* Optional real-AI tier. Only used when ANTHROPIC_API_KEY is set in the
 * environment (never read from the frontend, never committed — see
 * .env.example). When absent, index.js falls back to genuine local OCR +
 * deterministic heuristic grading (ocr.js / grading.js) instead of this.
 */
const Anthropic = require('@anthropic-ai/sdk');

function isClaudeConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || '').trim();
}

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model did not return a JSON object.');
  return JSON.parse(match[0]);
}

async function evaluateWithClaude(payload, files) {
  const anthropic = client();
  const imageBlocks = files.map(f => ({
    type: 'image',
    source: { type: 'base64', media_type: f.mimetype || 'image/jpeg', data: f.buffer.toString('base64') },
  }));
  const prompt = `You are assisting a teacher by reading photographed handwritten answer sheets and comparing them to an approved marking scheme. Respond with ONLY a single JSON object matching this exact shape, no other text, no markdown fences:
{"ocr":{"overallConfidence":0-1,"extractedText":[{"questionId":"...","text":"...","confidence":0-1}]},"grading":{"suggestedTotal":number,"questionResults":[{"questionId":"...","suggestedMarks":number,"maxMarks":number,"reasoning":"...","misconceptions":["..."],"confidence":0-1,"flags":["..."]}]}}
Allowed flags: illegible_handwriting, low_confidence_ocr, uncertain_question_match, ambiguous_grading. Use a flag and a lower confidence whenever you are not sure, rather than guessing a mark. Never invent an answer you cannot actually read in the images, and never award marks for a question you cannot clearly match to an answer in the images.

Board: ${payload.board}, Class: ${payload.class}, Subject: ${payload.subject}.
Expected level: ${payload.expectedLevel && payload.expectedLevel.label}.
Questions (this is the approved answer key and marking scheme — grade against this, not your own judgment of what's "right"):
${JSON.stringify(payload.questions, null, 2)}`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

async function generateWithClaude(body) {
  const anthropic = client();
  const prompt = `Generate exam questions for a classroom assignment, grounded ONLY in the lecture content given below — never invent facts the lecture content doesn't contain, and never fabricate a correct answer you can't support from that content. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"questions":[{"type":"mcq|short|long|sum","text":"...","options":["..."] or null,"correctIndex":number or null,"suggestedAnswer":"...","markingScheme":"...","topicTag":"...","difficulty":"easy|medium|hard","marks":number}]}

Lecture topic: ${body.topic}. Chapter: ${body.chapter}. Board: ${body.board}. Class: ${body.class}. Subject: ${body.subject}.
Expected class level: ${body.expectedLevel && body.expectedLevel.label} (${body.expectedLevel && body.expectedLevel.style}; expected answer length: ${body.expectedLevel && body.expectedLevel.answerLength}).
Lecture content to generate from (objectives / reference notes / description / transcript — use only this):
${JSON.stringify(body.groundingSources || {}, null, 2)}
Requested question counts and marks: ${JSON.stringify(body.config || {})}
If the lecture content above is too sparse to responsibly generate the requested questions, generate fewer questions rather than inventing content.`;
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

async function generateLessonPlanWithClaude(body) {
  const anthropic = client();
  const prompt = `Generate a classroom lesson plan, grounded ONLY in the lecture content given below — never invent facts the lecture content doesn't contain, and never fabricate activities or content it doesn't support. Respond with ONLY a single JSON object, no other text, no markdown fences:
{"objectives":["..."],"materials":["..."],"warmUp":"...","steps":[{"activity":"...","duration":"...","description":"..."}],"assessmentChecks":["..."],"homework":"...","durationMinutes":number}

Lecture topic: ${body.topic}. Chapter: ${body.chapter}. Board: ${body.board}. Class: ${body.class}. Subject: ${body.subject}.
Expected class level: ${body.expectedLevel && body.expectedLevel.label} (${body.expectedLevel && body.expectedLevel.style}; expected answer length: ${body.expectedLevel && body.expectedLevel.answerLength}).
Lecture content to generate from (objectives / reference notes / description / transcript — use only this):
${JSON.stringify(body.groundingSources || {}, null, 2)}
If the lecture content above is too sparse to responsibly generate a full lesson plan, generate fewer steps rather than inventing content.`;
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

/* Phase 13: open-ended mistake analysis for submissions that don't have an
 * approved question set to grade against (general submissions, written
 * text answers, or any photo/document a student submits for self-review).
 * Distinct from evaluateWithClaude: that one grades strictly against a
 * teacher-approved marking scheme; this one reviews freeform work and
 * explains mistakes in student-friendly language, with no marking scheme
 * input and no score output — it is never treated as an official grade.
 */
async function analyzeMistakesWithClaude(payload, files){
  const anthropic = client();
  const content = [];
  if (files && files.length) {
    for (const f of files) {
      if (f.mimetype === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.buffer.toString('base64') } });
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.mimetype || 'image/jpeg', data: f.buffer.toString('base64') } });
      }
    }
  }
  const basis = payload.kind === 'text'
    ? `The student's typed written answer is given below — read it directly, no OCR needed:\n"""${payload.textAnswer}"""`
    : `The student's work is attached as ${payload.kind === 'document' ? 'a document' : 'photographed image(s)'}. Read it as carefully as you can.`;
  const prompt = `You are a patient CBSE tutor reviewing a Class ${payload.class} ${payload.subject} student's submitted work titled "${payload.title}", so you can point out mistakes and explain them in age-appropriate language the student can learn from.
${basis}
If the handwriting or scan is too unclear to confidently read a part of the answer, do not guess — mark that item's assessment as "uncertain" and explain what's unclear instead of inventing content.
Respond with ONLY a single JSON object matching this exact shape, no other text, no markdown fences:
{"overallAssessment":"correct|partially_correct|incorrect|uncertain","summary":"one or two sentence overview for the student","items":[{"excerpt":"the student's original answer or the relevant section, quoted or closely paraphrased from what you can actually read","assessment":"correct|partially_correct|incorrect|uncertain","mistake":"what's wrong, or null if correct","explanation":"simple age-appropriate reason why","correction":"the corrected answer or proper form","steps":["step-by-step reasoning, only for math problems, else omit"],"tip":"a short learning tip to avoid this mistake next time"}],"flags":["illegible_handwriting","low_confidence","needs_teacher_review"],"suggestedTopics":["a short topic keyword for self-guided review, e.g. fractions","another short keyword, 3-5 total"]}
suggestedTopics must be short topic/keyword strings only (never a resource title, URL, or description — the caller matches these keywords against its own resource library, so do not invent resource names). Omit suggestedTopics or return an empty array if the submission is fully correct.
Board: ${payload.board}. Keep language simple and encouraging, suitable for a Class ${payload.class} student.`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: [...content, { type: 'text', text: prompt }] }],
  });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return extractJson(text);
}

module.exports = { isClaudeConfigured, evaluateWithClaude, generateWithClaude, generateLessonPlanWithClaude, analyzeMistakesWithClaude };
