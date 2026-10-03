# Billing ERP — website version (Firebase)

Each shop signs up on your website, gets its own private books, and invites its own staff.
You (the seller) control each shop's free trial and paid plan from the Firebase console.

```
public/index.html          sign in · create account · set up shop · join as staff · demo link
public/app.html            the billing app (built from billing-dashboard.html)
public/firebase-config.js  ← you paste your Firebase settings + your contact details here
firestore.rules            security: each shop sees only its own data
firebase.json, .firebaserc hosting settings
build.py, src/             used to rebuild app.html when the app changes
```

---

## One-time setup (about 30 minutes)

### 1. Create the Firebase project
1. Open **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project**. Name it, for example `billing-erp`. You can turn Google Analytics off.
3. Note the **Project ID** shown under the name, for example `billing-erp-4f2a1`.

### 2. Turn on sign-in
1. Go to **Build › Authentication › Get started**.
2. On the **Sign-in method** tab, enable **Email/Password**.
3. Also enable **Google**: pick your support email, then Save.

### 3. Create the database
1. Go to **Build › Firestore Database › Create database**.
2. For location, choose **asia-south1 (Mumbai)**. You can't change this later.
3. Start in **production mode**. The rules in this folder replace the defaults when you deploy.

### 4. Get the web settings
1. Go to **Project settings** (gear icon) › **Your apps** › click the **</>** (Web) icon.
2. Name it `web`. Don't tick Hosting here.
3. Copy the values shown in `firebaseConfig` into **`public/firebase-config.js`**:
   apiKey, authDomain, projectId, storageBucket, messagingSenderId and appId.
4. In the same file, set `APP_NAME`.
5. Also set `SELLER` to your phone and email. Shops see these when their trial ends.
6. Open **`.firebaserc`** and replace `PASTE_PROJECT_ID` with your Project ID.

### 5. Install the deploy tool on your Mac (once)
1. Install Node.js (LTS) from **https://nodejs.org**.
2. Open **Terminal** and run:
   ```
   npm install -g firebase-tools
   firebase login
   ```
   A browser window opens; sign in with the same Google account.

### 6. Deploy
In Terminal, go into this folder (type `cd `, drag the folder onto the Terminal window, press Enter), then run:
```
firebase deploy
```
When it finishes it prints your website address, for example **https://billing-erp-4f2a1.web.app**.
That's the link your shops use.

### 7. First check (10 minutes)
1. Open the address and click **Create account**. Sign up with your email, then set up a test shop.
2. Make one party, one item and one invoice.
3. Open the address in a second browser, or a private window. Sign up with another email and check the new shop is **empty**.
4. In the first shop, go to **Settings › General › Team** and invite the second email. Sign in as that email: it should offer "Join".
5. In the Firebase console, open **Firestore Database**. You'll see `shops`, `users` and `invites`.

---

## Running the business

### Trials and payments
Each new shop gets a 14-day trial. When it ends, the shop can still view, print and download its books, but can't add entries until you renew it.

**To activate a shop after it pays:**
1. In the Firebase console, go to **Firestore Database › shops**.
2. Click the shop. Its `name` and `ownerEmail` tell you who it is.
3. Change `plan` to `paid`.
4. Add a field `paidUntil` of type **timestamp** with the end date, for example 1 year from today.

The shop's banner disappears within seconds.

**To extend a trial instead:** change `trialEnds` to a later date.

Shops can't change `plan`, `paidUntil` or `trialEnds` themselves. The security rules block it.

### Staff
- The owner invites staff by email in **Settings › General › Team**.
- Staff sign in with that same email, then click **Join**.
- The owner can remove a staff member at any time. They are signed out straight away.

### Demo
**https://YOUR-ADDRESS/app.html?demo=1** opens a sample shop without signing in.
Nothing is saved to the cloud. Use it for showing the product to customers.

### Backups
- **Inside the app:** each shop's owner device saves a daily copy (the last 5 are kept). Owners can also download backup files from **Settings › General › Backup & restore**.
- **For everything (all shops):** in the Google Cloud console, open **Firestore › Disaster recovery** and schedule daily backups. This needs the paid Blaze plan.

---

## Updating the website later
1. When the app changes (`billing-dashboard.html`), run `python3 build.py` in this folder. It rebuilds `public/app.html`.
2. Run `firebase deploy`. Shops get the new version the next time they open or refresh the page.

---

## Costs and limits — read before you have many shops
- Firebase starts **free** (Spark plan). Each day you get 50,000 database reads, 20,000 writes and 1 GB of storage.
- That is plenty for a handful of active shops. Beyond that, switch to **Blaze** (pay as you go). Then set a **budget alert** in Google Cloud Billing, for example ₹500/month, so there are no surprises.
- The app saves each list, such as invoices or parties, as a whole. A very busy shop with thousands of invoices writes more data on every save.
- Before you have dozens of large shops, plan the next step: storing each invoice as its own record, and archiving old financial years. Ask for this when you get there.

## Not included yet
- **Online payment of subscriptions** (Razorpay or Paytm). For now you activate shops by hand, as above. Automatic payment needs a small server function, which needs the Blaze plan.
- **Super-admin dashboard.** Use the Firebase console for now.
- **Staff roles with limited access, e-invoice and e-way bill, and GSTR filing.**
- **Custom domain** such as billing.yourcompany.in. Add it in Firebase Hosting › Add custom domain once you own the domain.
