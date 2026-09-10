import { Package as PackageIcon, ShoppingBag, Sparkles } from "lucide-react";
import type { Id, PackageAssignment, ProductOrder, User } from "./lib/types";
import api from "./lib/api";
import { useApi } from "./lib/useApi";
import { Async, Card, SecH, Tag } from "./ui";
import { fmtDate, idOf } from "./lib/format";

/**
 * What this guest has actually bought — products, packages, membership.
 *
 * A dermatologist could previously see what they had prescribed but not what
 * the guest went on to buy, which makes the most useful question in a review
 * consultation unanswerable: are they using the sunscreen, did they ever pick
 * up the course, is the package they are asking about already paid for. The
 * patient record deliberately withheld retail orders as "the clinic's
 * business"; in the consult room it is clinical history.
 *
 * Prices are NOT shown. That is the same line the rest of the doctor panel
 * draws — product availability rather than the product catalogue, quantities
 * never costs — and what a course cost changes no clinical decision. Amounts
 * stay in the admin panel, where billing lives.
 */

type OrderLine = { name: string; qty: number };

const linesOf = (o: ProductOrder): OrderLine[] =>
  (o.items ?? []).map((i) => ({
    name: i.productName
      ?? (typeof i.productId === "object" && i.productId ? (i.productId as { name?: string }).name : undefined)
      ?? "Product",
    qty: i.quantity ?? 1,
  }));

/** Delivered / cancelled / on its way — the part that matters to a doctor. */
function orderTone(status: string): "ok" | "warn" | "err" | "mute" {
  const s = String(status || "").toLowerCase();
  if (s.includes("deliver") && !s.includes("failed")) return "ok";
  if (s.includes("cancel") || s.includes("fail") || s.includes("return")) return "err";
  if (s.includes("pending") || s.includes("process") || s.includes("ship") || s.includes("confirm")) return "warn";
  return "mute";
}

export function useGuestPurchases(userId: Id | "" | null | undefined) {
  return useApi(async () => {
    if (!userId) return { orders: [] as ProductOrder[], packages: [] as PackageAssignment[] };
    const [orders, packages] = await Promise.all([
      /*
       * Both sources on purpose. ProductOrder carries app orders AND the
       * counter sales mirrored from Zenoti, and the panel's usual default is
       * app-only — but "what has this guest bought" has to include what they
       * bought at the desk, which is most of it.
       */
      api.orders.list({ userId, limit: 50 })
        .then((r) => (r.data ?? []).filter((o) => idOf(o.userId) === userId)).catch(() => [] as ProductOrder[]),
      api.packageAssignments.list({ userId, limit: 50 })
        .then((r) => (r.data ?? []).filter((a) => idOf(a.userId) === userId)).catch(() => [] as PackageAssignment[]),
    ]);
    return { orders, packages };
  }, [userId]);
}

/**
 * The card itself. `patient` supplies the membership, which lives on the
 * account rather than in either list.
 */
export default function GuestPurchases({ userId, patient, compact }: {
  userId: Id | "" | null | undefined;
  patient?: User | null;
  /** Sidebar version: fewer rows, no headings. */
  compact?: boolean;
}) {
  const q = useGuestPurchases(userId);
  const isZenMember = patient?.memberType === "Zen Member";
  const membershipEnds = patient?.zenMembershipExpiryDate;
  const limit = compact ? 4 : 20;

  return (
    <Card className="p-4">
      <SecH t="What they've bought" em={compact ? undefined : "Products, packages and membership — no prices in the consult room"} />
      <Async q={q} label="" rows={2}>
        {({ orders, packages }) => {
          const nothing = orders.length === 0 && packages.length === 0 && !isZenMember;
          if (nothing) {
            return <div className="text-[11.5px] text-ink3">Nothing bought yet — no products, packages or membership on this guest.</div>;
          }
          return (
            <div className="grid gap-3">
              {isZenMember && (
                <div className="flex items-center gap-2 rounded-lg bg-sage px-2.5 py-2">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="text-[12px] font-semibold text-ink">Zen Member</span>
                  {membershipEnds && <span className="text-[11px] text-ink3">until {fmtDate(membershipEnds)}</span>}
                </div>
              )}

              {packages.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink3">
                    <PackageIcon className="h-3 w-3" /> Packages
                  </div>
                  <div className="grid gap-1">
                    {packages.slice(0, limit).map((a) => {
                      const used = a.usageTracking?.usedSessions ?? 0;
                      const total = a.usageTracking?.totalSessions ?? 0;
                      return (
                        <div key={a._id} className="flex items-center gap-2 border-b border-border/60 py-1 last:border-0 text-[11.5px]">
                          <span className="min-w-0 flex-1 truncate text-ink2">{a.packageDetails?.packageName ?? "Package"}</span>
                          {total > 0 && (
                            <span className={`shrink-0 tabular-nums ${used >= total ? "text-ink3" : "font-semibold text-ink"}`}>
                              {used}/{total} used
                            </span>
                          )}
                          <Tag kind={a.status === "Active" ? "ok" : a.status === "Completed" ? "mute" : "warn"}>{a.status}</Tag>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {orders.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink3">
                    <ShoppingBag className="h-3 w-3" /> Products
                  </div>
                  <div className="grid gap-1">
                    {orders.slice(0, limit).map((o) => (
                      <div key={o._id} className="border-b border-border/60 py-1 last:border-0">
                        <div className="flex items-center gap-2 text-[11.5px]">
                          <span className="shrink-0 text-ink3">{fmtDate(o.createdAt)}</span>
                          <span className="min-w-0 flex-1 truncate text-ink2">
                            {linesOf(o).map((l) => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ""}`).join(", ") || "—"}
                          </span>
                          <Tag kind={orderTone(o.orderStatus)}>{o.orderStatus}</Tag>
                        </div>
                      </div>
                    ))}
                    {orders.length > limit && (
                      <div className="pt-1 text-[11px] text-ink3">+{orders.length - limit} earlier order{orders.length - limit === 1 ? "" : "s"}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        }}
      </Async>
    </Card>
  );
}
