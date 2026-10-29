import { describe, expect, it } from "vitest";
import { findAdvice, isAdviceRequest } from "@/lib/guardrail/advice";

const ADVICE_QUESTIONS = [
  "Should I sell LVMH?",
  "should i buy more nvidia",
  "Should we hold Apple after these results?",
  "Is it a good time to buy Schneider?",
  "Is now the right moment to sell?",
  "When to sell Safran?",
  "Buy or sell?",
  "Hold or sell TotalEnergies?",
  "What is the price target for ASML?",
  "What's the target price?",
  "Is L'Oreal overvalued?",
  "Is the stock undervalued?",
  "Is Microsoft a good investment?",
  "Is it worth buying JPMorgan now?",
  "Will the stock go up after this?",
  "Do you recommend Coca-Cola?",
  "How much should I invest in Vinci?",
  "Dois-je vendre LVMH ?",
  "Est-ce que je dois acheter Safran",
  "Faut-il renforcer TotalEnergies ?",
  "C'est le moment d'acheter ?",
  "Quel est l'objectif de cours ?",
  "Tu me conseilles quoi sur Vinci ?",
  "Acheter ou vendre Schneider ?",
  "Est-ce un bon investissement ?",
  "Le cours va monter ?",
  "L'action est-elle sous-évaluée ?",
];

const NORMAL_QUESTIONS = [
  "What did LVMH say about Fashion & Leather Goods?",
  "Why did revenue grow this quarter?",
  "What is the buyback program size?",
  "Did the company agree to sell a subsidiary?",
  "What do sell-side analysts expect according to the release?",
  "How much debt did Schneider raise?",
  "What is the guidance for 2026?",
  "Which regions grew the fastest?",
  "What happened to the operating margin?",
  "Who is the new CEO?",
  "What is the dividend per share?",
  "What does the company say about tariffs?",
  "How many shares were issued in the capital increase?",
  "What are the risks mentioned?",
  "Pourquoi le chiffre d'affaires a-t-il augmenté ?",
  "Que dit le communiqué sur la Chine ?",
  "Quel est le montant de l'émission obligataire ?",
  "Quelles sont les perspectives annoncées ?",
  "Combien la société a-t-elle racheté d'actions ?",
  "What did management say about holding company costs?",
  "Explain the acquisition of PTC.",
];

const ADVICE_OUTPUTS = [
  "We recommend buying more shares.",
  "You should sell this position.",
  "Investors should consider adding to the line.",
  "You may want to trim this holding.",
  "Analysts keep a buy rating on the stock.",
  "This is a strong buy.",
  "The price target is 120 euros.",
  "It may be time to sell.",
  "Consider reducing your exposure.",
  "The stock looks cheap after the drop.",
  "Shares are undervalued.",
  "The share price will rise after these results.",
  "This is a good investment for the long run.",
  "Holders could consider taking profits.",
  "This is a buying opportunity.",
  "Our recommendation is to stay invested.",
  "The stock is likely to rebound.",
  "Je vous recommande de patienter.",
  "Il faut vendre cette ligne.",
  "Nous recommandons de renforcer la position.",
  "This could be a good entry point.",
];

const NORMAL_OUTPUTS = [
  "The company agreed to sell its unit in Brazil.",
  "Sell-side analysts were not mentioned in the release.",
  "The buyback program reached EUR 2.5 billion.",
  "Revenue grew 12% and the group raised its guidance.",
  "This line is 8.4% of the portfolio, so the change matters for a large share of it.",
  "The group will hold its annual meeting in April.",
  "Customers buy more cloud services, the release says.",
  "The company sold 3 million shares in the capital increase.",
  "Management expects margin pressure from tariffs.",
  "Net debt rose after the acquisition.",
  "The document does not explain the drop.",
  "The holding company structure was simplified.",
  "Free cash flow was stable.",
  "Organic growth excludes currency effects and acquisitions.",
  "The board proposed a higher dividend.",
  "The release lists risks around demand in China.",
  "Orders in the backlog increased.",
  "This position is ranked 3 of 12 by value.",
  "The bond issue finances the acquisition of PTC.",
  "Le groupe a vendu une filiale.",
  "A buy-back of shares was completed in the quarter.",
];

describe("input filter", () => {
  it.each(ADVICE_QUESTIONS)("refuses: %s", (q) => expect(isAdviceRequest(q)).toBe(true));
  it.each(NORMAL_QUESTIONS)("lets through: %s", (q) => expect(isAdviceRequest(q)).toBe(false));
  it("has at least 20 examples each way", () => {
    expect(ADVICE_QUESTIONS.length).toBeGreaterThanOrEqual(20);
    expect(NORMAL_QUESTIONS.length).toBeGreaterThanOrEqual(20);
  });
});

describe("output filter", () => {
  it.each(ADVICE_OUTPUTS)("blocks: %s", (t) => expect(findAdvice(t)).not.toBeNull());
  it.each(NORMAL_OUTPUTS)("allows: %s", (t) => expect(findAdvice(t)).toBeNull());
  it("has at least 20 examples each way", () => {
    expect(ADVICE_OUTPUTS.length).toBeGreaterThanOrEqual(20);
    expect(NORMAL_OUTPUTS.length).toBeGreaterThanOrEqual(20);
  });
});
