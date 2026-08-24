/**
 * Every backend call the unified panel makes, grouped by module.
 *
 * Paths are relative to `/api`. Anything returning `{ success, data }` is
 * unwrapped by `request`; endpoints that also carry `stats`/`count`/
 * `pagination` use `requestRaw` and return the whole envelope.
 */
import { request, requestRaw, type Envelope, type Query } from "./http";
import type {
  Admin, AppCustomization, AuditEntry, Banner, Booking, BookingSession, Branch, Brand, Category, Chat, ChatMessage, DeletedAccount, StockMovement,
  Consultation, ConsentForm, ConsultationNote, ConsultationReview, Coupon, DermatologistSchedule,
  Doctor, DoctorAvailability, WeeklyBlock,
  DoctorFeeRequest, Formulation, MyFee, ScheduleDay, SlotDay,
  Id, Inventory, Notification, Package, PackageAssignment, PreConsultForm, Product, ProductOrder,
  ProductReview, ServiceCard, ServiceReview, ServiceType, SupportMessage, TaxonomyTree, User, Vendor,
} from "./types";
import type { VisitCodeLog } from "./types";

/* ============================ auth ============================ */
export const auth = {
  checkEmail: (email: string) =>
    requestRaw<{ authorized: boolean }>("/admin/auth/check-email", {
      method: "POST", body: { email }, anonymous: true,
    }),
  requestOtp: (email: string) =>
    requestRaw("/admin/auth/login", { method: "POST", body: { email }, anonymous: true }),
  resendOtp: (email: string) =>
    requestRaw("/admin/auth/resend-otp", { method: "POST", body: { email }, anonymous: true }),
  /** Password sign-in for staff who were given one (dermatologists, therapists). */
  loginPassword: (email: string, password: string) =>
    request<{ token: string; admin: Admin; expiresAt: string }>("/admin/auth/login-password", {
      method: "POST", body: { email, password }, anonymous: true,
    }),
  verifyOtp: (email: string, otp: string) =>
    request<{ token: string; admin: Admin; expiresAt: string }>("/admin/auth/verify-otp", {
      method: "POST", body: { email, otp }, anonymous: true,
    }),
  me: () => request<Admin>("/admin/auth/me"),
  logout: () => requestRaw("/admin/auth/logout", { method: "POST" }),
  /** Change my own login email / phone. Changing the email needs the current password. */
  updateContact: (body: { email?: string; phone?: string; currentPassword?: string }) =>
    request<Admin>("/admin/auth/me/contact", { method: "PUT", body }),
  /** Change my own password (current password required once one is set). */
  updatePassword: (currentPassword: string, newPassword: string) =>
    requestRaw("/admin/auth/me/password", { method: "PUT", body: { currentPassword, newPassword } }),
};

/* ============================ branches ============================ */
export const branches = {
  list: (q?: Query) => request<Branch[]>("/branches", { query: q }),
  get: (id: Id) => request<Branch>(`/branches/${id}`),
  slots: (id: Id, date: string) =>
    request<{ slots: string[]; branch?: string; date?: string }>(`/branches/${id}/slots`, { query: { date } }),
  create: (body: Partial<Branch>) => request<Branch>("/branches", { method: "POST", body }),
  update: (id: Id, body: Partial<Branch>) => request<Branch>(`/branches/${id}`, { method: "PUT", body }),
  toggle: (id: Id) => request<Branch>(`/branches/${id}/toggle-status`, { method: "PATCH" }),
  remove: (id: Id, permanent = false) =>
    requestRaw(`/branches/${id}`, { method: "DELETE", query: { permanent } }),
  reorder: (order: { id: Id; displayOrder: number }[]) =>
    requestRaw("/branches/reorder", { method: "PATCH", body: { branches: order } }),
};

/* ============================ patients (users) ============================ */
export type UserListEnvelope = Envelope<{
  users: User[];
  pagination: { currentPage: number; totalPages: number; totalUsers: number };
  statistics: { totalPatients: number; activePatients: number; [k: string]: number };
}>;

export const patients = {
  list: (q?: Query) =>
    requestRaw<{
      users: User[];
      pagination: { currentPage: number; totalPages: number; totalUsers: number };
      statistics: Record<string, number>;
    }>("/admin/users", { query: q }),
  get: (id: Id) => request<User>(`/admin/users/${id}`),
  create: (body: Partial<User>) => request<User>("/admin/users", { method: "POST", body }),
  update: (id: Id, body: Partial<User> | FormData) =>
    request<User>(`/admin/users/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/users/${id}`, { method: "DELETE" }),
  toggleStatus: (id: Id, isActive?: boolean) =>
    request<User>(`/admin/users/${id}/status`, { method: "PATCH", body: isActive === undefined ? {} : { isActive } }),
  /** Deleted accounts — restorable archive (see DeletedAccountArchive). */
  deleted: (q?: Query) => requestRaw<DeletedAccount[]>("/admin/users/deleted", { query: q }),
  restore: (archiveId: Id) =>
    request<{ userId: Id }>(`/admin/users/deleted/${archiveId}/restore`, { method: "POST", body: {} }),
  /** Grant/extend a Zen membership from the desk. Months + payment method + amount are required server-side. */
  assignMembership: (id: Id, body: { months: number; paymentMethod: string; amount?: number; paymentReceived?: boolean; startDate?: string; autoRenew?: boolean; plan?: string; notes?: string; transactionId?: string }) =>
    request<User>(`/admin/users/${id}/membership`, { method: "POST", body }),
  cancelMembership: (id: Id) => request<User>(`/admin/users/${id}/membership`, { method: "DELETE" }),
  markMembershipPaid: (id: Id, body?: { paymentMethod?: string; transactionId?: string; amount?: number }) => request<unknown>(`/admin/users/${id}/membership/paid`, { method: "POST", body }),
  exportAll: (q?: Query) => request<Record<string, unknown>[]>("/admin/users/export", { query: q }),
};

/* ============================ bookings ============================ */
export type NewBooking = {
  consultationId: Id;
  fullName: string;
  mobileNumber: string;
  email?: string;
  preferredLocation: string;
  preferredDate: string;
  preferredTimeSlots: string[];
  specialistId?: string;
  specialistName?: string;
  specialistTier?: string;
  amount?: number;
  paymentStatus?: string;
  notes?: string;
  confirmNow?: boolean;
  userId?: Id;
  gender?: string;
  dateOfBirth?: string;
};

export type DermPick = { specialistId?: string; specialistName?: string };

export const bookings = {
  /** Same filters as `list`; returns labelled rows for CSV. `fields` trims columns. */
  export: (q?: Query) => request<Record<string, unknown>[]>("/bookings/admin/export", { query: q }),
  /** Staff send/resend the guest's check-in or check-out code (email / whatsapp / both). */
  sendVisitCode: (id: Id, body: { kind: "checkin" | "checkout"; channel: "email" | "whatsapp" | "both"; regenerate?: boolean }) =>
    request<{ kind: string; delivered: string[]; failed: { channel: string; reason: string }[]; sentAt: string; log: VisitCodeLog[] }>(`/bookings/admin/${id}/visit-code`, { method: "POST", body }),
  /** Manual (no-code) check-in/out — requires a reason, recorded on the booking. */
  manualCheckIn: (id: Id, reason: string, derm?: DermPick) => request<Booking>(`/bookings/admin/${id}/checkin`, { method: "PUT", body: { reason, ...derm } }),
  /** Put a dermatologist on the booking — roster id or a custom name. */
  setDermatologist: (id: Id, derm: DermPick) => request<Booking>(`/bookings/admin/${id}/dermatologist`, { method: "PUT", body: derm }),
  /** Admin-only: read the current code (support fallback; audited). */
  revealVisitCode: (id: Id) => request<{ kind: "checkin" | "checkout"; code: string; generatedAt?: string | null; sentAt?: string | null }>(`/bookings/admin/${id}/visit-code`),
  manualCheckOut: (id: Id, reason: string, session?: BookingSession) => request<Booking>(`/bookings/admin/${id}/checkout`, { method: "PUT", body: { reason, session } }),
  /**
   * Admin day-book / list. Filters: status, location|branchId, date (YYYY-MM-DD),
   * startDate/endDate, search, userId, specialistId, therapistId, page/limit.
   * The envelope carries `total` and `statusCounts` for the tab badges.
   */
  list: (q?: Query) =>
    requestRaw<Booking[]>("/bookings/admin/all", { query: q }) as Promise<
      Envelope<Booking[]> & { total?: number; statusCounts?: Record<string, number> }
    >,
  get: (id: Id) => request<Booking>(`/bookings/admin/${id}`),
  create: (body: NewBooking) => request<Booking>("/bookings/admin", { method: "POST", body }),
  reschedule: (id: Id, body: { preferredDate: string; confirmedTime?: string; preferredTimeSlots?: string[]; reason?: string }) =>
    request<Booking>(`/bookings/admin/${id}/reschedule`, { method: "PUT", body }),
  /** Decline a guest's reschedule request → reverts to their original slot. */
  rejectReschedule: (id: Id) =>
    request<Booking>(`/bookings/admin/${id}/reject-reschedule`, { method: "PUT", body: {} }),
  confirm: (id: Id, body?: { confirmedDate?: string; confirmedTime?: string; adminNotes?: string }) =>
    request<Booking>(`/bookings/admin/${id}/confirm`, { method: "PUT", body: body ?? {} }),
  checkIn: (id: Id) => request<Booking>(`/bookings/admin/${id}/checkin`, { method: "PUT" }),
  checkOut: (id: Id, body?: { notes?: string; session?: BookingSession }) =>
    request<Booking>(`/bookings/admin/${id}/checkout`, { method: "PUT", body: body ?? {} }),
  /** OTP-gated: the guest reads the code from their app; staff enter it here. */
  verifyCheckIn: (id: Id, code: string, derm?: DermPick) =>
    request<Booking>(`/bookings/admin/${id}/verify-checkin`, { method: "PUT", body: { code, ...derm } }),
  verifyCheckOut: (id: Id, code: string, notes?: string, session?: BookingSession) =>
    request<Booking>(`/bookings/admin/${id}/verify-checkout`, { method: "PUT", body: { code, notes, session } }),
  noShow: (id: Id, body?: { adminNotes?: string }) =>
    request<Booking>(`/bookings/admin/${id}/no-show`, { method: "PUT", body: body ?? {} }),
  cancel: (id: Id, reason: string) =>
    request<Booking>(`/bookings/admin/${id}/cancel`, { method: "PUT", body: { reason } }),
  /** Desk payment — cash/card/UPI/package; `amount` overrides what the booking carries. */
  setPayment: (id: Id, body: { paymentStatus?: "pending" | "paid" | "failed" | "refunded"; paymentMethod?: string; amount?: number; note?: string }) =>
    request<Booking>(`/bookings/admin/${id}/payment`, { method: "PUT", body }),
  addNote: (id: Id, note: string) =>
    request<Booking>(`/bookings/admin/${id}/notes`, { method: "PUT", body: { note } }),
  availableSlots: (q: Query) => request<{ slots?: string[]; availableSlots?: string[] }>("/bookings/available-slots", { query: q }),
  cleanupExpired: () => requestRaw("/bookings/admin/cleanup-expired", { method: "POST" }),
};

/* ============================ services (consultations) ============================ */
export const services = {
  list: (q?: Query) => requestRaw<Consultation[]>("/consultations", { query: q }),
  get: (idOrSlug: string) => request<Consultation>(`/consultations/${idOrSlug}`),
  featured: (limit = 6) => request<Consultation[]>("/consultations/featured", { query: { limit } }),
  categories: () => request<string[] | Category[]>("/consultations/categories/list"),
  byCategory: (category: string, limit = 50) =>
    request<Consultation[]>(`/consultations/category/${encodeURIComponent(category)}`, { query: { limit } }),
  search: (query: string, limit = 20) =>
    request<Consultation[]>(`/consultations/search/${encodeURIComponent(query)}`, { query: { limit } }),
  stats: () => request<Record<string, unknown>>("/consultations/stats/overview"),
  create: (body: Partial<Consultation>) => request<Consultation>("/consultations", { method: "POST", body }),
  update: (id: Id, body: Partial<Consultation>) =>
    request<Consultation>(`/consultations/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/consultations/${id}`, { method: "DELETE" }),
  toggle: (id: Id) => request<Consultation>(`/consultations/${id}/toggle`, { method: "PATCH" }),
  reorder: (order: { id: Id; displayOrder: number }[]) =>
    requestRaw("/consultations/reorder", { method: "PATCH", body: { order } }),
};

/* ============================ service types ============================ */
export const serviceTypes = {
  list: (q?: Query) => requestRaw<ServiceType[]>("/service-types", { query: q }),
  /** Types → categories → sub-categories in one call. */
  tree: () => request<TaxonomyTree>("/service-types/tree"),
  create: (body: Partial<ServiceType>) => request<ServiceType>("/service-types", { method: "POST", body }),
  update: (id: Id, body: Partial<ServiceType>) =>
    request<ServiceType>(`/service-types/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/service-types/${id}`, { method: "DELETE" }),
  syncCounts: () => requestRaw("/service-types/sync-counts", { method: "POST" }),
};

/* ============================ categories ============================ */
export const categories = {
  list: () => requestRaw<Category[]>("/categories"),
  get: (id: Id) => request<Category>(`/categories/${id}`),
  create: (body: Partial<Category>) => request<Category>("/categories", { method: "POST", body }),
  update: (id: Id, body: Partial<Category>) => request<Category>(`/categories/${id}`, { method: "PUT", body }),
  toggle: (id: Id) => request<Category>(`/categories/${id}/toggle-status`, { method: "PATCH" }),
  remove: (id: Id) => requestRaw(`/categories/${id}`, { method: "DELETE" }),
  syncCounts: () => requestRaw("/categories/sync-counts", { method: "POST" }),
  reorder: (order: { id: Id; displayOrder: number }[]) =>
    requestRaw("/categories/reorder", { method: "PATCH", body: { order } }),
};

/* ============================ packages ============================ */
export const packages = {
  list: (q?: Query) => request<Package[]>("/packages", { query: q }),
  stats: () => request<Record<string, number>>("/packages/stats"),
  get: (id: Id) => request<Package>(`/packages/${id}`),
  create: (body: Partial<Package>) => request<Package>("/packages", { method: "POST", body }),
  update: (id: Id, body: Partial<Package>) => request<Package>(`/packages/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/packages/${id}`, { method: "DELETE" }),
  toggle: (id: Id) => request<Package>(`/packages/${id}/toggle-status`, { method: "PATCH" }),
};

export const packageAssignments = {
  list: (q?: Query) => requestRaw<PackageAssignment[]>("/package-assignments", { query: q }),
  stats: () => request<{
    statusCounts?: { _id: string; count: number }[];
    memberTypeCounts?: { _id: string; count: number }[];
    paymentStats?: { _id: boolean; count: number; totalAmount: number }[];
    totalRevenue?: { _id: null; total: number }[];
  }>("/package-assignments/stats"),
  get: (id: Id) => request<PackageAssignment>(`/package-assignments/${id}`),
  create: (body: Record<string, unknown>) =>
    request<PackageAssignment>("/package-assignments", { method: "POST", body }),
  update: (id: Id, body: Record<string, unknown>) =>
    request<PackageAssignment>(`/package-assignments/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/package-assignments/${id}`, { method: "DELETE" }),
  uploadProof: (id: Id, form: FormData) =>
    request<PackageAssignment>(`/package-assignments/${id}/payment-proof`, { method: "POST", body: form }),
  saveServiceCard: (body: Record<string, unknown>) =>
    requestRaw("/package-assignments/service-card", { method: "POST", body }),
  sendServiceOtp: (body: Record<string, unknown>) =>
    requestRaw("/package-assignments/send-otp", { method: "POST", body }),
  verifyServiceOtp: (body: Record<string, unknown>) =>
    requestRaw("/package-assignments/verify-otp", { method: "POST", body }),
  cancelSendOtp: (id: Id) => requestRaw(`/package-assignments/${id}/cancel/send-otp`, { method: "POST", body: {} }),
  cancelVerifyOtp: (id: Id, body: { otp: string; reason?: string }) =>
    requestRaw(`/package-assignments/${id}/cancel/verify-otp`, { method: "POST", body }),
  uploadPrescription: (id: Id, body: Record<string, unknown>) =>
    requestRaw(`/package-assignments/${id}/prescription`, { method: "POST", body }),
};

/* ============================ doctors ============================ */
export type DoctorStats = {
  period: { startDate: string; endDate: string };
  summary: { bookings: number; consultations: number; treatments: number; completed: number; noShow: number; cancelled: number; upcoming: number; revenue: number; consultationRevenue: number; treatmentRevenue: number; patients: number; avgRating: number | null; ratings: number; avgSessionMinutes: number | null };
  allTime: { bookings: number; completed: number; revenue: number; patients: number };
  byMonth: { month: string; bookings: number; consultations: number; treatments: number; revenue: number }[];
  topServices: { name: string; bookings: number; revenue: number }[];
  byCentre: { centre: string; bookings: number }[];
  recent: { _id: string; guest: string; userId?: string; service?: string | null; kind: "consultation" | "treatment"; date: string; time: string; status: string; amount: number; paymentStatus?: string; rating?: number | null; source?: string }[];
  feedback: { guest: string; rating: number; feedback: string; date: string }[];
};
export type DoctorAccount = { _id: Id; email: string; phone?: string | null; role: string; isActive: boolean; lastLogin?: string | null; hasPassword: boolean; passwordSetAt?: string | null; placeholderEmail: boolean };

export const doctors = {
  list: (q?: Query) => requestRaw<Doctor[]>("/doctors", { query: q }),
  get: (id: string) => request<Doctor>(`/doctors/${id}`),
  create: (body: Partial<Doctor>) => request<Doctor>("/doctors", { method: "POST", body }),
  update: (id: string, body: Partial<Doctor>) => request<Doctor>(`/doctors/${id}`, { method: "PUT", body }),
  /** Performance + recent visits for one dermatologist. */
  stats: (id: string, q?: Query) => request<DoctorStats>(`/doctors/${id}/stats`, { query: q }),
  /** Panel login behind the profile (admin only). */
  account: (id: string) => request<DoctorAccount | null>(`/doctors/${id}/account`),
  setPassword: (id: string, password: string) => request<unknown>(`/doctors/${id}/account/password`, { method: "PUT", body: { password } }),
  remove: (id: string) => requestRaw(`/doctors/${id}`, { method: "DELETE" }),
  toggle: (id: string) => request<Doctor>(`/doctors/${id}/toggle-status`, { method: "PATCH" }),
  /** The Doctor profile behind the signed-in staff login (role doctor). */
  me: () => requestRaw<Doctor | null>("/doctors/me") as Promise<Envelope<Doctor | null> & { linked?: boolean }>,
  tiers: () => request<{ id: string; title: string; description?: string; fee: number }[]>("/doctors/tiers/list"),
  updateTier: (tierId: string, body: { title?: string; description?: string; fee?: number; isActive?: boolean }) =>
    requestRaw(`/doctors/tiers/${tierId}`, { method: "PUT", body }),
};

/* ====================== dermatologist availability ====================== */
/**
 * When a dermatologist is bookable. The weekly pattern is the normal week; an
 * override names one date and always beats it — leave, or a one-off clinic.
 *
 * Slots are never stored, only derived. The server applies the fixed one-hour
 * session policy to every saved range.
 */
export const schedules = {
  get: (doctorId: string) =>
    request<{ dermatologist: Doctor; schedule: DermatologistSchedule; canEdit: boolean }>(
      `/dermatologists/${encodeURIComponent(doctorId)}/schedule`,
    ),
  save: (doctorId: string, body: Partial<DermatologistSchedule>) =>
    request<DermatologistSchedule>(
      `/dermatologists/${encodeURIComponent(doctorId)}/schedule`,
      { method: "PUT", body },
    ),
  /** The automatic week from the assigned centres' opening hours — for "Reset to centre hours". */
  defaultWeek: (doctorId: string) =>
    request<{ weekly: WeeklyBlock[]; centres: string[] }>(
      `/dermatologists/${encodeURIComponent(doctorId)}/schedule/default`,
    ),
  /** Day-level free counts, for painting the month. */
  days: (doctorId: string, from: string, to: string, branchId?: string | null) =>
    request<{ configured: boolean; slotMinutes?: number; days: ScheduleDay[] }>(
      `/dermatologists/${encodeURIComponent(doctorId)}/availability`,
      { query: { from, to, ...(branchId ? { branchId } : {}) } },
    ),
  /** Every slot on one date, each flagged booked, too soon, or free. */
  slots: (doctorId: string, date: string, branchId?: string | null) =>
    request<SlotDay>(`/dermatologists/${encodeURIComponent(doctorId)}/slots`, {
      query: { date, ...(branchId ? { branchId } : {}) },
    }),
};

export const feeRequests = {
  list: (q?: Query) => requestRaw<DoctorFeeRequest[]>("/doctor-fee-requests", { query: q }),
  /** The signed-in doctor's own fee, standard fee and any open request. */
  myFee: () => request<MyFee>("/doctor-fee-requests/my-fee"),
  create: (body: { requestedFee: number; reason: string; doctorId?: string }) =>
    request<DoctorFeeRequest>("/doctor-fee-requests", { method: "POST", body }),
  approve: (id: Id, body: { approvedFee?: number; reviewNote?: string }) =>
    request<DoctorFeeRequest>(`/doctor-fee-requests/${id}/approve`, { method: "PATCH", body }),
  reject: (id: Id, reviewNote: string) =>
    request<DoctorFeeRequest>(`/doctor-fee-requests/${id}/reject`, { method: "PATCH", body: { reviewNote } }),
  withdraw: (id: Id) =>
    request<DoctorFeeRequest>(`/doctor-fee-requests/${id}/withdraw`, { method: "PATCH" }),
  /** Put a doctor back on the standard tier fee. */
  clearOverride: (doctorId: string) =>
    requestRaw(`/doctor-fee-requests/override/${doctorId}`, { method: "DELETE" }),
};

export const availability = {
  list: () => request<DoctorAvailability[]>("/dermatologist-availability"),
  get: (doctorId: string) => request<DoctorAvailability>(`/dermatologist-availability/${doctorId}`),
  set: (doctorId: string, branchIds: Id[], isActive = true) =>
    request<DoctorAvailability>(`/dermatologist-availability/${doctorId}`, {
      method: "PUT", body: { branchIds, isActive },
    }),
};

/* ============================ products & commerce ============================ */
export const products = {
  list: (q?: Query) => requestRaw<Product[]>("/admin/products", { query: q }),
  get: (id: Id) => request<Product>(`/admin/products/${id}`),
  statistics: () => request<{
    total: number; active: number; inactive: number; popular: number;
    lowStock: number; outOfStock: number; totalStock: number; totalValue: number; avgPrice: number;
    byFormulation?: Record<string, { count: number; stock: number; value: number }>;
  }>("/admin/products/statistics"),
  create: (body: Partial<Product>) => request<Product>("/admin/products", { method: "POST", body }),
  update: (id: Id, body: Partial<Product>) => request<Product>(`/admin/products/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/products/${id}`, { method: "DELETE" }),
  toggle: (id: Id) => request<Product>(`/admin/products/${id}/toggle-status`, { method: "PATCH" }),
  setStock: (id: Id, stock: number) =>
    request<Product>(`/admin/products/${id}/stock`, { method: "PATCH", body: { stock } }),
  bulkUpdate: (productIds: Id[], updates: Partial<Product>) =>
    requestRaw("/admin/products/bulk-update", { method: "PATCH", body: { productIds, updates } }),
};

export const brands = {
  list: (q?: Query) => request<Brand[]>("/admin/brands", { query: q }),
  statistics: () => request<Record<string, number>>("/admin/brands/statistics"),
  create: (body: Partial<Brand>) => request<Brand>("/admin/brands", { method: "POST", body }),
  update: (id: Id, body: Partial<Brand>) => request<Brand>(`/admin/brands/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/brands/${id}`, { method: "DELETE" }),
};

export const formulations = {
  list: (q?: Query) => request<Formulation[]>("/admin/formulations", { query: q }),
  statistics: () => request<Record<string, number>>("/admin/formulations/statistics"),
  create: (body: Partial<Formulation>) => request<Formulation>("/admin/formulations", { method: "POST", body }),
  update: (id: Id, body: Partial<Formulation>) =>
    request<Formulation>(`/admin/formulations/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/formulations/${id}`, { method: "DELETE" }),
};

export const coupons = {
  list: (q?: Query) => request<Coupon[]>("/coupons", { query: q }),
  get: (id: Id) => request<Coupon>(`/coupons/${id}`),
  statistics: () => request<Record<string, number>>("/coupons/statistics"),
  create: (body: Partial<Coupon>) => request<Coupon>("/coupons", { method: "POST", body }),
  update: (id: Id, body: Partial<Coupon>) => request<Coupon>(`/coupons/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/coupons/${id}`, { method: "DELETE" }),
};

export const orders = {
  list: (q?: Query) => requestRaw<ProductOrder[]>("/admin/product-orders", { query: q }),
  get: (id: Id) => request<ProductOrder>(`/admin/product-orders/${id}`),
  stats: () => request<{
    totalOrders: number; newOrders: number; confirmedOrders: number; processingOrders: number;
    shippedOrders: number; deliveredOrders: number; cancelledOrders: number; failedDeliveryOrders: number;
    returnRequestedOrders: number; totalRevenue: number;
  }>("/admin/product-orders/stats"),
  setStatus: (id: Id, orderStatus: string, note?: string) =>
    request<ProductOrder>(`/admin/product-orders/${id}/status`, { method: "PUT", body: { status: orderStatus, note } }),
  approveReturn: (id: Id) => request<ProductOrder>(`/admin/product-orders/${id}/approve-return`, { method: "PUT" }),
  completeReturn: (id: Id, note?: string) =>
    request<ProductOrder>(`/admin/product-orders/${id}/complete-return`, { method: "PUT", body: { note } }),
  rejectReturn: (id: Id, reason: string) =>
    request<ProductOrder>(`/admin/product-orders/${id}/reject-return`, {
      method: "PUT", body: { reason },
    }),
  remove: (id: Id) => requestRaw(`/admin/product-orders/${id}`, { method: "DELETE" }),
  initiateRefund: (id: Id, body: Record<string, unknown>) =>
    requestRaw(`/admin/product-orders/${id}/initiate-refund`, { method: "POST", body }),
  completeRefund: (id: Id, body: Record<string, unknown>) =>
    requestRaw(`/admin/product-orders/${id}/complete-refund`, { method: "PUT", body }),
  bankDetails: (userId: Id) => request<Record<string, string>>(`/admin/product-orders/user/${userId}/bank-details`),
  markDeliveryFailed: (id: Id, reason: string, note?: string) =>
    request<ProductOrder>(`/admin/product-orders/${id}/delivery-failed`, {
      method: "PUT", body: { reason, note },
    }),
  assignDelivery: (id: Id, body: {
    deliveryPartner?: string; deliveryPartnerPhone?: string; courier?: string;
    trackingId?: string; expectedDeliveryTime?: string;
  }) => request<ProductOrder>(`/admin/product-orders/${id}/assign-delivery`, { method: "PUT", body }),
};

/* ============================ stock ============================ */
export const inventory = {
  list: (q?: Query) => requestRaw<Inventory[]>("/admin/inventory", { query: q }),
  get: (id: Id) => request<Inventory>(`/admin/inventory/${id}`),
  statistics: () => request<Record<string, unknown>>("/admin/inventory/statistics"),
  create: (body: Partial<Inventory>) => request<Inventory>("/admin/inventory", { method: "POST", body }),
  update: (id: Id, body: Partial<Inventory>) => request<Inventory>(`/admin/inventory/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/admin/inventory/${id}`, { method: "DELETE" }),
  bulkUpdateStock: (updates: { id: Id; qohAllBatches: number }[]) =>
    requestRaw("/admin/inventory/bulk-update-stock", { method: "POST", body: { updates } }),
  /** Atomic per-line consumption with a ledger row each — what a session uses. */
  consume: (body: { bookingId?: Id | null; branchId?: Id | null; lines: { inventoryId: Id; qty: number; wastedQty?: number; reason?: string; batchNo?: string }[] }) =>
    requestRaw<{ consumed: { inventoryId: Id; name: string; consumed: number; wasted: number; remaining: number }[]; failed: { inventoryId: Id; name: string; available: number; requested: number; message: string }[] }>("/admin/inventory/consume", { method: "POST", body }),
  movements: (q?: Query) => requestRaw<StockMovement[]>("/admin/inventory/movements", { query: q }),
};

export const vendors = {
  list: (q?: Query) => request<Vendor[]>("/vendors", { query: q }),
  get: (id: Id) => request<{ vendor: Vendor; productsCount?: number }>(`/vendors/${id}`),
  stats: () => request<Record<string, number>>("/vendors/stats"),
  create: (body: Partial<Vendor>) => request<Vendor>("/vendors", { method: "POST", body }),
  update: (id: Id, body: Partial<Vendor>) => request<Vendor>(`/vendors/${id}`, { method: "PUT", body }),
  remove: (id: Id) => requestRaw(`/vendors/${id}`, { method: "DELETE" }),
  /** Audited reveal — the list never carries bank details. */
  bankDetails: (id: Id) => request<Vendor["bankDetails"]>(`/vendors/${id}/bank-details`),
};

/* ============================ app studio ============================ */
export const appStudio = {
  get: () => request<AppCustomization>("/app-customization/admin"),
  update: (body: Partial<AppCustomization>) =>
    request<AppCustomization>("/app-customization/admin", { method: "PUT", body }),
  uploadImage: (imageType: string, file: File) => {
    const form = new FormData();
    form.append("image", file);
    return request<{ url: string } & AppCustomization>(`/app-customization/admin/upload/${imageType}`, {
      method: "POST", body: form,
    });
  },
  reset: () => request<AppCustomization>("/app-customization/admin/reset", { method: "POST" }),
  addConsultationCard: (form: FormData) =>
    request<AppCustomization>("/app-customization/admin/consultation-card", { method: "POST", body: form }),
  updateConsultationCard: (cardId: string, form: FormData) =>
    request<AppCustomization>(`/app-customization/admin/consultation-card/${cardId}`, { method: "PUT", body: form }),
  deleteConsultationCard: (cardId: string) =>
    request<AppCustomization>(`/app-customization/admin/consultation-card/${cardId}`, { method: "DELETE" }),
  addReelVideo: (form: FormData) =>
    request<AppCustomization>("/app-customization/admin/reel-videos", { method: "POST", body: form }),
  updateReelVideo: (reelId: string, body: { permalink?: string; title?: string; poster?: string }) =>
    request<unknown>(`/app-customization/admin/reel-videos/${reelId}`, { method: "PUT", body }),
  deleteReelVideo: (reelId: string) =>
    request<AppCustomization>(`/app-customization/admin/reel-videos/${reelId}`, { method: "DELETE" }),
};

export const media = {
  list: (q?: Query) => request<{ resources?: unknown[] } | unknown[]>("/upload/media/all", { query: q }),
  stats: () => request<Record<string, unknown>>("/upload/stats"),
  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("media", f));
    return request<{ url: string; publicId: string; thumbnail?: string }[]>("/upload/media", { method: "POST", body: form });
  },
  addUrl: (url: string) => request<{ url: string }>("/upload/media-url", { method: "POST", body: { url } }),
  remove: (publicId: string) => requestRaw(`/upload/media/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
};

/* ============================ engagement ============================ */
export const chat = {
  byBranch: (branchId: Id, q?: Query) => requestRaw<Chat[]>(`/chat/admin/branch/${branchId}`, { query: q }),
  stats: (branchId?: Id) =>
    request<{
      overall: { _id: string; count: number; totalUnread: number }[];
      byBranch: { branchId: Id; branchName: string; activeChats: number; totalUnread: number }[];
    }>("/chat/admin/stats", { query: { branchId } }),
  messages: (chatId: Id, q?: Query) => requestRaw<ChatMessage[]>(`/chat/${chatId}/messages`, { query: q }),
  send: (chatId: Id, content: string) =>
    request<ChatMessage>(`/chat/${chatId}/messages`, { method: "POST", body: { content } }),
  sendAttachment: (chatId: Id, file: File, caption = "") => {
    const form = new FormData();
    form.append("file", file);
    if (caption.trim()) form.append("caption", caption.trim());
    return request<ChatMessage>(`/chat/${chatId}/attachments`, { method: "POST", body: form });
  },
  markRead: (chatId: Id) => requestRaw(`/chat/${chatId}/read`, { method: "PUT" }),
  close: (chatId: Id) => request<Chat>(`/chat/admin/${chatId}/close`, { method: "PUT" }),
  assign: (chatId: Id, adminId: Id | null) =>
    request<Chat>(`/chat/admin/${chatId}/assign`, { method: "PUT", body: { adminId } }),
  deleteMessage: (messageId: Id) => requestRaw(`/chat/messages/${messageId}`, { method: "DELETE" }),
};

export type NotificationPage = {
  notifications: Notification[];
  unreadCount?: number;
  pagination?: { currentPage: number; totalPages: number; total: number };
};

export const notifications = {
  // These endpoints nest the rows under `data.notifications`, not `data`.
  list: (q?: Query) => request<NotificationPage>("/notifications/admin", { query: q }),
  recent: (limit = 6) =>
    request<NotificationPage>("/notifications/admin/recent", { query: { limit } }),
  unreadCount: () => request<{ count: number } | number>("/notifications/admin/unread-count"),
  stats: () => request<{
    byType?: { _id: string; count: number }[];
    byPriority?: { _id: string; count: number }[];
    overall?: { total?: number; unread?: number; read?: number } | Record<string, number>;
  }>("/notifications/admin/stats"),
  markRead: (id: Id) => requestRaw(`/notifications/admin/${id}/read`, { method: "PATCH" }),
  markAllRead: () => requestRaw("/notifications/admin/mark-all-read", { method: "PATCH" }),
  remove: (id: Id) => requestRaw(`/notifications/admin/${id}`, { method: "DELETE" }),
  clearRead: () => requestRaw("/notifications/admin/read/all", { method: "DELETE" }),
};

export const reviews = {
  products: (q?: Query) => requestRaw<ProductReview[]>("/admin/product-reviews", { query: q }),
  approveProduct: (id: Id, isApproved: boolean) =>
    requestRaw(`/admin/product-reviews/${id}/approval`, { method: "PUT", body: { isApproved } }),
  removeProduct: (id: Id) => requestRaw(`/admin/product-reviews/${id}`, { method: "DELETE" }),

  consultations: (q?: Query) => requestRaw<ConsultationReview[]>("/admin/consultation-reviews", { query: q }),
  approveConsultation: (id: Id, isApproved: boolean) =>
    requestRaw(`/admin/consultation-reviews/${id}/approval`, { method: "PUT", body: { isApproved } }),
  removeConsultation: (id: Id) => requestRaw(`/admin/consultation-reviews/${id}`, { method: "DELETE" }),

  packageServices: (q?: Query) => requestRaw<ServiceReview[]>("/admin/package-service-reviews", { query: q }),
  approveServiceReview: (id: Id, isApproved: boolean) =>
    requestRaw(`/admin/package-service-reviews/${id}/approval`, { method: "PUT", body: { isApproved } }),
  removeServiceReview: (id: Id) => requestRaw(`/admin/package-service-reviews/${id}`, { method: "DELETE" }),
};

export const support = {
  list: (q?: Query) => requestRaw<SupportMessage[]>("/support/admin/all", { query: q }),
  setStatus: (id: Id, status: string, note?: string) =>
    request<SupportMessage>(`/support/admin/${id}/status`, { method: "PATCH", body: { status, note } }),
};

/* ============================ clinical forms ============================ */
export const preConsult = {
  list: (q?: Query) => requestRaw<PreConsultForm[]>("/pre-consult-forms/admin/all", { query: q }),
  setStatus: (id: Id, status: string) =>
    request<PreConsultForm>(`/pre-consult-forms/admin/${id}/status`, { method: "PATCH", body: { status } }),
};

export const consentForms = {
  list: (q?: Query) => requestRaw<ConsentForm[]>("/patient-consent-forms/admin/all", { query: q }),
  setStatus: (id: Id, status: string, clinicNotes?: string) =>
    request<ConsentForm>(`/patient-consent-forms/admin/${id}/status`, {
      method: "PATCH", body: { status, clinicNotes },
    }),
  doctorSign: (id: Id, doctorSignature: string) =>
    request<ConsentForm>(`/patient-consent-forms/admin/${id}/doctor-sign`, {
      method: "PATCH", body: { doctorSignature },
    }),
};

export const serviceCards = {
  list: (q?: Query) => requestRaw<ServiceCard[]>("/service-cards/admin/all", { query: q }),
  create: (body: Record<string, unknown>) =>
    request<ServiceCard>("/service-cards/admin/create", { method: "POST", body }),
  update: (id: Id, body: Record<string, unknown>) =>
    request<ServiceCard>(`/service-cards/admin/${id}`, { method: "PUT", body }),
  deactivate: (id: Id) => requestRaw(`/service-cards/admin/${id}/deactivate`, { method: "PATCH" }),
  addService: (id: Id, body: Record<string, unknown>) =>
    request<ServiceCard>(`/service-cards/admin/${id}/services`, { method: "POST", body }),
  updateService: (cardId: Id, serviceId: Id, body: Record<string, unknown>) =>
    request<ServiceCard>(`/service-cards/admin/${cardId}/services/${serviceId}`, { method: "PUT", body }),
  deleteService: (cardId: Id, serviceId: Id) =>
    requestRaw(`/service-cards/admin/${cardId}/services/${serviceId}`, { method: "DELETE" }),
};

export const consultationNotes = {
  list: (q?: Query) => requestRaw<ConsultationNote[]>("/consultation-notes", { query: q }),
  forBooking: (bookingId: Id) => request<ConsultationNote | null>(`/consultation-notes/booking/${bookingId}`),
  save: (body: Partial<ConsultationNote> & { bookingId: Id }) =>
    request<ConsultationNote>("/consultation-notes", { method: "POST", body }),
  /** Email the signed prescription to the guest (first send or resend). */
  send: (id: Id) => requestRaw(`/consultation-notes/${id}/send`, { method: "POST", body: {} }),
  remove: (id: Id) => requestRaw(`/consultation-notes/${id}`, { method: "DELETE" }),
};

/* ============================ analytics ============================ */
export type FinancialAnalytics = {
  overview: {
    totalRevenue: number; consultationRevenue: number; productRevenue: number; packageRevenue: number;
    outstandingPayments: number; refundsLost: number; averageTransactionValue: number;
    totalTransactions: number; weekOverWeekGrowth: number;
  };
  // These three arrive as keyed maps ({ "Jubilee Hills": 2700 }), not arrays.
  paymentMethodDistribution: Record<string, number>;
  revenueByLocation: Record<string, number>;
  revenueByCategory: Record<string, number>;
  dailyRevenue: { date: string; revenue: number; consultations?: number; orders?: number; packages?: number }[];
  period: { startDate: string; endDate: string };
};

export type PatientAnalytics = {
  overview: {
    totalPatients: number; newPatients: number; returningPatients: number;
    newPatientRatio: number; returningPatientRatio: number; retentionRate: number;
  };
  birthdaysToday: { _id: string; fullName: string; email?: string; phone?: string }[];
  inactivePatients: { count: number; threshold: string };
  membershipStatus: { active: number; expired: number; pending: number };
};

export type AppointmentAnalytics = {
  overview: {
    totalBookings: number; completedBookings: number; cancelledBookings: number;
    noShowBookings: number; pendingBookings: number; conversionRate: number;
    cancellationRate: number; noShowRate: number;
  };
  averages: { perDay: number; perWeek: number; perMonth: number };
  peakHours: { hour: string; count: number }[];
  peakDays: { day: string; count: number }[];
  cancellationTrend: { date?: string; month?: string; count: number }[];
  noShowByService: { service: string; count: number }[];
  avgTimeBetweenBookings: number;
  upcomingThisWeek: number;
  pendingConfirmations: number;
};

export type ServiceAnalytics = {
  topServicesByRevenue?: { id: Id; name: string; category: string; revenue: number; bookings: number }[];
  topServicesByVolume?: { id: Id; name: string; category: string; revenue: number; bookings: number }[];
  serviceProfitMargin?: { id: Id; name: string; revenue: number; cost: number; profit: number; margin: number }[];
  leastPerformingServices?: { id: Id; name: string; category: string; price: number; bookings: number }[];
  categoryPerformance?: { category: string; revenue: number; bookings: number; avgPrice?: number }[];
  packageUtilization?: { name: string; used: number; total: number; utilizationRate?: number }[];
  summary: {
    totalRevenue: number; totalBookings: number; totalServices: number;
    activeServices: number; avgRevenuePerService: number;
  };
};

export type InventoryAnalytics = {
  summary: {
    totalItems: number; totalValue: number; lowStockCount: number;
    outOfStockCount?: number; reorderNeededCount: number; totalCost?: number; expiringIn30Days?: number; expired?: number;
  };
  lowStockAlerts: Inventory[];
  outOfStockItems: { id: Id; name?: string; inventoryName?: string }[];
  [key: string]: unknown;
};

export type DashboardStream = { key: string; label: string; revenue: number; count: number; app: number; clinic: number; unpriced?: number };
export type DashboardDerm = {
  doctorId: string; name: string; photo?: string | null; tier?: string | null; level: string;
  source: "app" | "zenoti" | "app+zenoti"; onboarded: boolean; zenotiEmployeeId?: string | null;
  bookings: number; consultations: number; treatments: number; completed: number; noShow: number; cancelled: number;
  revenue: number; patients: number; avgRating: number | null; completionRate: number;
};
export type Dashboard = {
  period: { startDate: string; endDate: string; days: number; branch: string };
  revenue: { total: number; previous: number; previousHasData?: boolean; growthPercent: number | null; streams: DashboardStream[] };
  counts: {
    bookings: number; completed: number; cancelled: number; noShow: number; consultations: number; treatments: number; upcoming: number;
    awaitingConfirmation: number; noShowRate: number; cancellationRate: number; orders: number; paidOrders: number; ordersByStatus: Record<string, number>;
    openOrders: number; packagesAssigned: number; packagesPaid: number; packagesUnpaid: number; membershipsSold: number; activeZen: number; zenExpiring: number;
    newPatients: number; totalPatients: number; bookingsBySource: Record<string, number>; outstanding: number; averageTicket: number; membershipsUnpriced?: number;
  };
  dermatologists: DashboardDerm[];
  topServices: { name: string; category?: string | null; kind: string; bookings: number; revenue: number }[];
  revenueByCentre: { centre: string; revenue: number; bookings: number }[];
  paymentMix: { method: string; amount: number }[];
  daily: { date: string; consultations: number; treatments: number; products: number; packages: number; memberships: number; total: number; bookings: number }[];
};

export const analytics = {
  /** One-call clinic dashboard: revenue per stream, counts, dermatologist board. */
  dashboard: (q?: Query) => request<Dashboard>("/admin/analytics/dashboard", { query: q }),
  financial: (q?: Query) => request<FinancialAnalytics>("/admin/analytics/financial", { query: q }),
  monthlyRevenue: (q?: Query) => request<{ month: string; revenue: number }[]>("/admin/analytics/revenue/monthly", { query: q }),
  dailyTarget: () =>
    request<{ dailyTarget: number; todayCollection: number; progressPercentage: number; difference: number; achieved: boolean }>(
      "/admin/analytics/target/daily",
    ),
  patients: (q?: Query) => request<PatientAnalytics>("/admin/analytics/patients", { query: q }),
  patientAcquisition: () => request<{ month: string; count: number }[]>("/admin/analytics/patients/acquisition"),
  topPatients: (limit = 5, q?: Query) =>
    request<{ _id: Id; fullName: string; totalSpent: number; visits?: number }[]>("/admin/analytics/patients/top", {
      query: { limit, ...(q ?? {}) },
    }),
  demographics: () =>
    request<{ ageGroups: { group: string; count: number }[]; gender: Record<string, number> }>(
      "/admin/analytics/patients/demographics",
    ),
  sources: () => request<{ source: string; count: number; percentage: number }[]>("/admin/analytics/patients/sources"),
  sendBirthdayWish: (userId: Id) =>
    requestRaw(`/admin/analytics/patients/${userId}/birthday-wish`, { method: "POST" }),
  appointments: (q?: Query) => request<AppointmentAnalytics>("/admin/analytics/appointments", { query: q }),
  services: (q?: Query) => request<ServiceAnalytics>("/admin/analytics/services", { query: q }),
  inventory: (q?: Query) => request<InventoryAnalytics>("/admin/analytics/inventory", { query: q }),
};

/* ============================ governance ============================ */
export const audit = {
  list: (q?: Query) =>
    requestRaw<AuditEntry[]>("/admin/audit-logs", { query: q }),
  actions: () => request<{ actions: string[]; resources: string[]; admins: string[] }>("/admin/audit-logs/actions"),
  suspicious: (q?: Query) => requestRaw<AuditEntry[]>("/admin/audit-logs/suspicious", { query: q }),
  record: (body: { action: string; resource?: string; resourceId?: string; details?: Record<string, unknown> }) =>
    requestRaw("/admin/audit-logs", { method: "POST", body }),
};

export const staff = {
  list: (q?: Query) => requestRaw<Admin[]>("/admin/staff", { query: q }),
  roles: () => request<{ id: string; label: string; description?: string }[]>("/admin/staff/roles"),
  create: (body: { email: string; name?: string; role: string; doctorId?: Id | null }) =>
    request<Admin>("/admin/staff", { method: "POST", body }),
  update: (id: Id, body: Partial<Admin>) => request<Admin>(`/admin/staff/${id}`, { method: "PUT", body }),
  toggle: (id: Id) => request<Admin>(`/admin/staff/${id}/toggle-status`, { method: "PATCH" }),
  remove: (id: Id) => requestRaw(`/admin/staff/${id}`, { method: "DELETE" }),
};

/* ============================ zenoti (CRM) ============================ */
export type ZenotiServiceBalance = {
  name: string | null; total: number | null; used: number | null; balance: number | null; expiryDate?: string | null;
};
export type ZenotiOverview = {
  guestId: string;
  profile: {
    fullName: string; email: string | null; phone: string | null;
    gender: string; dateOfBirth: string | null;
    centerName: string | null; branchName: string; code: string | null;
    preferredName?: string | null; memberSince?: string | null; anniversaryDate?: string | null;
    isMinor?: boolean; isVirtualGuest?: boolean; isOnlineBookingBlocked?: boolean;
    isClassBookingBlocked?: boolean; isBlockedForNoShow?: boolean;
    preferences?: Record<string, unknown> | null; tags?: unknown; referral?: unknown;
    primaryEmployee?: unknown; guestPasses?: unknown; milestoneDetails?: unknown; additionalDetails?: unknown;
    emergencyContact?: { firstName?: string | null; lastName?: string | null; phone?: string | null };
    address?: { line1: string | null; city: string | null; state: string | null; zip: string | null };
  } | null;
  appointments: { serviceName: string | null; startTime: string | null; durationMinutes: number | null; therapistName: string | null; centerName: string | null; price: number | null; membershipApplied: boolean }[];
  orders: { name: string | null; quantity: number | null; saleDate: string | null; price: number | null; paymentType: string | null; soldBy: string | null; centerName: string | null; invoiceNumber: string | null }[];
  memberships: { name: string | null; code: string | null; status: number | string | null; memberSince: string | null; expiryDate: string | null; creditBalance: number | null; centerName: string | null; services: ZenotiServiceBalance[]; products?: ZenotiServiceBalance[]; isRefunded?: boolean; recurrenceStatus?: number | string | null; redeemable?: boolean | null; isAddonMember?: boolean; guestPassType?: string | null; guestPassTotal?: number | null; guestPassBalance?: number | null; htmlBenefits?: string | null }[];
  packages: { name: string | null; status: number | null; purchaseDate: string | null; startDate: string | null; endDate: string | null; neverExpires: boolean; price: number | null; centerName: string | null; services: ZenotiServiceBalance[]; products?: ZenotiServiceBalance[]; sessionsTotal: number | null; sessionsRemaining: number | null; redeemable?: boolean | null; totalPayment?: number | null; isFrozen?: boolean; restrictRedemptionToCenter?: boolean }[];
  notes: { id?: string | null; text: string | null; type?: string | number | null; isPrivate?: boolean; isProfileAlert?: boolean; createdAt?: string | null; createdBy?: string | null; centerName?: string | null }[];
  forms: { id?: string | null; name: string | null; status: number | string | null; isExpired?: boolean; lastFilledAt?: string | null; lastFilledBy?: string | null; formType?: number | string | null; viewOnly?: boolean; formUrl?: string | null; history?: unknown[] }[];
};

export type ZenotiAppointment = ZenotiOverview["appointments"][number] & {
  id?: string | null; endTime?: string | null; notes?: string | null;
  status?: number | string | null; packageName?: string | null; roomName?: string | null;
  equipmentName?: string | null; invoiceNumber?: string | null; hasServiceForm?: boolean;
};
export type ZenotiOrder = ZenotiOverview["orders"][number] & { id?: string | null };
export type ZenotiMembership = ZenotiOverview["memberships"][number] & { id?: string | null };
export type ZenotiPackage = ZenotiOverview["packages"][number] & { id?: string | null };
export type ZenotiNote = ZenotiOverview["notes"][number];
export type ZenotiForm = ZenotiOverview["forms"][number];

export type ZenotiStats = {
  treatmentsDone: number; upcoming: number; productsBought: number; notes?: number; forms?: number; activePackages: number;
  sessionsLeft: number; activeMemberships: number; lifetimeSpend: number;
  lastVisit?: string | null; nextVisit?: string | null;
};
/** The locally mirrored Zenoti history of one customer (ZenotiGuestData). */
export type ZenotiGuestDetails = {
  userId: Id; zenotiGuestId: string; centerId?: string | null; branchName?: string | null;
  profile?: ZenotiOverview["profile"];
  appointments: ZenotiAppointment[]; orders: ZenotiOrder[]; memberships: ZenotiMembership[]; packages: ZenotiPackage[];
  notes: ZenotiNote[]; forms: ZenotiForm[];
  sectionStatus?: Record<string, { syncedAt?: string | null; attemptedAt?: string | null; count?: number; error?: string | null }>;
  stats: ZenotiStats; syncedAt?: string | null; lastError?: string | null;
};
export type ZenotiUserData = { user: User; linked: boolean; details: ZenotiGuestDetails | null };
export type ZenotiSyncRun = {
  _id: Id; type: "roster" | "details" | "appointments"; mode?: "incremental" | "full"; status: "running" | "completed" | "failed"; trigger: string;
  startedAt: string; finishedAt?: string | null; total: number; processed: number; created: number;
  updated: number; skipped: number; failed: number; error?: string | null;
};
export type ZenotiSyncStatus = {
  configured: boolean; writeMode: string; linkedUsers: number; mirrored: number; freshWithin24h: number; withErrors: number;
  rosterRunning: boolean; detailsRunning: boolean; fullImportRunning: boolean; appointmentSyncRunning?: boolean;
  sectionCoverage: Record<string, number>; supportedDatasets: string[];
  providerLimitations: { key: string; label: string; reason: string }[];
  lastRoster: ZenotiSyncRun | null; lastDetails: ZenotiSyncRun | null; lastAppointments?: ZenotiSyncRun | null;
  running: ZenotiSyncRun[]; history: ZenotiSyncRun[];
};
/** One unwound row of a customer's mirrored history, with the owning customer attached. */
export type ZenotiListRow<T> = {
  userId: Id; branchName?: string | null; syncedAt?: string | null;
  user: Pick<User, "_id" | "patientId" | "fullName" | "email" | "phone" | "location" | "memberType" | "source">;
  item: T;
};
type ZenotiListEnvelope<T> = { success: boolean; data: ZenotiListRow<T>[]; total: number; page: number; limit: number };
export type ReportingPractitioner = {
  filterValue: string; name: string; source: "app" | "zenoti" | "app+zenoti"; onboarded: boolean;
  doctorId?: string | null; zenotiEmployeeId?: string | null; centers: string[]; historical?: boolean;
  bookings?: number; revenue?: number; lastVisit?: string | null;
};

export const zenoti = {
  /** Legacy by-phone/email lookup of a live Zenoti record. */
  overview: (q: { phone?: string; email?: string; guestId?: string }) =>
    request<ZenotiOverview>("/admin/zenoti/overview", { query: q }),
  status: () => request<ZenotiSyncStatus>("/admin/zenoti/status"),
  /** Mirror every Zenoti guest into Patients (runs in the background). */
  import: () => request<unknown>("/admin/zenoti/import", { method: "POST" }),
  /** Refresh history for the N least-recently synced customers. */
  crawl: (limit?: number) => request<unknown>("/admin/zenoti/crawl", { method: "POST", body: { limit } }),
  syncAppointments: () => request<unknown>("/admin/zenoti/appointments/sync", { method: "POST" }),
  /** App doctors + Zenoti-only doctors for reporting filters; never an app roster endpoint. */
  practitioners: () => request<ReportingPractitioner[]>("/admin/zenoti/practitioners"),
  syncPractitioners: () => request<unknown>("/admin/zenoti/practitioners/sync", { method: "POST" }),
  user: (userId: Id, refresh?: boolean) =>
    request<ZenotiUserData>(`/admin/zenoti/users/${userId}`, { query: refresh ? { refresh: "1" } : undefined }),
  syncUser: (userId: Id) => request<ZenotiUserData>(`/admin/zenoti/users/${userId}/sync`, { method: "POST" }),
  packages: (q?: Query) => requestRaw<ZenotiListRow<ZenotiPackage>[]>("/admin/zenoti/packages", { query: q }) as Promise<ZenotiListEnvelope<ZenotiPackage> & { summary?: { activePackages: number; sessionsLeft: number; customers: number } }>,
  appointments: (q?: Query) => requestRaw<ZenotiListRow<ZenotiAppointment>[]>("/admin/zenoti/appointments", { query: q }) as Promise<ZenotiListEnvelope<ZenotiAppointment>>,
  memberships: (q?: Query) => requestRaw<ZenotiListRow<ZenotiMembership>[]>("/admin/zenoti/memberships", { query: q }) as Promise<ZenotiListEnvelope<ZenotiMembership>>,
  orders: (q?: Query) => requestRaw<ZenotiListRow<ZenotiOrder>[]>("/admin/zenoti/orders", { query: q }) as Promise<ZenotiListEnvelope<ZenotiOrder>>,
  notes: (q?: Query) => requestRaw<ZenotiListRow<ZenotiNote>[]>("/admin/zenoti/notes", { query: q }) as Promise<ZenotiListEnvelope<ZenotiNote>>,
  forms: (q?: Query) => requestRaw<ZenotiListRow<ZenotiForm>[]>("/admin/zenoti/forms", { query: q }) as Promise<ZenotiListEnvelope<ZenotiForm>>,
};

/* ============================ contact-change (email/phone) ============================ */
export type ContactChangeRow = {
  id: string;
  customer: { id: string; fullName: string; patientId?: string } | null;
  type: "email" | "phone";
  status: "awaiting_verification" | "verified" | "scheduled" | "applied" | "cancelled" | "failed";
  from: string | null;
  to: string | null;
  scheduledApplyAt: string | null;
  appliedAt: string | null;
  failureReason: string | null;
  createdAt: string;
};
/* ============================ banners ============================ */
export const banners = {
  list: (q?: Query) => requestRaw<Banner[]>("/banners", { query: q }),
  get: (id: Id) => request<Banner>(`/banners/${id}`),
  create: (form: FormData) => request<Banner>("/banners", { method: "POST", body: form }),
  update: (id: Id, form: FormData) => request<Banner>(`/banners/${id}`, { method: "PUT", body: form }),
  remove: (id: Id) => requestRaw(`/banners/${id}`, { method: "DELETE" }),
  toggle: (id: Id) => request<Banner>(`/banners/${id}/toggle`, { method: "PATCH" }),
  reorder: (order: { id: Id; order: number }[]) => requestRaw("/banners/reorder", { method: "POST", body: { banners: order } }),
};

export const contactChange = {
  /** Read-only list of customer email/phone change requests (they auto-apply). */
  list: (q?: { status?: string; type?: string }) =>
    request<ContactChangeRow[]>("/admin/contact-change-requests", { query: q }),
};

export const api = {
  auth, branches, patients, bookings, services, serviceTypes, categories, packages, packageAssignments, consultationNotes,
  doctors, availability, schedules, feeRequests, products, brands, formulations, coupons, orders, inventory, vendors,
  appStudio, media, chat, notifications, reviews, support, preConsult, consentForms,
  serviceCards, analytics, audit, staff, zenoti, contactChange, banners,
};

export default api;
