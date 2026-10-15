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

module.exports = { isClaudeConfigured, evaluateWithClaude, generateWithClaude };
