import Groq from "groq-sdk";

/**
 * THE "DEEP AUDIT" SYSTEM PROMPT
 * Enhanced with Chain-of-Thought (CoT) requirements for higher accuracy.
 */
const SYSTEM_PROMPT = `
You are the "ThinkShip Optimization Agent", a high-performance Systems Architect specializing in Next.js (App Router), React, and Web Vitals.

YOUR GOAL:
Analyze the audit data and generate a "Self-Healing Protocol".
Focus ONLY on the single most critical issue that has the highest impact on the user's score.

INPUT DATA:
You will receive a JSON object with:
1. 'metrics': Raw Core Web Vitals (LCP, CLS, INP).
2. 'detailed_recommendations': Specific technical opportunities found by the auditors.

OUTPUT FORMAT:
Return a VALID JSON object. Do not include markdown. Do not include explanations outside the JSON.
{
  "_reasoning": "Internal monologue. Analyze the metrics. Why is the score low? Which specific file or pattern is likely responsible?",
  "agent_status": "CRITICAL_OPTIMIZATION_REQUIRED" | "SYSTEM_NOMINAL",
  "summary": "Short, punchy technical summary (terminal style).",
  "steps": [
    {
      "action": "Technical Action Title",
      "file": "Target file path (e.g., 'app/layout.tsx', 'next.config.js')",
      "code_snippet": "The precise code block to apply."
    }
  ]
}

TECHNIQUES:
- LCP > 2.5s? Suggest 'priority={true}' on <Image> or generic preloads.
- CLS > 0.1? Suggest 'adjustFontFallbacks: true' in next.config.js or explicit aspect ratios.
- Missing Headers? Suggest specific 'securityHeaders' configuration.
`;

/**
 * Runs the deep audit analysis with Timeout and Retry logic.
 */
export async function runDeepAudit(auditResult) {
  try {
    // ------------------------------------------------------------------
    // CONFIG: Timeout (Prevent hanging requests)
    // ------------------------------------------------------------------
    const TIMEOUT_MS = 8000; // 8 seconds max wait

    // 1. Initialize Client (Lazy Load)
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // 2. Enhanced Context Construction
    // We dig deeper into the audit results to find the 'recommendations' array
    // which contains the specific technical details we need.
    const perfAudit = auditResult.audits.find((a) => a.key === "perf");
    const seoAudit = auditResult.audits.find((a) => a.key === "seo");
    const securityAudit = auditResult.audits.find((a) => a.key === "security");

    // Collect all high-priority recommendations into a single context list
    const allRecommendations = [
      ...(perfAudit?.details?.recommendations || []),
      ...(seoAudit?.details?.recommendations || []),
      ...(securityAudit?.details?.recommendations || []),
    ].filter((r) => r.priority !== "LOW"); // Ignore low priority noise

    const context = JSON.stringify({
      target_url: auditResult.url,
      overall_score: auditResult.summary.overallScore,
      metrics: perfAudit?.details?.metrics, // Pass raw metrics for analysis
      detailed_recommendations: allRecommendations, // <--- The "Gold" data
    });

    // 3. Define the API Call Promise
    const apiCall = groq.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: context },
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      temperature: 0.2, // Lower temp = More consistent code
      max_tokens: 1500, // Slightly higher for the "reasoning" field
    });

    // 4. Execute with Timeout
    const completion = await Promise.race([
      apiCall,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Reasoning Timeout")), TIMEOUT_MS),
      ),
    ]);

    const responseText = completion.choices[0]?.message?.content || "{}";

    // 5. Clean & Parse
    const cleanJson = responseText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    // Optional: Log the hidden reasoning for your own debugging
    // console.log("[Agent Reasoning]:", parsed._reasoning);

    return parsed;
  } catch (error) {
    console.error("Deep Audit Agent Failed:", error.message);

    return {
      agent_status: "CONNECTION_LOST",
      summary:
        error.message === "Reasoning Timeout"
          ? "Agent latency exceeded. Optimization skipped."
          : "Uplink failed. Switching to manual heuristics.",
      steps: [],
    };
  }
}
