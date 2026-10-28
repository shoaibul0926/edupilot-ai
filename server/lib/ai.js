/* Picks whichever real-AI provider is configured. Prefers Gemini (checked
 * first) since Claude requires a funded ANTHROPIC_API_KEY; both implement
 * the same function shapes (see claude.js / gemini.js), so every route in
 * index.js just calls through this module without caring which backs it.
 */
const claude = require('./claude');
const gemini = require('./gemini');

function provider() {
  if (gemini.isGeminiConfigured()) return gemini;
  if (claude.isClaudeConfigured()) return claude;
  return null;
}

function isAIConfigured() {
  return !!provider();
}

function callThrough(claudeFn, geminiFn) {
  return async (...args) => {
    const p = provider();
    if (!p) throw new Error('No AI provider configured (set GEMINI_API_KEY or ANTHROPIC_API_KEY).');
    return p === gemini ? p[geminiFn](...args) : p[claudeFn](...args);
  };
}

module.exports = {
  isAIConfigured,
  evaluate: callThrough('evaluateWithClaude', 'evaluateWithGemini'),
  generate: callThrough('generateWithClaude', 'generateWithGemini'),
  generateLessonPlan: callThrough('generateLessonPlanWithClaude', 'generateLessonPlanWithGemini'),
  analyzeMistakes: callThrough('analyzeMistakesWithClaude', 'analyzeMistakesWithGemini'),
  discoverResources: callThrough('discoverResourcesWithClaude', 'discoverResourcesWithGemini'),
  generateOtherMaterial: callThrough('generateOtherMaterialWithClaude', 'generateOtherMaterialWithGemini'),
};
