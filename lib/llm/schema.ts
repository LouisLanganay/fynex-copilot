import { z } from "zod";

/** JSON schemas sent to Muse Spark (response_format) and their zod mirrors (PLAN.md 5.5, 7). */

const quoteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["document_id", "text"],
  properties: {
    document_id: { type: "string", description: "The id attribute of the <document> the quote comes from, e.g. D1." },
    text: { type: "string", description: "Exact verbatim passage copied from the document, 20 to 400 characters." },
  },
} as const;

export const HOLDING_UPDATE_SCHEMA = {
  name: "holding_update",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "headline", "claims", "portfolio_note"],
    properties: {
      status: { type: "string", enum: ["material_change", "minor_update", "no_new_information"] },
      headline: { type: "string", description: "One sentence, max 140 characters, no advice." },
      claims: {
        type: "array",
        minItems: 0,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["category", "statement", "why_it_matters", "quotes"],
          properties: {
            category: { type: "string", enum: ["results", "guidance", "capital", "strategy", "risk", "other"] },
            statement: { type: "string", description: "What changed, plain language, max 280 characters." },
            why_it_matters: {
              type: "string",
              description: "Why this matters for a holder with the given weight, max 280 characters, no advice.",
            },
            quotes: { type: "array", minItems: 1, maxItems: 3, items: quoteSchema },
          },
        },
      },
      portfolio_note: { type: "string", description: "One sentence on exposure using only the provided weight figures." },
    },
  },
} as const;

export const QuoteZ = z.object({ document_id: z.string(), text: z.string() });

export const HoldingUpdateZ = z.object({
  status: z.enum(["material_change", "minor_update", "no_new_information"]),
  headline: z.string().max(400),
  claims: z
    .array(
      z.object({
        category: z.enum(["results", "guidance", "capital", "strategy", "risk", "other"]),
        statement: z.string().max(800),
        why_it_matters: z.string().max(800),
        quotes: z.array(QuoteZ).min(1).max(3),
      }),
    )
    .max(5),
  portfolio_note: z.string().max(600),
});
export type HoldingUpdate = z.infer<typeof HoldingUpdateZ>;

export const ANSWER_SCHEMA = {
  name: "document_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["answerable", "answer", "quotes"],
    properties: {
      answerable: { type: "boolean", description: "False when the documents do not contain the answer." },
      answer: { type: "string", description: "Max 600 characters, plain language, no advice." },
      quotes: { type: "array", minItems: 0, maxItems: 3, items: quoteSchema },
    },
  },
} as const;

export const AnswerZ = z.object({
  answerable: z.boolean(),
  answer: z.string().max(1500),
  quotes: z.array(QuoteZ).max(3),
});
export type Answer = z.infer<typeof AnswerZ>;

export const TRANSCRIPTION_SCHEMA = {
  name: "pdf_transcription",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["pages"],
    properties: { pages: { type: "array", items: { type: "string" } } },
  },
} as const;
