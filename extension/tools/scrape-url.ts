import { Type } from "typebox";
import type { WebScraper } from "../scraper.js";

export function createScrapeUrlTool(scraper: WebScraper) {
  return {
    name: "scrape_url",
    label: "Scrape URL",
    description: "Fetch a URL and extract its readable text content. Returns title and cleaned text. Use to get full page content for research.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to scrape" }),
    }),
    async execute(_toolCallId: string, params: any) {
      const page = await scraper.scrape(params.url);
      return {
        content: [{ type: "text", text: `# ${page.title}\n\n${page.content.substring(0, 5000)}` }],
        details: { page },
      };
    },
  };
}
