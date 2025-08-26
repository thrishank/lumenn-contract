"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X } from "lucide-react";
import { Order } from "@/lib/utils";
import BN from "bn.js";

type OrdersCardProps = {
  orders: Order[];
  cancelOrder: (id: BN, maker: Order["maker"]) => void;
};

export default function OrdersCard({ orders, cancelOrder }: OrdersCardProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5; // number of orders per page

  const totalPages = Math.ceil(orders.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const currentOrders = orders.slice(startIndex, startIndex + pageSize);

  return (
    <Card className="cyber-border cyber-glow w-full max-w-3xl">
      <CardHeader>
        <CardTitle>Your Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <h3 className="font-semibold">Open Orders</h3>

          {orders.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              No open orders
            </div>
          ) : (
            <>
              {currentOrders.map((order, i) => (
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
              ))}

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
