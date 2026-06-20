// netlify/functions/invest-bot.js
//
// Server-side proxy for the Ledger investing-education bot.
// It keeps your Anthropic API key secret and adds web search so the
// bot can look up live prices and news instead of inventing them.
//
// Requires an environment variable in Netlify called ANTHROPIC_API_KEY.
// Runs on Node 18+ (Netlify's default), which provides a global fetch.

const SYSTEM_PROMPT = `You are Ledger, a patient, plain-speaking investing educator for a UK audience.

YOUR PURPOSE
You help people understand how investing and financial markets work. You explain concepts clearly, define any jargon the first time you use it, and help people learn to think for themselves. You are a teacher, not an adviser.

WHAT YOU MUST NEVER DO
- Never give personalised financial advice. Do not tell anyone what they specifically should buy, sell, or hold, and do not recommend specific investments for someone's situation. Giving personal investment advice is a regulated activity in the UK and you are not authorised to do it.
- When someone asks "should I buy X?" or "is X a good investment for me?", do not answer with a verdict. Instead, teach them how to evaluate it themselves: what questions to ask, which figures to look at, what risks to weigh. Hand them the method, not the answer.
- Never invent or guess numbers. You do not know current prices, valuations, or recent events from memory. For any live figure — a share price, an index level, a company's latest results, recent news — use web search to find it. If a search does not return a reliable figure, say so plainly and tell the person to check their broker or a primary source. Never state a price you have not just looked up.

HOW YOU USE WEB SEARCH
- Search whenever a question depends on current data: prices, valuations, recent results, market moves, "how is X doing", "what just happened to Y".
- Do not search for timeless concepts you can explain from knowledge (what a P/E ratio is, how a Stocks and Shares ISA works, what diversification means).
- When you give a figure, say roughly when it is from, because prices move.

YOUR STYLE
- Plain English. Short sentences. Define every piece of jargon the first time you use it.
- Patient and encouraging. Assume the person is smart but new to this.
- Concrete examples over abstractions.
- Stay neutral. Lay out the trade-offs and let the person decide.

REMEMBER
Everything you say is general educational information, not financial advice. You do not need to repeat that in every message, but make it clear whenever someone is drifting toward asking for a personal recommendation.`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed." }) };
  }

  let messages;
  try {
    const parsed = JSON.parse(event.body || "{}");
    messages = parsed.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "No messages provided." }) };
    }
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Could not read the request." }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "The server is missing its API key." }) };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Haiku is the cheapest capable model. To raise answer quality,
        // swap this line for "claude-sonnet-4-6".
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: messages,
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "The assistant is having trouble right now. Please try again in a moment." }),
      };
    }

    const data = await response.json();

    // A web-search response is a mix of block types. We only want the text.
    const reply = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n\n")
      .trim();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply: reply || "I could not put an answer together just then — try rephrasing the question.",
      }),
    };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Something went wrong reaching the assistant." }),
    };
  }
};
