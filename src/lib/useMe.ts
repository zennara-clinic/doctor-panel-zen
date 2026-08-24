import { useApi } from "./useApi";
import api from "./api";
import { useStore } from "../store";
import type { Doctor } from "./types";

/**
 * The Doctor profile belonging to the signed-in account.
 *
 * A panel login is an Admin row; the public-facing profile (photo, expertise,
 * fee, centres) is a Doctor row. They are linked by email, with a name match
 * as a fallback for profiles created before the email was filled in.
 */
export function useMyDoctor() {
  const { admin } = useStore();

  // The server resolves the link (explicit Admin.doctorId → email → name),
  // so every panel surface and every backend check agree on who "me" is.
  return useApi(async () => {
    if (!admin) return null;
    const res = await api.doctors.me();
    return (res.data ?? null) as Doctor | null;
  }, [admin?._id, admin?.email]);
}
