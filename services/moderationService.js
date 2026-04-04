const OpenAI = require("openai");

const MODERATION_MODEL = "gpt-4.1-mini";
const MODERATION_TEST_MODE = String(process.env.MODERATION_TEST_MODE || "").trim().toLowerCase() === "true";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function normalizeText(value) {
  return String(value || "").trim();
}

function shouldSkipModeration(text) {
  if (!text) return true;
  if (text.length < 4) return true;
  return false;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cleanLabels(labels) {
  return Array.isArray(labels)
    ? labels.map((x) => String(x).trim()).filter(Boolean).slice(0, 10)
    : [];
}

function buildCleanResult({
  flagged = false,
  score = 0,
  labels = [],
  reason = null,
  provider = "openai",
  model = MODERATION_MODEL,
}) {
  return {
    flagged: Boolean(flagged),
    score:
      typeof score === "number" && Number.isFinite(score)
        ? Math.max(0, Math.min(1, score))
        : 0,
    labels: cleanLabels(labels),
    reason: reason ? String(reason).trim().slice(0, 300) : null,
    provider,
    model,
  };
}

function analyzeTextModerationMock(text, meta = {}) {
  const cleanText = normalizeText(text).toLowerCase();

  const gravissimoPatterns = [
    /csam/,
    /\bchild sexual\b/,
    /\bminor sexual\b/,
    /\bunderage sexual\b/,
    /\bsexual minor\b/,
    /\bpedo\b/,
    /\bpedoph/i,
    /\bteen sex\b/,
    /\bsex with child\b/,
    /\bsex with minor\b/,
  ];

  const gravePatterns = [
    /\bescort\b/,
    /\bprostitution\b/,
    /\brape\b/,
    /\bkill\b/,
    /\bsuicide\b/,
    /\bself harm\b/,
    /\bdoxx\b/,
    /\bgrooming\b/,
    /\bextreme violence\b/,
    /\bthreat\b/,
    /\bhate speech\b/,
  ];

  if (gravissimoPatterns.some((rx) => rx.test(cleanText))) {
    return buildCleanResult({
      flagged: true,
      score: 0.99,
      labels: ["csam", "minor", "sexual_content"],
      reason: "csam_test_trigger",
      provider: "mock",
      model: "local-test",
    });
  }

  if (gravePatterns.some((rx) => rx.test(cleanText))) {
    return buildCleanResult({
      flagged: true,
      score: 0.9,
      labels: ["unsafe_content"],
      reason: "unsafe_test_trigger",
      provider: "mock",
      model: "local-test",
    });
  }

  return buildCleanResult({
    flagged: false,
    score: 0,
    labels: [],
    reason: null,
    provider: "mock",
    model: "local-test",
  });
}

async function analyzeTextModeration(text, meta = {}) {
  const cleanText = normalizeText(text);

  if (shouldSkipModeration(cleanText)) {
    return buildCleanResult({
      flagged: false,
      score: 0,
      labels: [],
      reason: null,
      provider: MODERATION_TEST_MODE ? "mock" : "openai",
      model: MODERATION_TEST_MODE ? "local-test" : MODERATION_MODEL,
    });
  }

  if (MODERATION_TEST_MODE) {
    return analyzeTextModerationMock(cleanText, meta);
  }

  try {
    const response = await client.chat.completions.create({
      model: MODERATION_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You are a text moderation classifier for a social/live platform. Analyze the user text and decide if it should be flagged for admin review. Flag content involving minors/age ambiguity, explicit sexual content, coercion, non-consensual sexual content, prostitution/escort solicitation, extreme violence, threats, self-harm encouragement, illegal activities, hate, harassment, doxxing, grooming, spam contact solicitation, or clearly unsafe content. Return ONLY valid JSON with this exact shape: {"flagged":boolean,"score":number,"labels":[string],"reason":string}. score must be 0..1.',
        },
        {
          role: "user",
          content: JSON.stringify({
            text: cleanText,
            source: meta.source || "unknown",
            visibility: meta.visibility || "public",
          }),
        },
      ],
    });

    const raw = response.choices?.[0]?.message?.content || "{}";
    const parsed = safeJsonParse(raw);

    if (!parsed || typeof parsed !== "object") {
      return buildCleanResult({
        flagged: false,
        score: 0,
        labels: [],
        reason: null,
        provider: "openai",
        model: MODERATION_MODEL,
      });
    }

    return buildCleanResult({
      flagged: parsed.flagged,
      score: parsed.score,
      labels: parsed.labels,
      reason: parsed.reason,
      provider: "openai",
      model: MODERATION_MODEL,
    });
  } catch (err) {
    console.error("analyzeTextModeration error:", err?.message || err);

    return buildCleanResult({
      flagged: false,
      score: 0,
      labels: [],
      reason: null,
      provider: "openai",
      model: MODERATION_MODEL,
    });
  }
}

module.exports = {
  analyzeTextModeration,
};