import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WebScraper } from "../extension/scraper.js";
import type { ScrapedPage } from "../extension/scraper.js";

const MOCK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>State Machine Pattern in TypeScript - Refactoring.Guru</title>
  <meta name="description" content="Learn the State design pattern">
  <style>body { font: 16px sans-serif; }</style>
  <script>console.log("tracking");</script>
</head>
<body>
  <header>
    <nav><a href="/">Home</a> | <a href="/patterns">Patterns</a></nav>
  </header>
  <article>
    <h1>State Machine Pattern</h1>
    <p>The <strong>State</strong> pattern allows an object to alter its behavior when its internal state changes.</p>
    <p>In TypeScript, this is commonly implemented with a <code>State</code> interface and concrete state classes.</p>
    <pre><code>interface State {
  handle(context: Context): void;
}</code></pre>
    <blockquote>
      <p>"The State pattern is a behavioral design pattern." — Gang of Four</p>
    </blockquote>
  </article>
  <footer>&copy; 2024 Refactoring.Guru</footer>
</body>
</html>`;

function mockFetch(html: string) {
  return async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
}

describe("Scraper", () => {
  describe("WebScraper", () => {
    it("extracts title from <title> tag", async () => {
      const scraper = new WebScraper(mockFetch(MOCK_HTML));
      const page = await scraper.scrape("https://refactoring.guru/state");

      assert.ok(page.title.includes("State Machine Pattern"));
      assert.ok(page.title.includes("TypeScript"));
      assert.ok(
        !page.title.includes("<"),
        "title should not contain HTML tags"
      );
    });

    it("extracts readable text content", async () => {
      const scraper = new WebScraper(mockFetch(MOCK_HTML));
      const page = await scraper.scrape("https://refactoring.guru/state");

      // Should contain article text
      assert.ok(
        page.content.includes("State pattern allows an object"),
        "should contain article paragraph text"
      );
      assert.ok(
        page.content.includes("Gang of Four"),
        "should contain blockquote text"
      );
    });

    it("strips HTML tags from content", async () => {
      const scraper = new WebScraper(mockFetch(MOCK_HTML));
      const page = await scraper.scrape("https://refactoring.guru/state");

      assert.ok(!page.content.includes("<style>"), "should not contain style tag");
      assert.ok(!page.content.includes("<script>"), "should not contain script tag");
      assert.ok(!page.content.includes("<nav>"), "should not contain nav markup");
      assert.ok(!page.content.includes("<code>"), "should not contain code tags");
      assert.ok(!page.content.includes("<h1>"), "should not contain heading tags");
    });

    it("returns URL in result", async () => {
      const scraper = new WebScraper(mockFetch(MOCK_HTML));
      const page = await scraper.scrape("https://refactoring.guru/state");

      assert.equal(page.url, "https://refactoring.guru/state");
    });

    it("handles pages without <title>", async () => {
      const noTitle = "<html><body><p>Just text.</p></body></html>";
      const scraper = new WebScraper(mockFetch(noTitle));
      const page = await scraper.scrape("https://example.com");

      assert.equal(page.title, ""); // graceful fallback
      assert.ok(page.content.includes("Just text."));
    });

    it("throws on fetch error", async () => {
      const errorFetch = async () => {
        throw new Error("Network error");
      };
      const scraper = new WebScraper(errorFetch);

      await assert.rejects(
        () => scraper.scrape("https://example.com"),
        /Network error/,
        "should propagate fetch errors"
      );
    });

    it("throws on non-200 status", async () => {
      const notFound = async () =>
        new Response("Not Found", { status: 404 });
      const scraper = new WebScraper(notFound);

      await assert.rejects(
        () => scraper.scrape("https://example.com/missing"),
        /404/,
        "should throw on 404"
      );
    });

    it("decodes windows-1251 Cyrillic when charset only in meta tag", async () => {
      // Real windows-1251 encoded HTML (Cyrillic: Тест = test, Привет мир = hello world)
      // Build windows-1251 byte sequence manually
      const html1251 = Buffer.from([
        0x3C, 0x21, 0x44, 0x4F, 0x43, 0x54, 0x59, 0x50, 0x45, 0x20, // <!DOCTYPE
        0x68, 0x74, 0x6D, 0x6C, 0x3E, 0x3C, 0x68, 0x74, 0x6D, 0x6C, // html><html
        0x3E, 0x3C, 0x68, 0x65, 0x61, 0x64, 0x3E, // ><head>
        0x3C, 0x6D, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3D, 0x22, 0x77, 0x69, 0x6E, 0x64, 0x6F, 0x77, 0x73, 0x2D, 0x31, 0x32, 0x35, 0x31, 0x22, 0x3E, // <meta charset="windows-1251">
        0x3C, 0x74, 0x69, 0x74, 0x6C, 0x65, 0x3E, // <title>
        0xD2, 0xE5, 0xF1, 0xF2, // Тест (windows-1251)
        0x3C, 0x2F, 0x74, 0x69, 0x74, 0x6C, 0x65, 0x3E, // </title>
        0x3C, 0x2F, 0x68, 0x65, 0x61, 0x64, 0x3E, 0x3C, 0x62, 0x6F, 0x64, 0x79, 0x3E, // </head><body>
        0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2, 0x20, 0xEC, 0xE8, 0xF0, // Привет мир (windows-1251)
        0x3C, 0x2F, 0x62, 0x6F, 0x64, 0x79, 0x3E, 0x3C, 0x2F, 0x68, 0x74, 0x6D, 0x6C, 0x3E, // </body></html>
      ]);

      const fetchFn = async () =>
        new Response(new Uint8Array(html1251), {
          status: 200,
          headers: { "Content-Type": "text/html" },  // no charset — bytes are windows-1251 but server doesn't say
        });

      const scraper = new WebScraper(fetchFn);
      const page = await scraper.scrape("https://example.com/cyrillic");

      assert.equal(page.title, "Тест", `title must decode, got: ${page.title}`);
      assert.ok(page.content.includes("Привет мир"),
        `content must contain decoded Cyrillic, got: ${page.content.slice(0, 80)}`);
    });
  });
});

function assertScrapedPageShape(page: ScrapedPage): void {
  assert.equal(typeof page.url, "string");
  assert.equal(typeof page.title, "string");
  assert.equal(typeof page.content, "string");
}
