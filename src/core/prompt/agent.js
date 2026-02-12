import Groq from "groq-sdk";

/**
 * THE "DEEP AUDIT" SYSTEM PROMPT
 * Context-aware: It detects the tech stack (WordPress vs Next.js) before suggesting fixes.
 */
const SYSTEM_PROMPT = `
You are the "ThinkShip Optimization Architect", a Senior Full-Stack Engineer.

YOUR GOAL:
Analyze the audit telemetry and generate a "Self-Healing Protocol".
Focus ONLY on the most critical failure driving the score down.

INPUT CONTEXT:
You will receive a JSON object containing:
1. 'tech_stack': Detected technologies (e.g., WordPress, Cloudflare, Next.js).
2. 'scores': Numeric scores for Performance, SEO, Security.
3. 'critical_failures': Specific ERROR/WARNING logs.
4. 'metrics': Raw performance numbers.

RULES:
1. **Context Matters:** If 'tech_stack' says "WordPress" or "PHP", DO NOT suggest 'next.config.js'. Suggest '.htaccess', 'nginx.conf', or 'wp-config.php'.
2. **Security First:** If Security score < 50, that is the PRIORITY. Ignore speed for now.
3. **No Hallucinations:** Only fix errors explicitly listed in 'critical_failures'.

OUTPUT FORMAT:
Return a VALID JSON object. No markdown.
{
  "_reasoning": "Internal monologue. Analyze the tech stack and errors. Why is the score low?",
  "agent_status": "CRITICAL_OPTIMIZATION_REQUIRED" | "SYSTEM_NOMINAL",
  "summary": "Technical executive summary of the primary bottleneck.",
  "steps": [
    {
      "action": "Title of the fix",
      "file": "Target file (e.g., '.htaccess', 'Cloudflare Dashboard', 'next.config.js')",
      "code_snippet": "The precise code or configuration to apply."
    }
  ]
}
`;

/**
 * Runs the deep audit analysis with Tech Stack detection.
 */
export async function runDeepAudit(auditResult) {
  try {
    const TIMEOUT_MS = 15000; // 15s timeout for deep reasoning
    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });

    // 1. Data Normalization (Handle 'audits' vs 'results')
    const modules = auditResult.audits || auditResult.results || [];

    // 2. Module Extraction (Handle 'perf' vs 'performance')
    const perf = modules.find(
      (m) => m.key === "perf" || m.key === "performance",
    );
    const seo = modules.find((m) => m.key === "seo");
    const sec = modules.find((m) => m.key === "security");

    // 3. Tech Stack Detection (Heuristics)
    const robotsContent =
      seo?.details?.crawlability?.robots?.contentSnippet || "";
    const serverHeader = sec?.details?.headers?.server || "";
    const poweredBy = sec?.details?.headers?.["x-powered-by"] || "";

    let techStack = "Generic Web Server";
    if (
      robotsContent.includes("wp-admin") ||
      robotsContent.includes("wp-includes")
    ) {
      techStack = "WordPress / PHP";
    } else if (
      poweredBy.includes("Next.js") ||
      auditResult.url.includes("vercel")
    ) {
      techStack = "Next.js / Vercel";
    }

    if (serverHeader.includes("cloudflare")) {
      techStack += " + Cloudflare CDN";
    }

    // 4. Filter Critical Logs
    const criticalLogs = modules.flatMap((m) =>
      (m.logs || [])
        .filter((l) => l.level === "ERROR" || l.level === "WARNING")
        .map((l) => `[${m.name}] ${l.message}`),
    );

    // Short-circuit if healthy
    const lowestScore = Math.min(
      perf?.details?.score || 100,
      seo?.details?.score || 100,
      sec?.details?.score || 100,
    );

    if (criticalLogs.length === 0 && lowestScore > 85) {
      return {
        agent_status: "SYSTEM_NOMINAL",
        summary: "All systems operational. No critical issues detected.",
        steps: [],
      };
    }

    // 5. Construct Context
    const context = JSON.stringify({
      target_url: auditResult.url,
      tech_stack: techStack,
      scores: {
        performance: perf?.details?.score || 0,
        seo: seo?.details?.score || 0,
        security: sec?.details?.score || 0,
      },
      metrics: {
        ttfb_ms: perf?.details?.metrics?.ttfbMs || "N/A", // mapped from your specific JSON structure
        lcp_ms: perf?.details?.metrics?.lcpMs || "N/A",
        cls: perf?.details?.metrics?.cls || 0,
      },
      critical_failures: criticalLogs,
    });

    // 6. Execute AI Analysis
    const apiCall = groq.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: context },
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1024,
    });

    const completion = await Promise.race([
      apiCall,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Reasoning Timeout")), TIMEOUT_MS),
      ),
    ]);

    const responseText = completion.choices[0]?.message?.content || "{}";
    const cleanJson = responseText.replace(/```json|```/g, "").trim();

    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Deep Audit Agent Failed:", error.message);
    return {
      agent_status: "CONNECTION_LOST",
      summary: "AI Agent unavailable. Switching to manual heuristics.",
      steps: [],
    };
  }
}
