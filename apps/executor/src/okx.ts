import { createHmac } from "node:crypto";
import { config } from "./config";

const BASE_URL = "https://web3.okx.com";

interface OkxApiResponse {
  code: string;
  msg: string;
  data: any[];
}

function sign(timestamp: string, method: string, requestPath: string, queryString: string): string {
  const prehash = timestamp + method + requestPath + queryString;
  return createHmac("sha256", config.okx.apiSecret).update(prehash).digest("base64");
}

async function signedGet(path: string, params: Record<string, string>): Promise<any> {
  const timestamp = new Date().toISOString();
  const query = "?" + new URLSearchParams(params).toString();
  const requestPath = `/api/v6/dex/${path}`;

  const res = await fetch(`${BASE_URL}${requestPath}${query}`, {
    method: "GET",
    headers: {
      "OK-ACCESS-KEY": config.okx.apiKey,
      "OK-ACCESS-SIGN": sign(timestamp, "GET", requestPath, query),
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": config.okx.apiPassphrase,
    },
  });

  const json = (await res.json()) as OkxApiResponse;
  if (!res.ok) {
    throw new Error(`OKX API request failed (${res.status}): ${json.msg || res.statusText}`);
  }
  if (json.code !== "0") {
    throw new Error(`OKX API error (${json.code}): ${json.msg}`);
  }
  if (!json.data?.[0]) throw new Error("OKX API returned no route data");
  return json.data[0];
}

export interface OkxQuote {
  fromTokenAmount: string;
  toTokenAmount: string; // expected output, pre-slippage
  priceImpactPercent: string;
}

export async function getQuote(params: {
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string; // smallest unit
  slippagePercent: string; // e.g. "0.5"
}): Promise<OkxQuote> {
  const data = await signedGet("aggregator/quote", {
    chainIndex: config.okx.chainIndex,
    ...params,
  });
  return data.routerResult ?? data;
}

export interface OkxSwapTx {
  to: string;
  data: string;
  value: string;
  minReceiveAmount: string;
  toTokenAmount: string; // expected output, pre-slippage — from routerResult
}

export async function getSwapTransaction(params: {
  fromTokenAddress: string;
  toTokenAddress: string;
  amount: string;
  userWalletAddress: string; // the Vault's address — it holds the funds
  slippagePercent: string;
}): Promise<OkxSwapTx> {
  const data = await signedGet("aggregator/swap", {
    chainIndex: config.okx.chainIndex,
    ...params,
  });

  return {
    to: data.tx.to,
    data: data.tx.data,
    value: data.tx.value,
    minReceiveAmount: data.tx.minReceiveAmount,
    toTokenAmount: data.routerResult.toTokenAmount,
  };
}
