import type { ProductAvailability } from "./lib/types";
import { Tag } from "./ui";

/**
 * Whether an item is on the shelf, in the one wording the whole panel uses.
 *
 * It lives on its own because two places ask the question — the Product
 * availability page and the prescription builder's stock search — and a
 * dermatologist reading "Low · 3 left" in one and "3 in stock" in the other
 * would reasonably wonder whether they meant different things.
 *
 * "Available" is not the same as "in stock": it means the clinic can order the
 * item but does not count it (Zenoti exposes no quantity for these), so a
 * number would be invented.
 */
export default function StockPill({ status, qty }: { status: ProductAvailability["status"]; qty: number }) {
  if (status === "available") return <Tag kind="info">Available</Tag>;
  if (status === "out_of_stock") return <Tag kind="err">Out of stock</Tag>;
  if (status === "low_stock") return <Tag kind="warn">Low · {qty} left</Tag>;
  return <Tag kind="ok">In stock · {qty}</Tag>;
}
