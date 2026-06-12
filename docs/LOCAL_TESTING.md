# Local Testing

This project ships with a **DEV MODE** so you can run and see the add-in working
locally without standing up Azure Entra ID, iTrent, or Cosmos DB.

In dev mode:

- the backend boots without real Azure/iTrent credentials,
- it serves **mock leave data** (5 sample employees with different statuses),
- SSO is **bypassed** — the add-in sends a dev token the API accepts,
- a **mock Office runtime** is installed so the taskpane renders in a normal
  browser tab (no Outlook sideloading needed).

> ⚠️ Dev mode is opt-in via `DEV_MODE=true` and is gated everywhere. A production
> build (`NODE_ENV=production`) never mocks Office, never bypasses auth, and never
> serves mock data.

---

## Quick start (≈2 minutes)

```bash
# 1. Install dependencies
npm install
npm --prefix server install

# 2. Create your .env (the template already has DEV_MODE=true)
cp .env.example .env

# 3. Start the backend API (terminal 1)  → http://localhost:3001
npm run dev:server

# 4. Start the add-in dev server (terminal 2) → https://localhost:3000
npm start
```

Then open:

```
https://localhost:3000/taskpane/taskpane.html
```

Accept the self-signed certificate warning (or run `npx office-addin-dev-certs install`
once to trust localhost). You should see the panel load with:

| Employee     | Status          |
| ------------ | --------------- |
| Alice Smith  | On Leave        |
| Dave Brown   | On Leave (+ delegate Frank Green) |
| Bob Jones    | Returning Soon  |
| Carol White  | Upcoming Leave  |
| Erin Davis   | Available       |

…and a banner reading **“3 recipients are currently on leave.”**

---

## Verifying the backend directly

```bash
# Health check
curl http://localhost:3001/api/health

# Leave status for the mock recipients (dev token accepted in DEV_MODE)
curl -H "Authorization: Bearer dev-token" \
  "http://localhost:3001/api/leave/status?emails=alice.smith@contoso.com,bob.jones@contoso.com,carol.white@contoso.com"

# Sync status
curl -H "Authorization: Bearer dev-token" http://localhost:3001/api/sync/status
```

---

## Changing the mock data

- Backend records: `server/src/data/mockData.ts`
- Browser recipients (must match the emails above): `src/taskpane/devMockOffice.ts`

Keep the email addresses in those two files in sync so the taskpane shows results.

---

## Testing for real (in Outlook, with SSO)

When you're ready to test the genuine SSO + Outlook integration:

1. Create the Entra ID app registration (see the deployment notes in the repo root).
2. Fill the real `AZURE_*` and `ITRENT_*` values in `.env`, and set `DEV_MODE=false`.
3. Build a production bundle so the Office mock and auth bypass are compiled out:
   ```bash
   AZURE_CLIENT_ID=... AZURE_TENANT_ID=... ADDIN_URL=https://localhost:3000 \
   NODE_ENV=production npm run build
   ```
4. Replace the `{{...}}` placeholders in `manifest.xml`, then sideload it in
   Outlook on the web: **Get Add-ins → My add-ins → Add a custom add-in → Add from file**.
