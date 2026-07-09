/**
 * Yandex Search API adapter.
 * Uses Yandex Cloud Search API with OAuth token → IAM token → async submit/poll → XML response.
 */

import { request as httpsRequest } from "node:https";
import type { WebSearchOptions, WebSearchResult } from "../web-search.js";
import type { SearchProviderCredentials } from "../../settings-context.js";
import { sleep, decodeHtmlEntities, waitIfNeeded } from "../web-search.js";

const YANDEX_SEARCH_URL = "https://searchapi.api.cloud.yandex.net/v2/web/searchAsync";
const YANDEX_OPERATION_URL = "https://operation.api.cloud.yandex.net/operations/";
const YANDEX_IAM_URL = "https://iam.api.cloud.yandex.net/iam/v1/tokens";

interface YandexIamToken {
  iamToken: string;
  expiresAt: string;
}

let yandexIamCache: YandexIamToken | null = null;

async function yandexGetIamToken(oauthToken: string): Promise<string> {
  if (yandexIamCache && new Date(yandexIamCache.expiresAt).getTime() > Date.now() + 60_000) {
    return yandexIamCache.iamToken;
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ yandexPassportOauthToken: oauthToken });
    const req = httpsRequest(
      YANDEX_IAM_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            yandexIamCache = { iamToken: data.iamToken, expiresAt: data.expiresAt };
            resolve(data.iamToken);
          } catch {
            reject(new Error("Failed to get Yandex IAM token"));
          }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("IAM token timeout")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function yandexSearchSubmit(
  iamToken: string,
  folderId: string,
  query: string,
  maxResults: number,
): Promise<string> {
  const body = JSON.stringify({
    query: { searchType: "SEARCH_TYPE_COM", queryText: query, page: 0 },
    groupSpec: { groupsOnPage: maxResults },
    region: "225",
    l10N: "en",
    folderId,
    responseFormat: "FORMAT_XML",
  });

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      YANDEX_SEARCH_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${iamToken}`,
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            resolve(data.id);
          } catch {
            reject(new Error("Failed to submit Yandex search"));
          }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Search submit timeout")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function yandexPollOperation(iamToken: string, operationId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      `${YANDEX_OPERATION_URL}${operationId}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${iamToken}` },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            if (!data.done) {
              resolve("");
              return;
            }
            const rawData = data.response?.rawData;
            if (!rawData) {
              reject(new Error("No rawData in response"));
              return;
            }
            resolve(Buffer.from(rawData, "base64").toString("utf-8"));
          } catch {
            reject(new Error("Failed to poll operation"));
          }
        });
      },
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Poll timeout")); });
    req.on("error", reject);
    req.end();
  });
}

function parseYandexXml(xml: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const groupRegex = /<group[\s\S]*?<\/group>/g;
  const urlRegex = /<url>([^<]+)<\/url>/;
  const titleRegex = /<title>([^<]+)<\/title>/;
  const headlineRegex = /<headline>([^<]+)<\/headline>/;

  let match;
  while ((match = groupRegex.exec(xml)) !== null && results.length < maxResults) {
    const groupXml = match[0];
    const urlM = groupXml.match(urlRegex);
    const titleM = groupXml.match(titleRegex);
    const headlineM = groupXml.match(headlineRegex);

    if (urlM) {
      results.push({
        title: decodeHtmlEntities(titleM?.[1] ?? headlineM?.[1] ?? ""),
        url: urlM[1],
        snippet: decodeHtmlEntities(headlineM?.[1] ?? ""),
        engine: "yandex",
      });
    }
  }
  return results;
}

export async function searchYandex(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const oauthToken = process.env.YANDEX_OAUTH_TOKEN;
  const folderId = process.env.YANDEX_FOLDER_ID;
  if (!oauthToken || !folderId) return [];

  try {
    const iamToken = await yandexGetIamToken(oauthToken);
    const operationId = await yandexSearchSubmit(iamToken, folderId, query, maxResults);

    for (let i = 0; i < 10; i++) {
      await sleep(1000 + i * 500);
      const xml = await yandexPollOperation(iamToken, operationId);
      if (xml) return parseYandexXml(xml, maxResults);
    }
    return [];
  } catch {
    return [];
  }
}

export async function search(
  query: string,
  opts: WebSearchOptions,
  _cred?: SearchProviderCredentials,
): Promise<WebSearchResult[]> {
  await waitIfNeeded("yandex");
  return searchYandex(query, opts.maxResults ?? 5);
}
