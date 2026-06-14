import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(extensionDir, "..", "..", "..");
const tsxBin = join(packageRoot, "node_modules", ".bin", "tsx");
const cliPath = join(packageRoot, "src", "cli.ts");

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fusion",
    label: "Fusion Deliberation",
    description:
      "Multi-model deliberation: fans out your query to 3+ AI models in parallel (each with web search), then a judge synthesizes structured analysis showing consensus, contradictions, unique insights, and blind spots. Matches OpenRouter Fusion architecture. Use for complex reasoning, architecture decisions, code review, debugging hard problems, or evaluating tradeoffs. ~$0.01/query.",
    promptSnippet: "Fusion: fan out query to 3+ models for deliberation with judge synthesis",
    promptGuidelines: [
      "Use fusion for complex decisions where multiple perspectives improve the outcome: architecture choices, security review, hard debugging, technology evaluation. Apply the $0.01 test — is this decision worth 1 cent and 30-120 seconds?",
      "Do NOT use fusion for: simple facts, trivial file operations, questions you're already confident about, or when the user is waiting interactively. Do not call fusion iteratively — frame your prompt thoroughly the first time.",
      "Batch multiple fusion-worthy questions into one deliberation. Read the output actively: act on consensus, resolve contradictions with evidence, verify unique insights before depending on them, and use blind spots as your action items.",
    ],
    parameters: Type.Object({
      prompt: Type.String({
        description:
          "The question or topic to deliberate on. Be specific and thorough — this is sent verbatim to all panel models.",
      }),
    }),
    async execute(_id, params) {
      try {
        const stdout = execFileSync("node", ["--import", "tsx", cliPath, params.prompt], {
          encoding: "utf-8",
          timeout: 120_000,
          env: { ...process.env },
          maxBuffer: 2 * 1024 * 1024,
          cwd: packageRoot,
        });

        const result = JSON.parse(stdout);
        const modelsUsed = result.responses?.length ?? 0;
        const failedCount = result.failed_models?.length ?? 0;

        let summary = `Fusion deliberation complete (${modelsUsed} models responded`;
        if (failedCount > 0) summary += `, ${failedCount} failed`;
        if (result.analysis) {
          const a = result.analysis;
          const parts: string[] = [];
          if (a.consensus?.length)
            parts.push(`${a.consensus.length} consensus`);
          if (a.contradictions?.length)
            parts.push(`${a.contradictions.length} contradictions`);
          if (a.blind_spots?.length)
            parts.push(`${a.blind_spots.length} blind spots`);
          if (parts.length) summary += ` | ${parts.join(", ")}`;
        }
        summary += ")";

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: { status: result.status, modelsUsed, failedCount, summary },
        };
      } catch (err: unknown) {
        const e = err as { stderr?: string; stdout?: string; message?: string };
        return {
          content: [
            {
              type: "text",
              text: `Fusion deliberation failed: ${e.stderr || e.stdout || e.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
