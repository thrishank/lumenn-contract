"use client";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
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
import { TrendingUp, ArrowUpDown } from "lucide-react";
import {
  ADDRESS_TREE,
  connection,
  getOpenOrders,
  PROGRAM_ID,
  rpc,
  useProgram,
} from "./program";
import { Order, parseOrderFromBuffer, randomU64 } from "@/lib/utils";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  bn,
  deriveAddress,
  deriveAddressSeed,
} from "@lightprotocol/stateless.js";
import {
  ADDRESS_QUEUE,
  CLOSE_ACCOUNTS,
  INIT_REMAINING_ACCOUNTS,
} from "@/lib/address";
import { fetch_quote, search_tokens, Token } from "@/lib/jup";
import { TokenSearchBox } from "@/components/token-search";
import OrdersCard from "@/components/orders-card";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

export default function App() {
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

  const [inputToken, setInputToken] = useState<Token>({
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
    id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    name: "USDC",
    symbol: "USDC",
    decimals: 6,
    token_program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  });
  const [outputToken, setOutputToken] = useState<Token>({
    icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    id: "So11111111111111111111111111111111111111112",
    name: "Solana",
    symbol: "SOL",
    decimals: 9,
    token_program: TOKEN_PROGRAM_ID.toString(),
  });

  const [inputAmount, setInputAmount] = useState(5.0);
  const [outputAmount, setOutputAmount] = useState(0.0);

  useEffect(() => {
    async function fetchOutputAmount() {
      const data = await fetch_quote(
        inputToken,
        outputToken,
        inputAmount * 10 ** inputToken.decimals
      );
      setOutputAmount(
        data!.outAmount ? data!.outAmount / 10 ** outputToken.decimals : 0
      );
      setTargetRate(data?.current_ratio);
    }
    fetchOutputAmount();
  }, [inputAmount, inputToken]);

  const [expiry, setExpiry] = useState("never");
  const [targetRate, setTargetRate] = useState<number>();

  useEffect(() => {
    setOutputAmount(inputAmount * (targetRate || 0));
  }, [targetRate]);

  const [searchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Token[]>([]);

  useEffect(() => {
    const fetchTokens = async () => {
      // TODO: show this list when the wallet is not connected
      // if connected then show the tokens in his wallet
      if (searchQuery.length < 2) {
        setSearchResults([
          {
            icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
            id: "So11111111111111111111111111111111111111112",
            name: "Solana",
            symbol: "SOL",
            decimals: 9,
            token_program: TOKEN_PROGRAM_ID.toString(),
          },
          {
            icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
            id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            name: "USDC",
            symbol: "USDC",
            decimals: 6,
            token_program: TOKEN_PROGRAM_ID.toString(),
          },
          {
            icon: "https://raw.githubusercontent.com/ZeusNetworkHQ/zbtc-metadata/refs/heads/main/lgoo-v2.png",
            id: "zBTCug3er3tLyffELcvDNrKkCymbPWysGcWihESYfLg",
            name: "zBTC",
            symbol: "zBTC",
            decimals: 9,
            token_program: TOKEN_PROGRAM_ID.toString(),
          },
          {
            icon: "https://static.jup.ag/jup/icon.png",
            id: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
            name: "Solana",
            symbol: "Jupiter",
            decimals: 6,
            token_program: TOKEN_PROGRAM_ID.toString(),
          },
        ]);
        return;
      }
      const tokens = await search_tokens(searchQuery);
      setSearchResults(tokens);
    };
    fetchTokens();
  }, [searchQuery]);

  const handleSubmitOrder = async () => {
    if (
      !inputToken ||
      !outputToken ||
      !inputAmount ||
      !outputAmount ||
      !expiry ||
      !publicKey
    )
      return;

    const unique_id = new BN(randomU64());

    const seeds: Uint8Array[] = [
      Buffer.from("escrow"),
      unique_id.toArrayLike(Buffer, "le", 8),
      publicKey.toBuffer(),
    ];

    const assetSeed = deriveAddressSeed(seeds, program!.programId);
    const address = deriveAddress(assetSeed, ADDRESS_TREE);

    const proof = await rpc.getValidityProofV0(undefined, [
      {
        address: bn(address.toBytes()),
        tree: ADDRESS_TREE,
        queue: ADDRESS_QUEUE,
      },
    ]);

    const validityProof = proof.compressedProof;

    console.log(expiry);

    if (!program || !validityProof) return;

    const instruction = await program.methods
      .initializeOrder(
        {
          uniqueId: unique_id,
          makingAmount: new BN(inputAmount * 10 ** inputToken.decimals),
          takingAmount: new BN(outputAmount * 10 ** outputToken.decimals),
          expiredAt: new BN(123141242141),
          slippageBps: 50,
        },
        {
          proof: {
            0: {
              a: validityProof.a,
              b: validityProof.b,
              c: validityProof.c,
            },
          },
          addressTreeInfo: {
            addressMerkleTreePubkeyIndex: 0,
            addressQueuePubkeyIndex: 2,
            rootIndex: proof.rootIndices[0],
          },
          outputStateTreeIndex: 1,
        }
      )
      .accounts({
        payer: publicKey,
        maker: publicKey,
        inputMint: new PublicKey("9stjYtrbCfYShqHuesfXk5od2V9P6Q7cs2eWdjQjyGJ"),
        outputMint: new PublicKey(
          "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        ),
        inputTokenProgram: inputToken.token_program,
        outputTokenProgram: outputToken.token_program,
      })
      .remainingAccounts(INIT_REMAINING_ACCOUNTS)
      .instruction();

    const instructions = [];

    if (inputToken.symbol === "SOL") {
      const sol_mint = new PublicKey(inputToken.id);
      const ata = await getAssociatedTokenAddress(sol_mint, publicKey);
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          ata,
          publicKey,
          sol_mint
        )
      );

      instructions.push(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: ata,
          lamports: inputAmount * LAMPORTS_PER_SOL,
        })
      );

      instructions.push(createSyncNativeInstruction(ata));

      instructions.push(instruction);

      instructions.push(
        createCloseAccountInstruction(ata, publicKey, publicKey)
      );
    } else {
      instructions.push(instruction);
    }

    const latestBlockhash = await rpc.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ...instructions,
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);

    await sendTransaction(tx, connection);

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
    setInputAmount(5);
    setOutputAmount(0);
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

    // TODO: handle wsol

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

  // const getStatusColor = (status: string) => {
  //   switch (status) {
  //     case "pending":
  //       return "bg-secondary text-secondary-foreground";
  //     case "filled":
  //       return "bg-primary text-primary-foreground";
  //     case "expired":
  //       return "bg-muted text-muted-foreground";
  //     case "cancelled":
  //       return "bg-destructive text-destructive-foreground";
  //     default:
  //       return "bg-muted text-muted-foreground";
  //   }
  // };

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
                <TokenSearchBox
                  selectedToken={inputToken}
                  setSelectedToken={setInputToken}
                />
                <input
                  inputMode="decimal"
                  value={inputAmount}
                  onChange={(e) => setInputAmount(Number(e.target.value))}
                  className="bg-transparent border-b border-slate-500 text-right text-white w-24"
                  placeholder="Amount"
                />
              </div>
            </div>

            <div className="flex justify-center my-3">
              <button
                type="button"
                onClick={() => {
                  const tempToken = inputToken;
                  setInputToken(outputToken);
                  setOutputToken(tempToken);

                  // swap amounts too
                  const tempAmount = inputAmount;
                  setInputAmount(outputAmount);
                  setOutputAmount(tempAmount);
                }}
                className="p-2 rounded-full bg-slate-700 hover:bg-slate-600 transition"
              >
                <ArrowUpDown className="h-5 w-5 text-white" />
              </button>
            </div>

            {/* Buying */}
            <div className="bg-slate-800/30 rounded-lg p-4">
              <Label className="text-slate-300">Buying</Label>
              <div className="flex items-center justify-between mt-2">
                <TokenSearchBox
                  selectedToken={outputToken}
                  setSelectedToken={setOutputToken}
                />
                <input
                  inputMode="decimal"
                  value={outputAmount}
                  onChange={(e) => setOutputAmount(Number(e.target.value))}
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
                    inputMode="decimal"
                    value={targetRate}
                    onChange={(e) => setTargetRate(Number(e.target.value))}
                    className="bg-transparent border-b border-slate-500 text-white w-28 text-sm"
                    placeholder="e.g. 196.42"
                  />
                  <span className="text-slate-400 text-sm">
                    {outputToken.name}
                  </span>
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

        <OrdersCard orders={orders} cancelOrder={cancelOrder} />

        {/* Orders Section */}
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
      </div>
    </div>
  );
}
