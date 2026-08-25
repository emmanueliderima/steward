import { signedGet } from "../src/okx";

async function main() {
    const result = await signedGet("aggregator/quote", {
  chainIndex: "196",
  fromTokenAddress: "0x0000000000000000000000000000000000000000",
  toTokenAddress: "0x6b175474e89094ca9dbb2c5c0c8e6f1f3f0e2b6f",
  amount: "1000000000000000000",
  slippagePercent: "0.5",
});
    console.log(result);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});