import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("Vault", () => {
  async function deployFixture() {
    const [owner, executor, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const btc = await MockERC20.deploy("Mock BTC", "mBTC");
    const rwa = await MockERC20.deploy("Mock RWA", "mRWA");

    const MockOKXRouter = await ethers.getContractFactory("MockOKXRouter");
    const router = await MockOKXRouter.deploy();

    const Vault = await ethers.getContractFactory("Vault");
    const implementation = await Vault.deploy();

    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    const factory = await VaultFactory.deploy(
      await implementation.getAddress(),
      await router.getAddress(),
      executor.address
    );

    // 60% max BTC, 30% max RWA, 2% max slippage, 1 hour between rebalances
    const allowedAssets = [await btc.getAddress(), await rwa.getAddress()];
    const maxAllocationBps = [6000, 3000];
    const maxSlippageBps = 200;
    const minRebalanceInterval = 3600;

    const tx = await factory
      .connect(owner)
      .createVault(allowedAssets, maxAllocationBps, maxSlippageBps, minRebalanceInterval);
    const receipt = await tx.wait();
    const createdEvent = receipt!.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "VaultCreated");

    const vaultAddress = createdEvent!.args.vault as string;
    const vault = await ethers.getContractAt("Vault", vaultAddress);

    // Fund the owner with BTC and deposit it into the vault
    await btc.mint(owner.address, ethers.parseEther("10"));
    await btc.connect(owner).approve(vaultAddress, ethers.parseEther("10"));
    await vault.connect(owner).deposit(await btc.getAddress(), ethers.parseEther("10"));

    // Fund the mock router with RWA so it can "swap" BTC -> RWA
    await rwa.mint(await router.getAddress(), ethers.parseEther("1000"));

    return { owner, executor, other, btc, rwa, router, vault, vaultAddress, factory };
  }

  it("creates an isolated vault per user with the requested risk params", async () => {
    const { vault, owner } = await loadFixture(deployFixture);
    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.maxSlippageBps()).to.equal(200);
  });

  it("reverts a rebalance that exceeds the owner's max allocation for an asset", async () => {
    const { vault, executor, btc, rwa, router } = await loadFixture(deployFixture);

    const swapCalldata = router.interface.encodeFunctionData("swap", [
      await btc.getAddress(),
      ethers.parseEther("1"),
      await rwa.getAddress(),
      ethers.parseEther("50"),
    ]);

    const badInstruction = {
      tokenIn: await btc.getAddress(),
      tokenOut: await rwa.getAddress(),
      amountIn: ethers.parseEther("1"),
      expectedAmountOut: ethers.parseEther("50"),
      minAmountOut: ethers.parseEther("49"),
      targetAllocationBps: 3500, // exceeds the 3000 cap set at creation
      swapCalldata,
    };

    await expect(
      vault.connect(executor).executeRebalance([badInstruction], ethers.encodeBytes32String("reason-1"))
    ).to.be.revertedWithCustomError(vault, "AllocationExceeded");
  });

  it("executes a valid rebalance and emits RebalanceExecuted", async () => {
    const { vault, executor, btc, rwa, router } = await loadFixture(deployFixture);

    const amountIn = ethers.parseEther("1");
    const expectedOut = ethers.parseEther("50");
    const minOut = ethers.parseEther("49.5"); // within the 2% slippage cap

    const swapCalldata = router.interface.encodeFunctionData("swap", [
      await btc.getAddress(),
      amountIn,
      await rwa.getAddress(),
      expectedOut,
    ]);

    const instruction = {
      tokenIn: await btc.getAddress(),
      tokenOut: await rwa.getAddress(),
      amountIn,
      expectedAmountOut: expectedOut,
      minAmountOut: minOut,
      targetAllocationBps: 2500, // within the 3000 cap
      swapCalldata,
    };

    await expect(
      vault.connect(executor).executeRebalance([instruction], ethers.encodeBytes32String("reason-1"))
    ).to.emit(vault, "RebalanceExecuted");

    expect(await rwa.balanceOf(await vault.getAddress())).to.equal(expectedOut);
  });

  it("reverts if the executor tries to rebalance again before the interval elapses", async () => {
    const { vault, executor, btc, rwa, router } = await loadFixture(deployFixture);

    const instruction = {
      tokenIn: await btc.getAddress(),
      tokenOut: await rwa.getAddress(),
      amountIn: ethers.parseEther("1"),
      expectedAmountOut: ethers.parseEther("50"),
      minAmountOut: ethers.parseEther("49.5"),
      targetAllocationBps: 2500,
      swapCalldata: router.interface.encodeFunctionData("swap", [
        await btc.getAddress(),
        ethers.parseEther("1"),
        await rwa.getAddress(),
        ethers.parseEther("50"),
      ]),
    };

    await vault.connect(executor).executeRebalance([instruction], ethers.encodeBytes32String("reason-1"));

    await expect(
      vault.connect(executor).executeRebalance([instruction], ethers.encodeBytes32String("reason-2"))
    ).to.be.revertedWithCustomError(vault, "RebalanceTooSoon");
  });

  it("only the owner can withdraw, and only the executor can rebalance", async () => {
    const { vault, other, btc } = await loadFixture(deployFixture);

    await expect(vault.connect(other).withdraw(await btc.getAddress(), 1)).to.be.revertedWithCustomError(
      vault,
      "NotOwner"
    );

    await expect(
      vault.connect(other).executeRebalance([], ethers.encodeBytes32String("x"))
    ).to.be.revertedWithCustomError(vault, "NotExecutor");
  });
});