# Shalom PG

A simple app for running paying-guest (PG) houses. The owner does everything:

- add houses and the people staying in them (photo, ID proof, phone, email, room, rent, deposit, due date)
- see whose rent is overdue, due today, or due soon
- send rent reminders on WhatsApp or email in one tap, or remind a whole group at once
- record payments (UPI, cash or bank) with the month and amount

Each owner signs in to their own account and only ever sees their own houses.

**Stack:** React + Vite (website, hosted free on GitHub Pages) · Supabase (database, logins, private document storage).

---

## 1. Put it on GitHub (one time)

1. Go to https://github.com/new
   - Repository name: `shalom-pg`
   - Visibility: **Public** (free GitHub Pages needs a public repo; your data is *not* in the repo, it lives in Supabase behind logins)
   - Don't add a README, .gitignore or licence (this folder already has them)
   - Click **Create repository**
2. In a terminal inside this `pg-manager` folder, run (replace `YOUR-USERNAME`):

   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/shalom-pg.git
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab. The "Deploy to GitHub Pages" run takes about a minute. When it's green,
   the site is live at `https://YOUR-USERNAME.github.io/shalom-pg/`.

From then on, every `git push` to `main` updates the live site automatically.

## 2. Add your parents' logins (one time per person)

Accounts are created by you, not by a sign-up form:

1. Supabase dashboard → project **PG Manager** → **Authentication → Users → Add user → Create new user**
2. Enter their email and a starting password, and tick **Auto Confirm User**
3. They sign in on the website, then go to **Settings → Change password** to pick their own

Every account added this way automatically becomes an owner with their own private space.
Recommended: in **Authentication → Sign In / Providers**, turn **off "Allow new users to sign up"** so
nobody else can create an account.

## 3. Install it on a phone

Open the site in Chrome (Android) or Safari (iPhone) → menu/share → **Add to Home Screen**. It opens
full-screen like an app.

---

## Adding many residents at once (Excel)

Open a house → **Import from Excel** → **Download template**, fill one row per person, upload it.
Every row is checked before anything is saved (10-digit mobile, email, rent, deposit, due day 1–28),
problems are shown row by row, and good rows are added in one go (with Undo). People already added
are detected by mobile number, so re-importing a fixed sheet won't create duplicates.
Photos and ID proofs are added per person afterwards.

## Two (or more) owners

Each owner signs in with their own account. The database enforces separation (row-level security):
an owner can only see and change their own houses, residents, payments and documents. This was
tested with two accounts: neither could read, edit, delete, move or upload into the other's data.

## Security summary

- **Data:** Postgres row-level security on every table; signed-out visitors have no access at all.
- **Documents:** private storage, one folder per owner, photos and PDFs only (max 5 MB, PDF signature
  checked), opened through links that expire after 1 hour. Photos are re-encoded in the browser, which
  strips hidden metadata such as GPS location. Replaced documents are deleted, and **Delete permanently**
  (for moved-out residents) erases their record, payments, photo and ID.
- **Website:** strict Content-Security-Policy (only this site and Supabase), no-referrer, refuses to
  load inside other sites' frames, no source maps, dependencies audited (0 known vulnerabilities).
- **Input limits:** validated in the app and again by database constraints.
- **Recommended dashboard settings** (Supabase → Authentication): turn off *Allow new users to sign up*;
  turn on *Leaked password protection* if your plan offers it; use strong passwords for owners.
- Backups downloaded from Settings contain personal data: store them safely.

## Developing locally

```bash
npm install
npm run dev
```

- `.env.production` holds the Supabase URL + publishable key used for the live site (safe to commit).
- Create `.env.local` with the same two values to use the cloud while developing; without it the app
  runs in offline demo mode (data saved in the browser only, with a "demo data" button).
- `supabase/schema.sql` is the full database setup (tables, row-level security, storage).
- **Never** commit the Supabase `service_role` / secret key.
