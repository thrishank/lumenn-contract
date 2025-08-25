import { Elara } from "../../target/types/elara";
import IDL from "../../target/idl/elara.json";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { createRpc } from "@lightprotocol/stateless.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { Order, parseOrderFromBuffer } from "@/lib/utils";

export const useProgram = () => {
  const { connection } = useConnection();

  const wallet = useAnchorWallet();
  if (!wallet) return null;

  const provider = new AnchorProvider(connection, wallet, {});
  const program = new Program<Elara>(IDL as Elara, provider);

  return program;
};

const url =
  "https://devnet.helius-rpc.com/?api-key=c991f045-ba1f-4d71-b872-0ef87e7f039d";

export const connection = new Connection(url);

export const rpc = createRpc(url, url, url);

export const PROGRAM_ID = new PublicKey(
  "4LhEEtzAhM6wEXJR2YQHPEs79UEx8e6HncmeHbqbW1w1"
);

export const ADDRESS_TREE = new PublicKey(
  "amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2"
);

export async function getOpenOrders(address: PublicKey): Promise<Order[]> {
  const data = await rpc.getCompressedAccountsByOwner(
    new PublicKey("4LhEEtzAhM6wEXJR2YQHPEs79UEx8e6HncmeHbqbW1w1"),
    {
      filters: [
        {
          memcmp: {
            offset: 0,
            encoding: "base58",
            bytes: address.toBase58(),
          },
        },
      ],
    }
  );

  const orders: Order[] = [];

  data.items.forEach((item) => {
    const buffer = item.data?.data;
    const order = parseOrderFromBuffer(buffer!);
    orders.push(order);
  });

  return orders;
}
