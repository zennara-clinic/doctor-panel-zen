/** Shapes returned by the Zennara backend, mirrored from Backend/models. */

export type Id = string;

/* ---------------- auth ---------------- */
/** Three roles, three panels. Finer-grained admin permissions come later. */
export type AdminRole = "super_admin" | "doctor" | "therapist";
export type Admin = {
  _id: Id;
  email: string;
  name: string;
  role: AdminRole;
  phone?: string | null;
  /** True once a password is set (from /admin/auth/me). */
  hasPassword?: boolean;
  isActive: boolean;
  lastLogin?: string;
  /** Explicit link to a Doctor profile for role `doctor` logins. */
  doctorId?: Id | null;
  /** False when the address is missing from the server's ADMIN_EMAILS allow-list. */
  canSignIn?: boolean;
  /** Walkthroughs this account has already completed (server-held, not per-browser). */
  toursSeen?: string[];
  createdAt?: string;
};

/** A deleted customer account, kept in full so staff can restore it. */
export type DeletedAccount = {
  _id: Id;
  originalUserId: Id;
  email?: string;
  phone?: string;
  fullName?: string;
  patientId?: string;
  deletedAt: string;
  deletedBy: "user" | "admin";
  reason?: string;
  counts?: Record<string, number>;
  restoredAt?: string | null;
};

/** A home-screen banner managed from the panel (Banner model). */
export type Banner = {
  _id: Id;
  title: string;
  mediaType: "image" | "video";
  image?: string | null;
  videoFile?: string | null;
  videoUrl?: string | null;
  linkType?: "none" | "internal" | "external";
  internalScreen?: string | null;
  externalUrl?: string | null;
  order?: number;
  isActive: boolean;
  createdAt?: string;
};

/** One row of the stock ledger. */
export type StockMovement = {
  _id: Id;
  inventoryId: Id;
  inventoryName?: string;
  batchNo?: string;
  type: "consume" | "wastage" | "receive" | "adjust" | "sale" | "return";
  delta: number;
  before: number;
  after: number;
  reason?: string;
  bookingId?: Id | null;
  adminEmail?: string;
  createdAt: string;
};

/* ---------------- org ---------------- */
export type Branch = {
  _id: Id;
  name: string;
  address?: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string } | string;
  /** `phone` is a list — a centre usually has more than one line. */
  contact?: { phone?: string[]; email?: string };
  location?: { type?: string; coordinates?: number[] };
  operatingHours?: Record<string, { open?: string; close?: string; openTime?: string; closeTime?: string; isOpen?: boolean }>;
  /** Holidays / "closed today" — YYYY-MM-DD, optional `to` for a range. */
  closures?: { _id?: Id; date: string; to?: string | null; reason?: string; createdBy?: string | null }[];
  slotDuration?: number;
  isActive: boolean;
  displayOrder?: number;
  description?: string;
  amenities?: string[];
  images?: string[];
  createdAt?: string;
  updatedAt?: string;
};

/* ---------------- people ---------------- */
export type User = {
  _id: Id;
  patientId?: string;
  fullName: string;
  email: string;
  phone: string;
  location?: string;
  memberType?: "Zen Member" | "Regular Member";
  /** 'app' = registered in the app; 'zenoti' = mirrored from the clinic CRM. Both are app users. */
  source?: "app" | "zenoti" | "reception";
  zenotiGuestId?: string | null;
  zenotiSyncedAt?: string | null;
  zenMembershipStartDate?: string | null;
  zenMembershipExpiryDate?: string | null;
  zenMembershipAutoRenew?: boolean;
  zenMembershipSource?: "app" | "admin" | "zenoti" | null;
  zenMembershipPlan?: string | null;
  zenMembershipMonths?: number | null;
  zenMembershipAmount?: number | null;
  zenMembershipPaymentMethod?: string | null;
  zenMembershipPaymentStatus?: "paid" | "pending" | null;
  zenMembershipGrantedBy?: string | null;
  zenotiMembershipInvoiceId?: string | null;
  zenotiMembershipSyncStatus?: "pending" | "synced" | "dryrun" | "skipped" | "failed" | null;
  zenotiMembershipSyncError?: string | null;
  dateOfBirth?: string;
  gender?: string;
  medicalHistory?: string;
  /** Ticked by the guest on the app's Allergies screen. */
  hasDrugAllergy?: boolean;
  drugAllergies?: string;
  dietaryPreferences?: string[];
  smoking?: string;
  drinking?: string;
  additionalInfo?: string;
  profilePicture?: string | { url?: string };
  isVerified?: boolean;
  isActive?: boolean;
  totalVisits?: number;
  appOpenCount?: number;
  totalSpent?: number;
  upcomingAppointments?: number;
  createdAt?: string;
  lastLogin?: string | null;
};

/* ---------------- bookings ---------------- */
export type BookingStatus =
  | "Awaiting Confirmation"
  | "Confirmed"
  | "Rescheduled"
  | "In Progress"
  | "Cancelled"
  | "No Show"
  | "Completed";

export type VisitCodeLog = { kind: "checkin" | "checkout"; channels: string[]; failed?: string[]; at: string; byName?: string | null };
export type ManualCheck = { reason: string; byName?: string | null; at: string };

export type ConsultationStage =
  | "booked" | "confirmed" | "checked_in" | "waiting" | "consultation_started"
  | "consultation_completed" | "prescription_created" | "treatment_recommended"
  | "follow_up_required" | "no_follow_up";

export type Booking = {
  /** Therapist reception assigned to run this session (Admin login id + name). */
  assignedTherapistId?: Id | null;
  assignedTherapistName?: string | null;
  _id: Id;
  isPackageIncluded?: boolean;
  checkInCodeAt?: string | null;
  checkOutCodeAt?: string | null;
  checkInCodeSentAt?: string | null;
  checkOutCodeSentAt?: string | null;
  visitCodeLog?: VisitCodeLog[];
  manualCheckIn?: ManualCheck | null;
  manualCheckOut?: ManualCheck | null;
  referenceNumber?: string;
  userId: Id | User;
  consultationId?: Id | Consultation | null;
  externalServiceName?: string | null;
  externalServiceCategory?: string | null;
  fullName: string;
  mobileNumber: string;
  email: string;
  branchId?: Id | Branch | null;
  preferredLocation: string;
  preferredDate: string;
  preferredTimeSlots: string[];
  specialistId?: string;
  specialistName?: string;
  specialistTier?: string;
  status: BookingStatus;
  confirmedDate?: string;
  /** The appointment's own instant (confirmed → preferred, with time of day). Sort history on this. */
  eventAt?: string | null;
  /**
   * Clinical lifecycle, separate from `status` (see the API's Booking model):
   * waiting → consultation_started → consultation_completed → prescription_created
   * → treatment_recommended → follow_up_required | no_follow_up.
   */
  consultationStage?: ConsultationStage | null;
  consultationStageHistory?: { stage: ConsultationStage; at: string; byName?: string }[];
  followUp?: { required?: boolean; dueDate?: string | null; notes?: string; bookingId?: Id | null };

  confirmedTime?: string;
  checkInTime?: string;
  checkOutTime?: string;
  sessionDuration?: number;
  cancellationReason?: string;
  cancelledAt?: string;
  rescheduledAt?: string;
  rating?: number;
  feedback?: string;
  paymentStatus?: "pending" | "paid" | "failed" | "refunded";
  paymentMethod?: string;
  amount: number;
  paidAt?: string;
  source?: "app" | "reception" | "package" | "zenoti";
  zenotiAppointmentId?: string | null;
  zenotiAppointmentGroupId?: string | null;
  zenotiSyncStatus?: "pending" | "synced" | "failed" | "skipped" | "dryrun" | null;
  zenotiSyncError?: string | null;
  therapistId?: Id | null;
  therapistName?: string;
  zenotiTherapistName?: string;
  room?: string;
  /** What happened in the chair — written at checkout by the therapist. */
  session?: BookingSession;
  notes?: string;
  adminNotes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BookingSession = {
  items?: { inventoryId?: Id; name: string; batchNo?: string; qty: number; unit?: string; rate?: number; billable?: boolean }[];
  wastage?: { inventoryId?: Id; name: string; qty: number; reason?: string }[];
  serviceFee?: number;
  productTotal?: number;
  discount?: number;
  total?: number;
  grading?: string;
  notes?: string;
  therapist?: string;
  completedAt?: string;
};

/* ---------------- catalogue ---------------- */
export type Consultation = {
  _id: Id;
  id: string;
  slug: string;
  /** Level 3 — the sub-category. This document IS the bookable treatment. */
  name: string;
  /** Level 1 — ServiceType.name. */
  type?: string | null;
  /** Level 2 — the treatment category. */
  category: string;
  summary: string;
  about: string;
  key_benefits?: string[];
  ideal_for?: string[];
  price: number;
  cta_label?: string;
  tags?: string[];
  /** Stored as `{ q, a }` — the app reads those keys. */
  faqs?: { q: string; a: string }[];
  pre_care?: string[];
  post_care?: string[];
  image: string;
  media?: { type: string; url: string }[];
  rating?: number | null;
  reviews?: number;
  isActive: boolean;
  showPriceInApp?: boolean;
  chargeOnlineBooking?: boolean;
  isPopular?: boolean;
  createdAt?: string;
};

/** Level 1 of the service taxonomy — Skin, Hair, Skin & Hair, Wellness, … */
export type ServiceType = {
  _id: Id;
  name: string;
  slug: string;
  description?: string;
  displayOrder?: number;
  isActive: boolean;
  categoryCount?: number;
  treatmentCount?: number;
  /** Present when fetched with `withCategories`. */
  categories?: Category[];
};

/** Level 2 — the treatment category, filed under a type. */
export type Category = {
  _id: Id;
  name: string;
  slug: string;
  /** ServiceType.name this category sits under. */
  type?: string | null;
  displayOrder?: number;
  description?: string;
  isActive: boolean;
  consultationCount?: number;
  createdAt?: string;
};

/** The whole tree in one payload — what the app's treatment page browses. */
export type TaxonomyTree = {
  types: (ServiceType & {
    categories: (Category & { subCategories: Consultation[] })[];
  })[];
  totals: { types: number; categories: number; subCategories: number };
};

export type PackageService = {
  /** Consultation `id` (or `_id`) — the server resolves either. */
  serviceId?: string;
  serviceName?: string;
  servicePrice?: number;
  customPrice?: number;
  sessions?: number;
  /** Panel-side alias kept for older drafts. */
  name?: string;
  [key: string]: unknown;
};

export type Package = {
  _id: Id;
  id: string;
  name: string;
  description: string;
  benefits?: string[];
  services?: PackageService[];
  consultationServices?: PackageService[];
  price: number;
  originalPrice?: number;
  discount?: number;
  image?: string;
  media?: { type: string; url: string }[];
  isActive: boolean;
  isPopular?: boolean;
  bookingsCount?: number;
  createdAt?: string;
};

export type PackageAssignment = {
  _id: Id;
  assignmentId: string;
  userId: Id | User;
  packageId: Id | Package;
  packageDetails?: { packageName?: string; packagePrice?: number; originalPrice?: number; services?: PackageService[] };
  userDetails?: { fullName?: string; email?: string; phone?: string; patientId?: string; memberType?: string };
  pricing?: { originalAmount?: number; discountPercentage?: number; discountAmount?: number; finalAmount?: number };
  payment?: { isReceived?: boolean; receivedDate?: string; proofUrl?: string; paymentMethod?: string };
  status: "Active" | "Expired" | "Cancelled" | "Completed";
  validFrom?: string;
  validUntil?: string | null;
  // Where the package's sessions run — clinic the auto-created appointments land at.
  preferredLocation?: string;
  branchId?: Id | null;
  // One entry per dated session. 24h before each `scheduledDate` the backend
  // auto-creates the appointment and links it here.
  sessions?: PackageSession[];
  usageTracking?: { totalSessions?: number; usedSessions?: number; remainingSessions?: number };
  notes?: string;
  assignedByName?: string;
  zenotiPackageId?: string | null;
  zenotiInvoiceId?: string | null;
  zenotiSyncStatus?: "pending" | "synced" | "dryrun" | "skipped" | "failed" | "review" | null;
  zenotiSyncError?: string | null;
  completedServices?: { serviceId: string; completedAt: string; prescriptions?: string[] }[];
  createdAt?: string;
};

export type PackageSession = {
  _id?: Id;
  serviceId?: string;
  serviceName?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  /** Dermatologist the clinic picked for this session. */
  specialistId?: string | null;
  specialistName?: string | null;
  specialistTier?: string | null;
  status?: "Scheduled" | "Booked" | "Completed" | "Cancelled";
  bookingId?: Id | null;
  bookingCreatedAt?: string | null;
  completedAt?: string | null;
};

/* ---------------- doctors ---------------- */
export type DoctorTier = "senior-consultant" | "consultant-dermatologist";

export type Doctor = {
  _id: Id;
  /** Stable slug shared with the mobile app and DermatologistAvailability. */
  doctorId: string;
  name: string;
  photo?: string | null;
  tier: DoctorTier;
  /** Two levels only, mirroring the two fee tiers. */
  level?: "senior" | "dermatologist";
  designation?: string | null;
  /** Home branch name; `availableCentres` drives where they can be booked. */
  branch?: string | null;
  availableCentres?: string[];
  qualifications?: string[];
  experienceYears?: number;
  experienceNote?: string | null;
  expertise?: string[];
  achievements?: string[];
  /** Per-doctor consultation fee; falls back to the tier fee when 0/absent. */
  fee?: number;
  email?: string | null;
  phone?: string | null;
  displayOrder?: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type FeeRequestStatus = "Pending" | "Approved" | "Rejected" | "Withdrawn";

export type DoctorFeeRequest = {
  _id: Id;
  doctorId: string;
  doctorName: string;
  requestedByEmail?: string | null;
  /** What they were effectively charging when they asked. */
  currentFee: number;
  currentFeeWasTierFee?: boolean;
  requestedFee: number;
  reason: string;
  status: FeeRequestStatus;
  /** Set on approval — may differ from requestedFee if the admin adjusted it. */
  approvedFee?: number | null;
  reviewedByEmail?: string | null;
  reviewNote?: string | null;
  decidedAt?: string | null;
  createdAt: string;
};

/** The signed-in doctor's own pricing position. */
export type MyFee = {
  linked: boolean;
  doctorId?: string;
  doctorName?: string;
  tier?: DoctorTier;
  standardFee?: number | null;
  effectiveFee?: number | null;
  hasOverride?: boolean;
  pendingRequest?: DoctorFeeRequest | null;
};

export type SupportMessage = {
  _id: Id;
  userId?: Id | User | null;
  name: string;
  email: string;
  phone: string;
  location?: string;
  subject: string;
  message: string;
  status: "pending" | "in-progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  adminNotes?: { note: string; addedAt: string }[];
  resolvedAt?: string;
  createdAt: string;
};

/* ---------------- commerce ---------------- */
export type Product = {
  _id: Id;
  name: string;
  description: string;
  formulation: string;
  OrgName: string;
  code?: string;
  price: number;
  gstPercentage: number;
  image?: string;
  stock: number;
  rating?: number;
  reviews?: number;
  isActive: boolean;
  isPopular?: boolean;
  createdAt?: string;
};

/**
 * A product as a dermatologist may see it — availability, never money.
 * Served by GET /api/inventory/availability, which does not select the price
 * columns at all, so no price is present to leak.
 */
export type ProductAvailability = {
  _id: Id;
  source: "product" | "inventory";
  name: string;
  sku: string | null;
  category: string | null;
  productType: string | null;
  formulation: string | null;
  brand: string | null;
  image?: string;
  /** Across the business. */
  totalQuantity: number;
  /** At the selected branch; null when no branch was requested. */
  branchQuantity: number | null;
  quantity: number;
  status: "in_stock" | "low_stock" | "out_of_stock";
  syncedFromZenoti: boolean;
  zenotiSyncedAt?: string | null;
};

/** A clinical photograph in a patient's timeline (before / during / after). */
export type PatientPhoto = {
  _id: Id;
  userId: Id;
  bookingId?: (Booking & { referenceNumber?: string }) | Id | null;
  consultationNoteId?: Id | null;
  branchId?: Id | null;
  phase: "before" | "during" | "after";
  bodyArea?: string;
  note?: string;
  url: string;
  takenAt: string;
  takenByName?: string;
  takenByRole?: string;
  createdAt?: string;
};

export type Brand = {
  _id: Id;
  name: string;
  description?: string;
  logo?: string;
  website?: string;
  isActive: boolean;
  productsCount?: number;
};

export type Formulation = {
  _id: Id;
  name: string;
  description?: string;
  isActive: boolean;
  productsCount?: number;
};

export type Coupon = {
  _id: Id;
  code: string;
  description?: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minOrderValue?: number;
  maxDiscount?: number | null;
  usageLimit?: number | null;
  usageCount?: number;
  perUserLimit?: number | null;
  validFrom: string;
  validUntil: string;
  applicableProducts?: Id[];
  applicableCategories?: string[];
  isActive: boolean;
  isPublic?: boolean;
};

export type OrderStatus =
  | "Order Placed"
  | "Confirmed"
  | "Processing"
  | "Packed"
  | "Shipped"
  | "Out for Delivery"
  | "Delivery Failed"
  | "Delivered"
  | "Cancelled"
  | "Return Requested"
  | "Returned";

export type ProductOrder = {
  _id: Id;
  orderNumber: string;
  userId: Id | User;
  items: { productId?: Id | Product; productName?: string; productImage?: string; quantity: number; price: number; subtotal?: number }[];
  shippingAddress?: {
    addressId?: Id; fullName?: string; phone?: string; addressLine1?: string; addressLine2?: string;
    city?: string; state?: string; postalCode?: string; country?: string; landmark?: string;
  };
  pricing?: { subtotal?: number; gst?: number; deliveryFee?: number; discount?: number; total?: number };
  refundDetails?: {
    method?: string; amount?: number; status?: string; razorpayRefundId?: string; transactionProof?: string;
    refundInitiatedAt?: string; refundCompletedAt?: string; failureReason?: string; notes?: string;
    bankDetails?: { accountHolderName?: string; accountNumber?: string; ifscCode?: string; bankName?: string; upiId?: string };
  };
  coupon?: { code?: string; discount?: number };
  paymentMethod?: "COD" | "Razorpay" | "Online";
  paymentStatus?: "Pending" | "Paid" | "Failed" | "Refunded";
  orderStatus: OrderStatus;
  statusHistory?: { status: string; timestamp: string; note?: string }[];
  deliveryDate?: string;
  trackingId?: string;
  courier?: string;
  estimatedDelivery?: string;
  deliveryPartner?: string;
  deliveryPartnerPhone?: string;
  expectedDeliveryTime?: string;
  deliveryAttempt?: number;
  deliveryAssignedAt?: string;
  deliveryFailedAt?: string;
  deliveryFailureReason?: string;
  deliveryFailures?: {
    attempt?: number; failedAt?: string; reason?: string; note?: string;
    deliveryPartner?: string; deliveryPartnerPhone?: string; courier?: string; trackingId?: string;
  }[];
  cancelReason?: string;
  returnReason?: string;
  returnRequestedAt?: string;
  returnApproved?: boolean;
  returnRejected?: boolean;
  returnRejectionReason?: string;
  cancelledAt?: string;
  deliveredAt?: string;
  returnedAt?: string;
  stockRestoredAt?: string;
  notes?: string;
  createdAt?: string;
};

/* ---------------- stock ---------------- */
export type Inventory = {
  _id: Id;
  inventoryName: string;
  inventoryCategory: "Retail products" | "Consumables";
  code?: string;
  formulation?: string;
  orgName?: string;
  batchMaintenance?: "Batchable" | "Non Batchable";
  batchType?: "FIFO" | "ByExpiry";
  batchNo?: string;
  batchExpiryDate?: string;
  qohBatchWise?: number;
  qohAllBatches?: number;
  reOrderLevel?: number;
  targetLevel?: number;
  gstPercentage?: number;
  inventoryBuyingPrice?: number;
  inventorySellingPrice?: number;
  inventoryAfterTaxSellingPrice?: number;
  vendorName?: string;
  packName?: string;
  packSize?: number;
  createdAt?: string;
};

export type Vendor = {
  _id: Id;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  panNumber?: string;
  status: "Active" | "Inactive";
  rating?: number;
  notes?: string;
  /** Items in stock naming this vendor. */
  productsSupplied?: number;
  productsCount?: number;
  hasBankDetails?: boolean;
  bankDetails?: { accountHolderName?: string; accountNumber?: string; ifscCode?: string; bankName?: string };
  createdAt?: string;
};

/* ---------------- engagement ---------------- */
export type Chat = {
  _id: Id;
  userId: Id | User;
  branchId: Id | Branch;
  branchName: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
  status: "active" | "closed" | "archived";
  assignedAdmin?: Id | Admin | null;
  createdAt?: string;
};

export type ChatMessage = {
  _id: Id;
  chatId: Id;
  senderId: Id;
  senderModel: "User" | "Admin";
  senderName: string;
  messageType?: "text" | "image" | "file" | "system";
  content: string;
  attachment?: {
    url: string;
    key?: string;
    fileName: string;
    mimeType: string;
    size: number;
    kind: "image" | "file";
  };
  isRead?: boolean;
  isDelivered?: boolean;
  createdAt: string;
};

export type Notification = {
  _id: Id;
  userId?: Id | null;
  type: "booking" | "order" | "consultation" | "product" | "inventory" | "promotion" | "reminder";
  title: string;
  message: string;
  relatedId?: Id;
  relatedModel?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  isRead?: boolean;
  actionUrl?: string;
  createdAt: string;
};

export type ProductReview = {
  _id: Id;
  userId?: Id | User;
  productId?: Id | Product;
  orderId?: Id;
  rating: number;
  reviewText: string;
  images?: string[];
  isApproved: boolean;
  isReported?: boolean;
  helpfulCount?: number;
  createdAt: string;
};

export type ConsultationReview = {
  _id: Id;
  userId?: Id | User;
  consultationId?: Id | Consultation;
  bookingId?: Id | Booking;
  rating: number;
  reviewText: string;
  isApproved: boolean;
  createdAt: string;
};

export type ServiceReview = {
  _id: Id;
  userId?: Id | User;
  packageAssignmentId: string;
  serviceId: string;
  serviceName: string;
  rating: number;
  reviewText: string;
  isApproved: boolean;
  createdAt: string;
};

export type AuditEntry = {
  _id: Id;
  adminId?: Id;
  adminEmail: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string;
  status: "SUCCESS" | "FAILED" | "WARNING";
  errorMessage?: string | null;
  userAgent?: string;
  timestamp: string;
  createdAt?: string;
};

/* ---------------- clinical ---------------- */
export type DoctorAvailability = {
  _id: Id;
  doctorId: string;
  branches: (Id | Branch)[];
  isActive: boolean;
  updatedAt?: string;
};

export type PreConsultForm = {
  /** Presenting complaint, added 2026-09. Free text in the patient's own words. */
  symptomDuration?: string | null;
  previousTreatments?: string | null;
  currentMedications?: string | null;
  patientNotes?: string | null;
  pregnancyStatus?: "not_applicable" | "not_pregnant" | "pregnant" | "breastfeeding" | "planning" | "prefer_not_to_say";
  photos?: { url: string; caption?: string; uploadedAt?: string }[];
  _id: Id;
  userId: Id | User;
  bookingId?: Id | Booking;
  name?: string;
  dateOfBirth?: string;
  gender?: string;
  phoneNumber?: string;
  email?: string;
  reasonForVisit?: Record<string, boolean>;
  skinConcerns?: Record<string, boolean>;
  hairConcerns?: Record<string, boolean | string>;
  medicalHistory?: Record<string, unknown>;
  drugAllergies?: string | null;
  otherAllergies?: string | null;
  dailyRoutine?: Record<string, string | null>;
  diet?: { type?: string; [k: string]: unknown };
  planningForPregnancy?: boolean;
  lastMenstrualPeriod?: string | null;
  additionalInfo?: Record<string, unknown>;
  doctorName?: string | null;
  status: "Draft" | "Submitted" | "Approved" | "Reviewed" | "Rejected";
  dateOfVisit?: string;
  createdAt?: string;
};

export type ConsentForm = {
  _id: Id;
  userId: Id | User;
  bookingId?: Id | Booking;
  patientName: string;
  doctorName: string;
  treatmentProcedure: string;
  consentDate?: string;
  consentGiven: boolean;
  patientSignature?: string;
  doctorSignature?: string | null;
  status: "Pending" | "Signed" | "Approved" | "Archived";
  clinicNotes?: string | null;
  createdAt?: string;
};

export type PrescriptionItem = {
  medicine: string;
  /** "500 mg", "0.1%" — strength, kept apart from the dose. */
  strength?: string | null;
  /** Tablet, cream, serum — as the clinic dispenses it. */
  formulation?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  /** Morning / night / after food. */
  timing?: string | null;
  instructions?: string | null;
  /** Set when the line is a Zennara retail product rather than a drug. */
  productId?: Id | null;
  /** Availability when it was prescribed. Never a price. */
  availableQuantity?: number | null;
  isScheduleH?: boolean;
};

export type ConsultationNote = {
  /* Diagnosis and advice — the 2026-09 prescription builder. */
  primaryDiagnosis?: string;
  secondaryDiagnosis?: string;
  skinCareAdvice?: string;
  lifestyleAdvice?: string;
  precautions?: string;
  /** True only once a dermatologist has signed; sending requires it. */
  prescriptionSigned?: boolean;
  prescriptionSignedAt?: string | null;
  prescriptionSignedByName?: string | null;
  /** Set once the signed prescription was emailed to the guest. */
  prescriptionEmailedAt?: string | null;
  prescriptionEmailedTo?: string | null;
  _id: Id;
  bookingId: Id | Booking;
  userId: Id | User;
  doctorId?: string | null;
  doctorName?: string | null;
  complaint?: string;
  examination?: string;
  assessment?: string;
  plan?: string;
  sketch?: string | null;
  prescription?: PrescriptionItem[];
  assignedServices?: { serviceId?: Id | null; packageId?: Id | null; name: string; sessions?: number }[];
  followUpDate?: string | null;
  status: "Draft" | "Completed";
  completedAt?: string | null;
  zenotiNoteId?: string | null;
  zenotiSyncStatus?: "pending" | "synced" | "failed" | "skipped" | "dryrun" | null;
  zenotiSyncError?: string | null;
  revisions?: { savedAt: string; savedByEmail?: string | null }[];
  createdAt?: string;
  updatedAt?: string;
};

export type ServiceRecord = {
  _id?: Id;
  serialNumber: number;
  date: string;
  service: string;
  grading?: string | null;
  doctorSign?: string | null;
  doctorName?: string | null;
  therapist?: string | null;
  notes?: string | null;
};

export type ServiceCard = {
  _id: Id;
  userId: Id | User;
  clientName: string;
  clientId: string;
  primaryDoctor: string;
  manager?: string | null;
  services: ServiceRecord[];
  totalSessions?: number;
  completedSessions?: number;
  isActive: boolean;
  lastServiceDate?: string | null;
  createdAt?: string;
};

/* ---------------- app studio ---------------- */
export type AppCustomization = {
  _id?: Id;
  /** Remote design system + copy overrides (App control). */
  appearance?: {
    colors?: Record<string, string>;
    typography?: { fontScale?: number; sizeOverrides?: Record<string, number> };
  } | null;
  copy?: Record<string, string> | null;
  membership?: { discountPercent?: number; priceInr?: number; durationMonths?: number; benefits?: { title: string; copy?: string }[] } | null;
  helpScreen?: { faqs?: { q: string; a: string }[] } | null;
  appLogo?: string;
  homeScreen?: Record<string, unknown>;
  consultationsScreen?: Record<string, unknown>;
  appointmentsScreen?: Record<string, unknown>;
  productsScreen?: Record<string, unknown>;
  profileScreen?: Record<string, unknown>;
  termsOfService?: string;
  privacyPolicy?: string;
  version?: number;
  isActive?: boolean;
  lastUpdatedAt?: string;
  lastUpdatedBy?: Id;
  createdAt?: string;
  updatedAt?: string;
};

/* =================== dermatologist availability =================== */

/** One block of clinic time, "HH:mm" on the clinic's own wall clock. */
export type TimeRange = { start: string; end: string };

/** The normal week. A day with no entry is a day they do not sit. */
export type WeeklyBlock = {
  day: number; // 0 = Sunday, matching Date.getDay()
  branchId?: string | null;
  ranges: TimeRange[];
};

/**
 * One named date, which always beats the weekly pattern.
 * `unavailable` clears the day; ranges replace it.
 */
export type ScheduleOverride = {
  date: string; // YYYY-MM-DD
  unavailable?: boolean;
  branchId?: string | null;
  ranges?: TimeRange[];
  note?: string;
};

export type DermatologistSchedule = {
  _id?: string;
  doctorId: string;
  slotMinutes: number;
  leadTimeHours: number;
  horizonDays: number;
  weekly: WeeklyBlock[];
  overrides: ScheduleOverride[];
  isActive: boolean;
  /** False when nobody has set this dermatologist up yet. */
  configured?: boolean;
  /** True while the week is still the automatic copy of the centres' opening hours. */
  seededFromBranchHours?: boolean;
};

export type ScheduleDay = {
  date: string;
  open: boolean;
  total: number;
  free: number;
  note?: string;
};

export type Slot = {
  time: string;
  label: string;
  minutes: number;
  booked: boolean;
  tooSoon: boolean;
  available: boolean;
};

export type SlotDay = {
  date: string;
  configured: boolean;
  slotMinutes?: number;
  note?: string;
  reason?: string;
  slots: Slot[];
};
