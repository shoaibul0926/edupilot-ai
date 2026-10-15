/* Deterministic, explainable heuristic grading over genuine OCR text.
 * This is NOT an AI model and never pretends to be one — every suggested
 * mark traces back to a specific, statable reason, and anything this
 * logic can't actually determine is flagged and left at 0 marks for the
 * teacher to review, never guessed. See ../README.md and
 * ../../EVALUATION_BACKEND.md for the full contract and honesty rules.
 */

/* Convention: if the number of uploaded images exactly equals the number
 * of questions, image N is treated as the answer to question N (one
 * photographed page per question, same order as the question paper) —
 * this is a documented convention the teacher follows when photographing
 * pages, not a guess. Any other image count falls back to giving every
 * question the combined OCR text from all images, flagged
 * uncertain_question_match — splitting a multi-answer page into
 * per-question text without a vision-reasoning model is not something
 * plain OCR can honestly claim to do. */
function mapImagesToQuestions(questions, ocrResults) {
  if (ocrResults.length === questions.length) {
    return questions.map((q, i) => ({
      question: q, text: ocrResults[i].text, confidence: ocrResults[i].confidence, segmented: true,
    }));
  }
  const combinedText = ocrResults.map(r => r.text).filter(Boolean).join('\n---\n');
  const avgConfidence = ocrResults.length ? ocrResults.reduce((s, r) => s + r.confidence, 0) / ocrResults.length : 0;
  return questions.map(q => ({ question: q, text: combinedText, confidence: avgConfidence, segmented: false }));
}

const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

function detectSelectedOption(text, options) {
  const t = (text || '').toLowerCase();
  for (let i = 0; i < options.length && i < OPTION_LETTERS.length; i++) {
    const letter = OPTION_LETTERS[i];
    const patterns = [
      new RegExp(`\\boption\\s*${letter}\\b`), new RegExp(`\\bans(?:wer)?\\s*[:\\-]?\\s*${letter}\\b`),
      new RegExp(`\\(${letter}\\)`), new RegExp(`\\b${letter}\\)`), new RegExp(`\\b${letter}\\.`),
    ];
    if (patterns.some(p => p.test(t))) {
      return { index: i, basis: `matched a reference to option ${letter.toUpperCase()} in the extracted text` };
    }
  }
  const normalizedOptions = options.map(o => String(o || '').toLowerCase().trim());
  const hits = normalizedOptions.map((o, i) => (o.length >= 4 && t.includes(o) ? i : -1)).filter(i => i >= 0);
  if (hits.length === 1) return { index: hits[0], basis: "the text of one option appeared in the extracted text and no other option did" };
  return null;
}

function gradeQuestion(mapped) {
  const { question: q, text, confidence, segmented } = mapped;
  const flags = [];
  if (confidence < 0.5) flags.push('low_confidence_ocr');
  if (!text || text.replace(/\s/g, '').length < 2) flags.push('illegible_handwriting');
  if (!segmented) flags.push('uncertain_question_match');

  if (q.type === 'mcq' && Array.isArray(q.options)) {
    const detected = detectSelectedOption(text, q.options);
    if (detected) {
      const correct = detected.index === q.correctIndex;
      return {
        questionId: q.id, suggestedMarks: correct ? q.marks : 0, maxMarks: q.marks,
        reasoning: `Detected option ${OPTION_LETTERS[detected.index].toUpperCase()} (${detected.basis}); the approved answer key marks option ${OPTION_LETTERS[q.correctIndex].toUpperCase()} as correct.`,
        misconceptions: correct ? [] : [`Selected option ${OPTION_LETTERS[detected.index].toUpperCase()} instead of the correct option ${OPTION_LETTERS[q.correctIndex].toUpperCase()}.`],
        confidence: Math.min(confidence, 0.6), flags,
      };
    }
    flags.push('ambiguous_grading');
    return {
      questionId: q.id, suggestedMarks: 0, maxMarks: q.marks,
      reasoning: 'Could not confidently determine which option was selected from the OCR text alone — a handwritten circle or tick mark on a printed option is not something text OCR detects. Please check the original image.',
      misconceptions: [], confidence: 0.2, flags,
    };
  }

  // short / long / sum — never auto-graded without a real AI model
  flags.push('ambiguous_grading');
  return {
    questionId: q.id, suggestedMarks: 0, maxMarks: q.marks,
    reasoning: 'This reference backend only performs OCR text extraction for free-form answers (no AI grading key configured) — it does not attempt to judge correctness. Read the extracted text above and assign marks yourself against the marking scheme.',
    misconceptions: [], confidence: 0, flags,
  };
}

function gradeWithHeuristics(payload, ocrResults) {
  const mappedList = mapImagesToQuestions(payload.questions, ocrResults);
  const extractedText = mappedList.map(m => ({ questionId: m.question.id, text: m.text, confidence: m.confidence }));
  const questionResults = mappedList.map(gradeQuestion);
  const overallConfidence = ocrResults.length ? ocrResults.reduce((s, r) => s + r.confidence, 0) / ocrResults.length : 0;
  const suggestedTotal = questionResults.reduce((s, r) => s + r.suggestedMarks, 0);
  return {
    ocr: { overallConfidence, extractedText },
    grading: { suggestedTotal, questionResults },
  };
}

module.exports = { gradeWithHeuristics, mapImagesToQuestions, detectSelectedOption };
