# Zennara — Dermatologist Panel

Standalone Dermatologist Panel for the Zennara clinic. Vite + React, talks to the Zennara
backend for everything (`VITE_API_BASE_URL` in `.env`).

- Sign-in: email OTP or password via `/api/admin/auth/*`.
- Only accounts with role **`doctor`** can use this panel; other roles are told
  which panel to use instead and no session is stored.
- Home route: `/doctor/my-day` · dev server port: 5174.

```
npm install
npm run dev
```
