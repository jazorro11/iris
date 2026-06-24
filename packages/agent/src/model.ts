import { ChatOpenAI } from "@langchain/openai";

export function createChatModel(opts?: { temperature?: number }): ChatOpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  return new ChatOpenAI({
    modelName: "openai/gpt-4o-mini",
    temperature: opts?.temperature ?? 0.1,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "HTTP-Referer": "https://iris.local" },
    },
    apiKey,
  });
}
