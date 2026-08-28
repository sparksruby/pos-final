# Retail POS (offline)

An offline-first retail point-of-sale app built with Expo, Expo Router, and
`expo-sqlite`. `expo-sqlite` is the sole datastore on the device, so the app
works fully offline by design — there's no backend requirement. An optional
sync backend — pick C# (`backend/`) or PHP/Laravel (`backend-laravel/`),
same contract either way — is available for shops that want multiple
devices/branches to actually share data instead of each being its own
island; see either one's README and the "Server sync" bullet below.

## Features

- Product catalog with categories, SKU/barcode, price, cost price, photo, unit (pcs/kg/box/...,
  display label only — no conversion math), and stock quantity
- Optional wholesale price per product — a Retail/Wholesale toggle in the POS cart panel (shown
  once at least one product has a wholesale price set) reprices the whole cart at once; products
  without a wholesale price just keep selling at the retail price in either mode
- Product search (name/SKU/barcode) and Clear Cart on the POS screen
- Cart → checkout flow (discount, tax, cash/card/QR/split payment, change due)
- Discounts: order-level (fixed amount or %) and per-product (flat amount off
  one cart line), combined and reflected on the receipt
- Split payment — pay one sale with a mix of Cash/Card/QR, itemized on the receipt
- Stock automatically decrements on sale, checkout blocks on insufficient stock
- Local username/password login (SHA-256 hashed, seeded `admin` / `admin123`)
- Multi-user accounts (Admin/Cashier roles) — admins manage users, products,
  shop settings, and sales history/reports; cashiers only ring sales
- Product & shop management screens
- Inventory: add/remove/set stock with a reason, low-stock and out-of-stock
  indicators (per-product threshold), and a stock movement history — every
  sale, restock, and manual correction is logged
- Sales history with Daily/Weekly/Monthly/Yearly reports + Excel export
- Reports screen: revenue/discounts/estimated profit by period, plus
  breakdowns by payment method, cashier, category, and product
- Returns & refunds — refund whole or partial quantities from any past sale;
  stock is put back, the customer's loyalty points are adjusted proportionally,
  and the refunded amount shows up in sales history and reports
- Customers with phone/email and an optional loyalty program (configurable
  points-per-currency earn rate and point redemption value); pick or quick-add
  a customer at checkout, redeem points toward a sale, earn points on it
- Optional Bluetooth ESC/POS receipt printing, plus saving any receipt as a
  PDF (share sheet — Files, email, Drive, ...); both work from Checkout right
  after a sale and from Sales History for any past sale (reprint/re-save anytime)
- Barcode label printing (Products > tag icon on any product) — name, price,
  Code128 barcode, and a vertical label text, to a Bluetooth label printer
  speaking ESC/POS, TSPL, CPCL, or ZPL (Settings > Printer); see "Barcode
  label printing" below for protocol details, requirements, and limits
- Full backup & restore (Settings > Backup & Restore) — export every table
  plus product photos to one .zip file via the share sheet, or restore one
  back (replacing everything currently on the device); see "Backup &
  restore" below
- License activation gate — the whole app (including the local database)
  is locked behind a license key screen until it's activated once against
  `pos.superall.app`; once activated it keeps working offline, same as
  everything else in this app. See "License activation" below
- Cashier shifts — open the register with a starting cash float, sales and
  refunds while it's open are tracked live, close it by counting the drawer
  to see over/short vs. the expected cash; shift history in Settings
- Multiple branches — shared product catalog, but stock, sales, and reports
  are tracked per branch (Settings > Branches to manage them); a branch
  switcher appears once there's more than one, and stock can be transferred
  between branches from Inventory. Note: this is still one database on one
  device — there's no backend, so "branches" are a logical split inside that
  single install, not separate synced locations
- Reports: Daily/Weekly/Monthly/Yearly, filterable to one branch or all,
  with a By Branch breakdown alongside by-product/category/cashier/payment-method
- Suppliers — name/phone/address, a products-supplied list and purchase
  history derived from purchase records, and an outstanding balance owed
- Purchases — record a purchase from a supplier (line items with quantity
  and unit cost); stock increases immediately at the current branch, each
  product's cost price updates as a weighted average, and every line is
  logged to the inventory activity feed. Purchases can be paid in full,
  partially, or left unpaid, with payments recorded against the balance
- Expenses — log shop expenses (rent, utilities, salary, transport,
  supplies, maintenance, other) per branch with an amount and optional
  note; searchable list with a running total. Syncs like sales/stock
  movements when connected — see "Server sync" below
- Low stock notifications — an Alerts screen (Settings > Alerts) lists every
  low-stock and out-of-stock product against its minimum threshold, and a
  banner appears on the POS screen whenever something needs attention
- Expiry date tracking — set an optional expiry date per product; the Alerts
  screen flags expired items and anything expiring within 30 days, and
  checkout blocks selling a product past its expiry date (both when tapped
  on the POS grid and when scanned)
- Server sync (optional, Settings > Server Sync) — connects this device to
  the companion backend (`backend/` in C#, or `backend-laravel/` in PHP —
  either works identically from the app's side). One device = one branch,
  fixed at connect time by the server (not user-switchable from the app
  once connected — the branch switcher locks to it). Categories/products
  created **offline, on any connected device** push themselves to the
  server the next time that device syncs, same as sales/stock movements
  always have — catalog management isn't limited to one special device. A
  device's own Sales History/Reports/Inventory only ever reflect its own
  branch — they never get mixed with another branch's history
- Admin Key (optional, set in Settings > Server Sync) — turns this device
  into the "main branch": it can create a new **branch** directly on the
  server (Settings > Branches) and **register new devices** for it
  (Settings > Server Sync > Register Device), it's the only device allowed
  to transfer stock between branches once synced, and it's the only device
  with an **All Branches Activity** screen — a read-only mirror of every
  branch's sales/stock movements/products/expenses, kept in its own tables
  so it never pollutes this device's own reports. A device that's never
  connected, or connected without an admin key, behaves exactly as before
  — all of this is opt-in
- Light/dark/system theme, switchable in Settings
- English / Myanmar language switching, switchable in Settings

### Barcode scanning

Two ways to scan a product's barcode on the POS screen — both look up the
product by its `barcode` field and add it to the cart:

- **Phone camera** — tap the scan icon in the header to open the camera
  (EAN-13/8, UPC-A/E, Code128/39, QR).
- **Physical barcode scanner** — any Bluetooth or USB scanner in "HID
  keyboard wedge" mode works automatically once paired in the OS's Bluetooth
  settings, no extra setup in the app. These scanners just type the barcode
  followed by Enter, like a keyboard; the POS screen listens for that
  invisibly in the background whenever the camera isn't open.

### Barcode label printing

Print a name/price/barcode label for any product (Products > tap the tag
icon on a product row) to a Bluetooth label printer, in any of four command
languages, picked in Settings > Printer > Label Printer Protocol:

- **ESC/POS** and **TSPL** print the whole label as one bitmap image
  (`react-native-view-shot` captures an off-screen `LabelView`, same
  technique receipt printing already used) — TSPL via this app's existing
  `react-native-bluetooth-escpos-printer` dependency's built-in TSC module
  (`BluetoothTscPrinter.printLabel`, which already ships bitmap support),
  ESC/POS via the same `printPic` receipt printing uses.
- **CPCL** and **ZPL** have no native module in that library, so the app
  builds their raw bitmap commands itself (`src/utils/labelCommands.ts` —
  CPCL's `EG`, ZPL's `^GFA`) from the same captured image, decoded via
  `react-native-view-shot`'s uncompressed `format:"raw"` capture (no PNG
  decoding library needed) and sent over a small native patch,
  `printRawData`, added to the same library (see
  `patches/react-native-bluetooth-escpos-printer+0.0.5.patch`) — this
  library has no generic "write raw bytes" method otherwise.

All four protocols print the label as a bitmap, not native text/barcode
commands, on purpose: their built-in fonts have no Myanmar glyphs, so any
product name or label text in Myanmar has to go through a real text
renderer (RN's `<Text>`) and get captured as pixels — there's no reliable
way to mix "native barcode command" with "bitmap Myanmar text" cleanly, so
the whole label is one image everywhere for consistency.

Each product can set its own label text (vertical text on the label's right
edge, matching the shop name in the reference design); Settings > Shop
Settings has a shop-wide default used when a product leaves it blank.
Printing supports a quantity (batch printing the same label N times).

**Requires a native rebuild, not just a JS reload** — the `printRawData`
patch changes Android native code
(`RNBluetoothEscposPrinterModule.java`), so `CPCL`/`ZPL` printing won't work
until the dev client is rebuilt (`expo run:android` or a new EAS build).
`ESC/POS`/`TSPL` don't touch native code and work as soon as the JS bundle
updates.

**Confidence varies a lot by protocol** — this was built and typechecked in
an environment with no physical printer or device to test against, so:
- **TSPL** is the best-supported path: it reuses this library's own
  Android-native TSC bitmap conversion, the same approach the app's ESC/POS
  receipt printing has used successfully for a while.
- **ESC/POS** labels reuse `printPic` exactly as receipts already do —
  well-proven, just a different, smaller image.
- **CPCL and ZPL are the least tested** — the bitmap command bytes
  (`labelCommands.ts`) and the raw ARGB pixel decode
  (`labelRaw.ts`) are logic-checked but never run against real hardware.
  If a label prints garbled or the wrong size on a real CPCL/ZPL printer,
  start with: `labelRaw.ts`'s black/white threshold (byte-order-independent
  by design, but double-check against your printer's actual output) and
  `labelCommands.ts`'s CPCL header (`! 0 200 200 ...` — the "200 200" dpi
  figure is copied from common CPCL examples, not derived from any specific
  printer's real dpi).
- Only Android's native side got the `printRawData` patch — iOS Bluetooth
  Classic support in `react-native-bluetooth-escpos-printer` was already
  weaker than Android's before this feature, so CPCL/ZPL printing from iOS
  is unverified either way.

Label size (width/height/gap, in mm) is configurable in Settings > Printer;
the default (40×30mm, 2mm gap) matches a common small self-adhesive barcode
label roll.

### Backup & restore

Settings > Backup & Restore, admin only:

- **Export Backup** — reads every table in the SQLite database (discovered
  from `sqlite_master` at export time, not a hardcoded list, so a table
  added later doesn't need this feature updated too), bundles them plus
  every product photo into one `.zip` (`backup.json` + an `images/`
  folder), and opens the share sheet — same "there's no backend to upload
  to, so hand it to the OS" pattern receipt PDF/Excel export already use.
  Zipping is done with `jszip`, a pure-JS library with no native code, so
  unlike the barcode label feature this doesn't need a rebuild to work.
- **Restore Backup** — picks a `.zip` via `expo-document-picker`, then
  **replaces every table's contents with the backup's**, restoring product
  photos alongside it, inside a single transaction (so a failure partway
  rolls back instead of leaving a half-restored database). This is
  destructive and has no undo — the screen has two separate confirmations
  before it touches anything, and the README is telling you the same thing
  again here on purpose: don't restore over data you haven't backed up.
- After a restore, close and reopen the app — every screen's already-loaded
  in-memory state (Zustand stores) doesn't know the database changed out
  from under it.

**`expo-document-picker` needs a native rebuild too** — same caveat as the
barcode label patch, different reason: it's a new native module, not a
patched one, but the effect is the same. Restore won't work (the file
picker won't open) until `expo run:android`/`expo run:ios` or a new
EAS/dev-client build. Export doesn't need this — it only touches
`expo-file-system`/`expo-sharing`, both already in the app.

**Confidence note**: the zip round-trip (`jszip` writing then reading back
a JSON file plus base64-encoded binary data, the exact shape this feature
uses) was verified by actually running it in Node during development — see
the "Barcode label printing" section above for contrast on what "verified"
means for the printer-protocol code, which had no such option. The SQL
restore path (wipe + re-insert every table, foreign keys off for the
duration) is logic-checked and follows the same transaction pattern already
used elsewhere in the app (`productsRepo.ts`), but — like everything else
in this app — was never run against a real device from this environment.

### License activation

`app/_layout.tsx` checks license status before anything else runs —
before `initDatabase()`, before auth. Not activated (or the server
rejected it) → `LicenseGateScreen` (key + optional shop/location name),
blocking every other screen until it clears.

- **`src/utils/license.ts`** — `registerLicense`/`checkLicense` call
  `https://pos.superall.app/api/register` / `/api/check`. Device identity
  (`device_info.mac_address` / `pos_machine_id`) is a locally-generated
  UUID, not a real MAC address — apps haven't been able to read the actual
  hardware MAC since Android 6 (every app gets the same constant back) and
  iOS never exposed one at all, so this is a `SecureStore`-persisted UUID
  filling the same wire field the server already expects, stable for the
  life of the install.
- **`src/store/licenseStore.ts`** — activation requires a real server
  response (an offline first activation attempt fails with a clear "no
  internet" message, rather than silently granting access to an
  unverified key). A later re-check, on every app start, trusts a
  previously-successful activation if the device happens to be offline at
  that moment — consistent with the rest of the app's offline-first
  design. A server response that explicitly rejects the key (expired/
  inactive/invalid) clears the stored config so the gate screen starts
  from a blank field rather than silently re-trying the same rejected key
  forever.

**Needs `expo-secure-store`, a new native module** — same native-rebuild
requirement as the barcode label and backup features already in this app;
nothing here works until the dev client/EAS build is refreshed.

## Getting started

`react-native-bluetooth-escpos-printer` (receipt printing) is a bare native
module — it isn't included in the plain **Expo Go** app, so `expo start` +
scanning the QR code with Expo Go will crash on launch
(`Cannot set property 'DIRECTION' of null`). You need a custom **dev
client** build instead, which compiles that native module in:

```bash
npm install
npx expo run:android   # or: npx expo run:ios (needs a Mac)
```

This builds and installs a dev client on a connected device/emulator (needs
Android Studio/Xcode set up locally). After that first build, use
`npm run start` day-to-day and open the app with the dev client you built —
not Expo Go. Whenever a new native module is added (like `expo-print` for
PDF receipts), rerun `npx expo run:android`/`run:ios` once to rebuild the
dev client with it — a plain `npm install` alone isn't enough.

First run seeds a default admin account (`admin` / `admin123`) — change the
password from Settings after logging in.

## Project layout

- `app/` — Expo Router screens (`(auth)` login, `(pos)` main app)
- `src/db/` — `expo-sqlite` schema + repositories (products, sales, users, shop)
- `src/store/` — Zustand stores wiring screens to the db layer
- `src/components/`, `src/context/`, `src/theme.ts` — shared UI/theme
- `backend/` — optional companion C#/ASP.NET Core sync API; see its own
  README for the sync contract and how to run it. The app works fully
  without it
- `backend-laravel/` — the same optional sync API, as a PHP/Laravel port
  (identical contract — the mobile app talks to either one identically).
  Pick whichever language you'd rather run; see its own README
