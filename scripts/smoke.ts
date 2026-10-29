import "./env";
import OpenAI from "openai";
import { MetaModelClient } from "@/lib/llm/client";
import { flag } from "./env";

/**
 * M0 smoke test: GET /v1/models, then one tiny chat completion with a
 * 3-field json_schema. Costs well under $0.01. Skips cleanly without a key.
 */
async function main() {
  const key = process.env.MODEL_API_KEY;
  if (!key) {
    console.log("MODEL_API_KEY is not set: smoke test skipped (the app still runs on the recorded sample).");
    return;
  }
  const baseURL = process.env.MODEL_API_BASE_URL || "https://api.meta.ai/v1";
  const sdk = new OpenAI({ apiKey: key, baseURL });
  const models = await sdk.models.list();
  const ids = models.data.map((m) => m.id).sort();
  console.log(`Models available to this key (${ids.length}): ${ids.join(", ")}`);

  const model = flag("standard") ? "muse-spark-1.3" : process.env.SMOKE_MODEL || "muse-spark-1.3-contributor";
  if (!ids.includes(model)) throw new Error(`Model ${model} is not available to this key.`);
  const client = new MetaModelClient({ apiKey: key, baseURL, model });
  const res = await client.chat({
    purpose: "smoke",
    messages: [{ role: "user", content: "Return a JSON object describing the Eiffel Tower: name, city, height_m." }],
    max_tokens: 1500,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "smoke",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["name", "city", "height_m"],
          properties: { name: { type: "string" }, city: { type: "string" }, height_m: { type: "number" } },
        },
      },
    },
  });
  console.log(`Model: ${res.model}`);
  console.log(`Output: ${res.message.content}`);
  console.log(`Tokens: prompt ${res.usage.prompt} (cached ${res.usage.cached}), completion ${res.usage.completion} (reasoning ${res.usage.reasoning})`);
  console.log(`Cost: $${res.costUsd.toFixed(6)}`);
  JSON.parse(res.message.content ?? "");
}

main().catch((e) => {
  console.error(`Smoke test failed: ${e.message}`);
  process.exit(1);
});
