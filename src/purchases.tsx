import { AlertTriangle, Package as PackageIcon, RefreshCw, ShoppingBag, Sparkles } from "lucide-react";
import type { Id, Invoice, InvoiceLine, MembershipAssignment, PackageAssignment, ProductOrder, User } from "./lib/types";
import api from "./lib/api";
import type { ZenotiMembership, ZenotiOrder, ZenotiPackage, ZenotiUserData } from "./lib/api";
import { ApiError } from "./lib/http";
import { useApi } from "./lib/useApi";
import { Loading, Panel } from "./ui";
import { fmtDate, idOf } from "./lib/format";
import { membershipActive } from "./pages/zenoti";
import { buildPackageViews, PackageLine } from "./packages";

/**
 * What this guest has bought — products, treatments paid for, packages and
 * membership — from every place a purchase can land:
 *
 *   bills (Invoice)            desk, app and mirrored Zenoti bills, with lines
 *   product orders             app orders and mirrored counter sales
 *   package assignments        sold at the desk or mirrored from Zenoti
 *   membership assignments     the Zen Membership register
 *   the raw Zenoti copy        counter sales, packages and memberships the
 *                              mirrors have not brought across
 *
 * The card used to read only product orders, package assignments and the
 * `memberType` flag. On prod (2026-09-10) it said "nothing bought" for 102 of
 * 343 sampled guests who had bills, Zenoti sales or a membership, and it turned
 * every failed request into the same "nothing".
 *
 * The same purchase reaches us by more than one route, so bills are canonical:
 * anything carrying a bill's number folds into it (the admin panel's
 * lib/guestLedger.ts rule). No amounts, ever — the consult room shows what was
 * bought, not what it cost.
 */

type Kind = "Service" | "Product" | "Package" | "Membership" | "Mixed";
export type PurchaseRow = { key: string; at: string | null; kind: Kind; items: string; source: "Zenoti" | "App" | "Desk" };
type MembershipView = { active: boolean; name: string; until?: string | null; number?: string | null };

const norm = (v?: string | null) => String(v ?? "").trim().toLowerCase();
const day = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : "");

function buildPurchases(invoices: Invoice[], orders: ProductOrder[], zOrders: ZenotiOrder[], zPkgs: ZenotiPackage[], zMems: ZenotiMembership[]): { rows: PurchaseRow[]; unnamedBills: number } {
  const known = new Set<string>();
  const remember = (v?: string | null) => { if (v) known.add(norm(v)); };
  const rows: PurchaseRow[] = [];
  let unnamedBills = 0;

  /*
   * Zenoti sends a bill's lines only when the bill is opened, so most mirrored
   * bills arrive without items (304 of 330 in the prod sample). When the
   * guest's Zenoti copy carries the same bill number the items are named from
   * it; otherwise the bill is counted, not listed — on prod (2026-09-10) no
   * line-less bill matched by number, and a column of "items unknown" rows
   * buried the purchases that do have names.
   */
  const zByNumber = new Map<string, { name: string; kind: Kind }[]>();
  const addZ = (num: string | null | undefined, name: string | null | undefined, kind: Kind) => {
    if (!num || !name) return;
    zByNumber.set(norm(num), [...(zByNumber.get(norm(num)) ?? []), { name, kind }]);
  };
  zOrders.forEach((z) => addZ(z.invoiceNumber, `${z.name}${z.quantity && z.quantity > 1 ? ` ×${z.quantity}` : ""}`, "Product"));
  // Packages and memberships carry their bill as `invoice.number` (and receipt); product sales as `invoiceNumber`.
  const billNos = (x: unknown) => {
    const r = x as { invoice?: { number?: string | null; receiptNumber?: string | null } | null; invoiceNumber?: string | null };
    return [r.invoice?.number, r.invoice?.receiptNumber, r.invoiceNumber];
  };
  zPkgs.forEach((k) => billNos(k).forEach((n) => addZ(n, k.name, "Package")));
  zMems.forEach((m) => billNos(m).forEach((n) => addZ(n, m.name, "Membership")));
  const kindOf = (l: InvoiceLine): Kind =>
    l.kind === "product" ? "Product" : l.kind === "package" ? "Package" : l.kind === "membership" ? "Membership" : "Service";

  for (const i of invoices) {
    remember(i.invoiceNumber);
    remember(i.receiptNumber);
    remember(i.zenotiInvoiceNumber);
    remember(i.zenotiSource?.invoiceNumber);
    remember(i.zenotiSource?.receiptNumber);
    if (i.status === "void") continue;
    const lines = i.lines ?? [];
    const fromZenoti = lines.length ? [] : [i.invoiceNumber, i.receiptNumber, i.zenotiInvoiceNumber, i.zenotiSource?.invoiceNumber, i.zenotiSource?.receiptNumber]
      .flatMap((n) => (n ? zByNumber.get(norm(n)) ?? [] : []));
    const kinds = new Set(lines.length ? lines.map(kindOf) : fromZenoti.map((z) => z.kind));
    const names = lines.length ? lines.map((l) => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ""}`) : [...new Set(fromZenoti.map((z) => z.name))];
    if (!names.length) { unnamedBills += 1; continue; }
    rows.push({
      key: `inv:${i._id}`,
      at: i.closedAt || i.issuedAt || null,
      kind: kinds.size === 1 ? [...kinds][0] : kinds.size === 0 ? "Service" : "Mixed",
      items: `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`,
      source: i.source === "zenoti" ? "Zenoti" : i.source === "app" ? "App" : "Desk",
    });
  }

  const counterSale = new Set<string>();
  for (const o of orders) {
    if (o.orderStatus === "Cancelled") continue;
    if (o.zenotiInvoiceId && known.has(norm(o.zenotiInvoiceId))) continue;
    if (known.has(norm(o.orderNumber))) continue;
    const items = o.items ?? [];
    if (o.source === "zenoti") items.forEach((it) => counterSale.add(`${norm(it.productName)}|${day(o.createdAt)}`));
    rows.push({
      key: `ord:${o._id}`,
      at: o.createdAt ?? null,
      kind: "Product",
      items: items.slice(0, 3).map((it) => `${it.productName ?? "Product"}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`).join(", ")
        + (items.length > 3 ? ` +${items.length - 3} more` : ""),
      source: o.source === "zenoti" ? "Zenoti" : "App",
    });
  }

  zOrders.forEach((z, i) => {
    if (z.invoiceNumber && known.has(norm(z.invoiceNumber))) return;
    if (counterSale.has(`${norm(z.name)}|${day(z.saleDate)}`)) return;
    rows.push({
      key: `zord:${i}`,
      at: z.saleDate ?? null,
      kind: "Product",
      items: `${z.name ?? "Product"}${z.quantity && z.quantity > 1 ? ` ×${z.quantity}` : ""}`,
      source: "Zenoti",
    });
  });

  const t = (v: string | null) => (v ? new Date(v).getTime() : 0);
  return { rows: rows.sort((a, b) => t(b.at) - t(a.at)), unnamedBills };
}

function membershipView(assignments: MembershipAssignment[], zMems: ZenotiMembership[], patient?: User | null): MembershipView | null {
  const now = Date.now();
  const nameOf = (m: MembershipAssignment) => m.snapshot?.name || (typeof m.membershipId === "object" ? m.membershipId?.name : null) || "Zen Membership";
  const live = assignments.find((m) => m.status === "Active" && (!m.validUntil || new Date(m.validUntil).getTime() > now));
  if (live) return { active: true, name: nameOf(live), until: live.validUntil, number: live.memberNumber };
  const zLive = zMems.find(membershipActive);
  if (zLive) return { active: true, name: zLive.name ?? "Zen Membership", until: zLive.expiryDate };
  if (patient?.memberType === "Zen Member") return { active: true, name: "Zen Membership", until: patient.zenMembershipExpiryDate };
  const past = [...assignments].sort((a, b) => new Date(b.validUntil ?? 0).getTime() - new Date(a.validUntil ?? 0).getTime())[0];
  if (past) return { active: false, name: nameOf(past), until: past.validUntil };
  if (zMems[0]) return { active: false, name: zMems[0].name ?? "Membership", until: zMems[0].expiryDate };
  return null;
}

export function useGuestPurchases(userId: Id | "" | null | undefined) {
  return useApi(async () => {
    if (!userId) return null;
    const settled = await Promise.allSettled([
      api.invoices.list({ userId, limit: 200 }).then((r) => (r.data ?? []).filter((i) => !i.userId || idOf(i.userId) === userId)),
      api.orders.list({ userId, limit: 200 }).then((r) => (r.data ?? []).filter((o) => idOf(o.userId) === userId)),
      api.packageAssignments.list({ userId, limit: 100 }).then((r) => (r.data ?? []).filter((a) => idOf(a.userId) === userId)),
      api.memberships.members({ userId, status: "all", limit: 50 }).then((rows) => (rows ?? []).filter((m) => idOf(m.userId) === userId)),
      // A guest who never came through Zenoti has no mirror; that is not a failure.
      api.zenoti.user(userId).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }),
    ]);
    const pick = <T,>(r: PromiseSettledResult<T>, fallback: T): T => (r.status === "fulfilled" ? r.value : fallback);
    const invoices = pick(settled[0] as PromiseSettledResult<Invoice[]>, []);
    const orders = pick(settled[1] as PromiseSettledResult<ProductOrder[]>, []);
    const assignments = pick(settled[2] as PromiseSettledResult<PackageAssignment[]>, []);
    const memberships = pick(settled[3] as PromiseSettledResult<MembershipAssignment[]>, []);
    const zenoti = pick(settled[4] as PromiseSettledResult<ZenotiUserData | null>, null);
    const zd = zenoti?.details;
    return {
      ...(() => { const b = buildPurchases(invoices, orders, zd?.orders ?? [], zd?.packages ?? [], zd?.memberships ?? []); return { purchases: b.rows, unnamedBills: b.unnamedBills }; })(),
      packages: buildPackageViews(assignments, zd?.packages ?? []),
      memberships,
      zMems: zd?.memberships ?? [],
      failed: settled.filter((s) => s.status === "rejected").length,
    };
  }, [userId]);
}

const KIND_TONE: Record<Kind, string> = { Service: "", Product: "dz-pill--info", Package: "dz-pill--line", Membership: "dz-pill--ok", Mixed: "dz-pill--line" };

export default function GuestPurchases({ userId, patient, compact, hidePackages }: {
  userId: Id | "" | null | undefined;
  patient?: User | null;
  /** Sidebar version: fewer rows. */
  compact?: boolean;
  /** The page already shows packages in their own panel — don't list them twice. */
  hidePackages?: boolean;
}) {
  const q = useGuestPurchases(userId);
  const d = q.data;
  const membership = d ? membershipView(d.memberships, d.zMems, patient) : null;
  const pkgs = hidePackages ? [] : d?.packages ?? [];
  const activePkgs = pkgs.filter((p) => p.active);
  const finishedPkgs = pkgs.length - activePkgs.length;
  const nothing = !!d && d.purchases.length === 0 && d.unnamedBills === 0 && pkgs.length === 0 && !membership;
  const limit = compact ? 4 : 25;

  return (
    <Panel icon={<ShoppingBag />} title="What they’ve bought"
      sub={compact ? undefined : "Purchases, packages and membership from the app, the desk and Zenoti — no prices in the consult room"}
      right={q.error || d?.failed ? <button type="button" className="dz-link" onClick={q.reload}><RefreshCw />Retry</button> : undefined}>
      {q.initial && !d ? <Loading label="" rows={2} /> : q.error && !d ? (
        <div className="dz-note dz-note--warn"><AlertTriangle /><span>Couldn’t load what this guest has bought.</span></div>
      ) : !d ? null : nothing ? (
        d.failed
          ? <div className="dz-note dz-note--warn"><AlertTriangle /><span>Part of the purchase history couldn’t load, so this guest may have bought more than shows here.</span></div>
          : <div className="dz-hint">No purchases on record — nothing from the app, the desk or Zenoti.</div>
      ) : (
        <div className="dz-stack--sm">
          {membership && (membership.active ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-sage px-3 py-2.5">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 text-[14px] font-bold text-ink">{membership.name}</span>
              <span className="shrink-0 text-[13px] text-ink2">{membership.until ? `until ${fmtDate(membership.until)}` : "active"}</span>
            </div>
          ) : (
            <div className="text-[13.5px] text-ink3">{membership.name} ended{membership.until ? ` ${fmtDate(membership.until)}` : ""}.</div>
          ))}

          {activePkgs.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[13px] font-extrabold text-ink2"><PackageIcon className="h-4 w-4" />Packages</div>
              {activePkgs.slice(0, limit).map((p) => <PackageLine key={p.key} v={p} />)}
            </div>
          )}
          {finishedPkgs > 0 && <div className="text-[13px] text-ink3">{finishedPkgs} earlier package{finishedPkgs === 1 ? "" : "s"}, used up or expired.</div>}

          {(d.purchases.length > 0 || d.unnamedBills > 0) && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[13px] font-extrabold text-ink2"><ShoppingBag className="h-4 w-4" />Purchases{d.purchases.length ? ` · ${d.purchases.length}` : ""}</div>
              {d.purchases.slice(0, limit).map((r) => (
                <div key={r.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border py-2.5 last:border-0">
                  <span className="w-[88px] shrink-0 text-[13px] text-ink3">{r.at ? fmtDate(r.at) : "—"}</span>
                  <span className="min-w-0 flex-1 text-[14px] text-ink">{r.items}</span>
                  <span className={`dz-pill dz-pill--sm ${KIND_TONE[r.kind]}`}>{r.kind === "Service" ? "Treatment" : r.kind}</span>
                </div>
              ))}
              {d.purchases.length > limit && <div className="pt-1 text-[13px] text-ink3">+{d.purchases.length - limit} earlier</div>}
              {d.unnamedBills > 0 && (
                <div className="pt-1.5 text-[13px] text-ink3">
                  {d.purchases.length ? "Also " : ""}{d.unnamedBills} clinic bill{d.unnamedBills === 1 ? "" : "s"} from Zenoti without item detail yet.
                </div>
              )}
            </div>
          )}

          {d.failed > 0 && <div className="dz-hint">Part of the history couldn’t load — tap Retry.</div>}
        </div>
      )}
    </Panel>
  );
}
