"use client";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, X } from "lucide-react";
import {
  ADDRESS_TREE,
  connection,
  getOpenOrders,
  PROGRAM_ID,
  rpc,
  useProgram,
} from "./program";
import { Order, parseOrderFromBuffer } from "@/lib/utils";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  bn,
  deriveAddress,
  deriveAddressSeed,
} from "@lightprotocol/stateless.js";
import { ADDRESS_QUEUE, CLOSE_ACCOUNTS } from "@/lib/address";

export default function DeFiLimitOrderApp() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    async function fetchOrders() {
      if (connected) {
        const open_orders = await getOpenOrders(publicKey!);
        setOrders(open_orders);
      }
    }
    fetchOrders();
  }, [connected, publicKey]);

  const program = useProgram();

  const [inputToken, setInputToken] = useState("SOL");
  const [outputToken, setOutputToken] = useState("USDC");
  const [inputAmount, setInputAmount] = useState("");
  const [outputAmount, setOutputAmount] = useState("");
  const [expiry, setExpiry] = useState("never");
  const [targetRate, setTargetRate] = useState("");
  const [sellRate, setSellRate] = useState("");

  const handleSubmitOrder = () => {
    if (!inputToken || !outputToken || !inputAmount || !outputAmount || !expiry)
      return;
    //
    // const newOrder: Order = {
    //   id: Date.now().toString(),
    //   type: "buy",
    //   inputToken,
    //   outputToken,
    //   inputAmount,
    //   outputAmount,
    //   price: (
    //     Number.parseFloat(outputAmount) / Number.parseFloat(inputAmount)
    //   ).toFixed(2),
    //   expiry,
    //   status: "pending",
    //   timestamp: new Date().toLocaleString(),
    // };
    //
    // setOrders([newOrder, ...orders]);

    // Reset form
    setInputAmount("");
    setOutputAmount("");
  };

  const cancelOrder = async (unique_id: BN, maker: PublicKey) => {
    if (!program) return;
    if (!connected || !publicKey) return;
    const seeds: Uint8Array[] = [
      Buffer.from("escrow"),
      unique_id.toArrayLike(Buffer, "le", 8),
      maker.toBuffer(),
    ];

    const assetSeed = deriveAddressSeed(seeds, PROGRAM_ID);
    const address = deriveAddress(assetSeed, ADDRESS_TREE);

    const compressed_account = await rpc.getCompressedAccount(
      bn(address.toBytes())
    );

    if (!compressed_account) return;

    const hash = compressed_account!.hash;

    const proof = await rpc.getValidityProofV0(
      [{ hash, tree: ADDRESS_TREE, queue: ADDRESS_QUEUE }],
      []
    );
    const validityProof = proof.compressedProof;

    if (!validityProof) return;

    const buffer = compressed_account?.data?.data;
    const escrow_data = parseOrderFromBuffer(buffer!);

    const instruction = await program.methods
      .cancelOrder({
        escrowAccount: {
          uniqueId: escrow_data.uniqueId,
          amount: {
            makingAmount: escrow_data.amount.makingAmount,
            takingAmount: escrow_data.amount.takingAmount,
            oriMakingAmount: escrow_data.amount.oriMakingAmount,
            oriTakingAmount: escrow_data.amount.oriTakingAmount,
          },
          expiredAt: escrow_data.expiredAt,
          slippageBps: escrow_data.slippageBps,
          feeBps: escrow_data.feeBps,
          createdAt: escrow_data.createdAt,
          updatedAt: escrow_data.updatedAt,
        },
        proof: {
          0: {
            a: validityProof.a,
            b: validityProof.b,
            c: validityProof.c,
          },
        },
        treeInfo: {
          rootIndex: proof.rootIndices[0],
          merkleTreePubkeyIndex: 0,
          queuePubkeyIndex: 1,
          proveByIndex: false,
          leafIndex: compressed_account.leafIndex,
        },
        outputStateTreeIndex: 0,
      })
      .accounts({
        payer: publicKey,
        maker: publicKey,
        inputMint: escrow_data.tokens.inputMint,
        outputMint: escrow_data.tokens.outputMint,
        inputTokenProgram: escrow_data.tokens.inputTokenProgram,
        outputTokenProgram: escrow_data.tokens.outputTokenProgram,
      })
      .remainingAccounts(CLOSE_ACCOUNTS)
      .instruction();

    const latestBlockhash = await rpc.getLatestBlockhash();

    const message = new TransactionMessage({
      payerKey: publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
        instruction,
      ],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    await sendTransaction(tx, connection);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-secondary text-secondary-foreground";
      case "filled":
        return "bg-primary text-primary-foreground";
      case "expired":
        return "bg-muted text-muted-foreground";
      case "cancelled":
        return "bg-destructive text-destructive-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="min-h-screen bg-background cyber-grid">
      <header className="border-b border-border cyber-border">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-8 w-8 text-primary cyber-glow" />
            <h1 className="text-2xl font-bold text-foreground">CyberDEX</h1>
          </div>

          <div className="flex items-center justify-center sm:justify-end w-full sm:w-auto">
            <WalletMultiButton>
              {connected ? null : (
                <div className="transition-all duration-300 rounded-xl px-4 py-2 text-sm sm:text-base">
                  Connect Wallet
                </div>
              )}
            </WalletMultiButton>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 flex flex-col items-center gap-8">
        {/* Limit Orders Section */}

        <Card className="cyber-border cyber-glow bg-slate-900/50 w-full max-w-lg">
          <CardHeader>
            <CardTitle className="text-center">Limit Orders</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {/* Selling */}
            <div className="bg-slate-800/30 rounded-lg p-4">
              <Label className="text-slate-300">Selling</Label>
              <div className="flex items-center justify-between mt-2">
                <Select value={inputToken} onValueChange={setInputToken}>
                  <SelectTrigger className="w-20 border-none bg-transparent text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SOL">SOL</SelectItem>
                    <SelectItem value="ETH">ETH</SelectItem>
                    <SelectItem value="USDC">USDC</SelectItem>
                  </SelectContent>
                </Select>
                <input
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  className="bg-transparent border-b border-slate-500 text-right text-white w-24"
                  placeholder="Amount"
                />
              </div>
            </div>

            {/* Buying */}
            <div className="bg-slate-800/30 rounded-lg p-4">
              <Label className="text-slate-300">Buying</Label>
              <div className="flex items-center justify-between mt-2">
                <Select value={outputToken} onValueChange={setOutputToken}>
                  <SelectTrigger className="w-24 border-none bg-transparent text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USDC">USDC</SelectItem>
                    <SelectItem value="USDT">USDT</SelectItem>
                    <SelectItem value="DAI">DAI</SelectItem>
                  </SelectContent>
                </Select>
                <input
                  value={outputAmount}
                  onChange={(e) => setOutputAmount(e.target.value)}
                  className="bg-transparent border-b border-slate-500 text-right text-white w-24"
                  placeholder="Amount"
                />
              </div>
            </div>

            {/* Target Rate + Expiry Row */}
            <div className="flex items-center justify-between bg-slate-800/30 rounded-lg p-4">
              {/* Target Rate */}
              <div>
                <Label className="text-slate-300 text-sm">Target Rate</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    value={targetRate}
                    onChange={(e) => setTargetRate(e.target.value)}
                    className="bg-transparent border-b border-slate-500 text-white w-28 text-sm"
                    placeholder="e.g. 196.42"
                  />
                  <span className="text-slate-400 text-sm">{outputToken}</span>
                </div>
              </div>

              {/* Expiry */}
              <div>
                <Label className="text-slate-300 text-sm">Expiry</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger className="border-none bg-transparent text-white p-0 h-auto w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="1h">1 Hour</SelectItem>
                    <SelectItem value="6h">6 Hours</SelectItem>
                    <SelectItem value="24h">24 Hours</SelectItem>
                    <SelectItem value="7d">7 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Submit */}
            <Button
              onClick={handleSubmitOrder}
              className="w-full h-12 bg-green-500 hover:bg-green-600 text-black font-semibold text-lg rounded-lg"
            >
              {connected ? "Place Limit Order" : "Connect Wallet to Trade"}
            </Button>
          </CardContent>
        </Card>

        {/* Orders Section */}
        <Card className="cyber-border cyber-glow w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Your Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Open Orders */}
            <div className="space-y-4">
              <h3 className="font-semibold">Open Orders</h3>
              {orders.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No open orders
                </div>
              ) : (
                orders.map((order, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4 border border-border rounded-lg cyber-border"
                  >
                    <div className="flex-1">
                      <div className="text-sm text-muted-foreground">
                        {order.amount.makingAmount.toNumber()}{" "}
                        {order.tokens.inputMint.toString()} →{" "}
                        {order.amount.takingAmount.toNumber()}{" "}
                        {order.tokens.outputMint.toString()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Created At: {order.createdAt.toNumber()} | Expires:{" "}
                        {order.expiredAt.toNumber()}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancelOrder(order.uniqueId, order.maker)}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
            {/* Order History */}
            {/* <div className="space-y-4 mt-8"> */}
            {/*   <h3 className="font-semibold">Order History</h3> */}
            {/*   {orders.filter((o) => o.status !== "pending").length === 0 ? ( */}
            {/*     <div className="text-center py-4 text-muted-foreground"> */}
            {/*       No order history */}
            {/*     </div> */}
            {/*   ) : ( */}
            {/*     orders */}
            {/*       .filter((o) => o.status !== "pending") */}
            {/*       .map((order) => ( */}
            {/*         <div */}
            {/*           key={order.id} */}
            {/*           className="flex items-center justify-between p-4 border border-border rounded-lg cyber-border" */}
            {/*         > */}
            {/*           <div className="flex-1"> */}
            {/*             <Badge className={getStatusColor(order.status)}> */}
            {/*               {order.status.toUpperCase()} */}
            {/*             </Badge> */}
            {/*             <div className="text-sm text-muted-foreground"> */}
            {/*               {order.inputAmount} {order.inputToken} →{" "} */}
            {/*               {order.outputAmount} {order.outputToken} */}
            {/*             </div> */}
            {/*             <div className="text-xs text-muted-foreground"> */}
            {/*               Price: {order.price} | Completed: {order.timestamp} */}
            {/*             </div> */}
            {/*           </div> */}
            {/*         </div> */}
            {/*       )) */}
            {/*   )} */}
            {/* </div> */}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
