import type { TransactionReceipt, TransactionResponse } from "ethers";

export async function waitForConfirmation(
  transaction: TransactionResponse,
  timeoutMs = 120_000
): Promise<TransactionReceipt> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const receipt = await Promise.race([
      transaction.wait(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Transaction ${transaction.hash} was submitted, but the RPC did not report confirmation within ${timeoutMs / 1000} seconds. Check the transaction in your wallet before retrying.`
              )
            ),
          timeoutMs
        );
      }),
    ]);

    if (!receipt) throw new Error(`Transaction ${transaction.hash} was not confirmed.`);
    if (receipt.status !== 1) throw new Error(`Transaction ${transaction.hash} reverted.`);
    return receipt;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
