import JSZip from "jszip";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { saveToDevice } from "./directSave";
import { getDb } from "../db/database";

// Bumped only if the export shape itself changes (not on every schema
// tweak) — importBackup() rejects a file with a newer version than this
// build understands, rather than silently corrupting the database.
const BACKUP_VERSION = 1;

// Product photos live outside SQLite (see productImage.ts) — a table's row
// only stores the file path. This marker replaces that path in the
// exported JSON, and importBackup() rewrites it back to a real,
// freshly-extracted file path (which won't be the same on the restoring
// device, or even the same device after a reinstall).
const IMAGE_MARKER = "__backup_image__:";

const IMAGE_DIR = `${FileSystem.documentDirectory}products/`;

type TableName = string;
type Row = Record<string, unknown>;

// Every user-created table, discovered from the schema itself rather than
// hardcoded — a new table added later is automatically included without
// this file needing an update. sqlite_sequence (autoincrement bookkeeping)
// is excluded on purpose: restoring explicit ids (see restoreTable below)
// makes SQLite recompute it on its own, and writing it manually risks
// setting it to a stale value if this list ever drifts from the schema.
const listTables = async (db: Awaited<ReturnType<typeof getDb>>): Promise<TableName[]> => {
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%'`
  );
  return rows.map(r => r.name);
};

const readableName = (uri: string) => uri.split("/").pop() || `${Date.now()}`;

export const exportBackup = async (method: "share" | "save" = "share"): Promise<boolean> => {
  const db = await getDb();
  const tables = await listTables(db);

  const zip = new JSZip();
  const data: Record<TableName, Row[]> = {};

  for (const table of tables) {
    const rows = await db.getAllAsync<Row>(`SELECT * FROM ${table}`);

    if (table === "products") {
      for (const row of rows) {
        const uri = row.image_uri as string | null;
        if (!uri) continue;
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists) continue; // image_uri points at a file that's already gone — export the row without one rather than fail the whole backup
        const name = readableName(uri);
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        zip.file(`images/${name}`, base64, { base64: true });
        row.image_uri = `${IMAGE_MARKER}${name}`;
      }
    }

    data[table] = rows;
  }

  zip.file("backup.json", JSON.stringify({
    version:    BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appName:    "Retail POS",
    tables:     data,
  }));

  const zipBase64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `retail-pos-backup-${stamp}.zip`;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, zipBase64, { encoding: FileSystem.EncodingType.Base64 });

  if (method === "save") {
    return saveToDevice(uri, "application/zip", fileName);
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType:    "application/zip",
      dialogTitle: "Export Backup",
      UTI:         "com.pkware.zip-archive",
    });
  }
  return true;
};

// Wipes every table this build knows about and replaces it with the
// backup's rows, inside one transaction — either the whole restore lands or
// none of it does, never a half-restored database. Foreign key checks are
// switched off for the duration: SQLite only allows toggling that pragma
// outside a transaction, and restore order otherwise wouldn't matter (rows
// keep their original ids, including for tables with rows added after
// their referenced parent row in the backup's own key order).
export const importBackup = async (zipUri: string): Promise<void> => {
  const zipBase64 = await FileSystem.readAsStringAsync(zipUri, { encoding: FileSystem.EncodingType.Base64 });
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });

  const manifestFile = zip.file("backup.json");
  if (!manifestFile) throw new Error("INVALID_BACKUP_FILE");
  const manifest = JSON.parse(await manifestFile.async("string")) as {
    version: number;
    tables:  Record<TableName, Row[]>;
  };
  if (manifest.version > BACKUP_VERSION) throw new Error("BACKUP_VERSION_TOO_NEW");

  const info = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });

  const productRows = manifest.tables.products ?? [];
  for (const row of productRows) {
    const uri = row.image_uri as string | null;
    if (typeof uri !== "string" || !uri.startsWith(IMAGE_MARKER)) continue;
    const name = uri.slice(IMAGE_MARKER.length);
    const entry = zip.file(`images/${name}`);
    if (!entry) { row.image_uri = null; continue; }
    const base64 = await entry.async("base64");
    const dest = `${IMAGE_DIR}${Date.now()}-${name}`;
    await FileSystem.writeAsStringAsync(dest, base64, { encoding: FileSystem.EncodingType.Base64 });
    row.image_uri = dest;
  }

  const db = await getDb();
  const tables = await listTables(db);

  await db.execAsync("PRAGMA foreign_keys = OFF;");
  try {
    await db.withTransactionAsync(async () => {
      // Delete first, all tables, before inserting anything — a table that
      // references another (e.g. sale_items -> sales) would otherwise see
      // its own still-present old rows collide with restored ids.
      for (const table of tables) {
        await db.runAsync(`DELETE FROM ${table}`);
      }
      for (const table of tables) {
        const rows = manifest.tables[table];
        if (!rows || rows.length === 0) continue;
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => "?").join(", ");
        const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
        for (const row of rows) {
          await db.runAsync(sql, columns.map(c => row[c] as any));
        }
      }

      // A category/product pulled from a server (never created on-device)
      // only gets sync_uuid filled in by database.ts's backfillSyncUuids,
      // which runs at app startup — not immediately on pull. If this
      // export happened before that ever ran, sync_uuid is still NULL
      // here, and clearing server_id below without fixing that first would
      // orphan the row: push() requires sync_uuid IS NOT NULL, so it'd be
      // silently excluded rather than re-sent. Reusing server_id as the
      // sync_uuid (same trick backfillSyncUuids/backfillBranchSyncUuids
      // use) keeps it pointed at the exact row the server already knows.
      await db.runAsync("UPDATE categories SET sync_uuid = server_id WHERE sync_uuid IS NULL AND server_id IS NOT NULL");
      await db.runAsync("UPDATE products SET sync_uuid = server_id WHERE sync_uuid IS NULL AND server_id IS NOT NULL");

      // server_id/synced_at mark a row as already pushed to whatever server
      // the *exporting* device was connected to. Restored verbatim, they'd
      // make push() believe this data is already synced and skip it
      // forever — even against a brand-new server that's never seen it.
      // sync_uuid stays put: it's the client-generated id push() re-sends
      // rows under, and the backend upserts idempotently on it, so clearing
      // just the "confirmed synced" markers is enough to make every row
      // eligible for a fresh push without ever risking a duplicate.
      await db.runAsync("UPDATE branches SET server_id = NULL");
      await db.runAsync("UPDATE categories SET server_id = NULL");
      await db.runAsync("UPDATE products SET server_id = NULL");
      await db.runAsync("UPDATE sales SET synced_at = NULL");
      await db.runAsync("UPDATE stock_movements SET synced_at = NULL");
      await db.runAsync("UPDATE expenses SET synced_at = NULL");

      // The restoring device shouldn't silently inherit another device's
      // server connection/credentials — force an explicit reconnect.
      await db.runAsync(
        "UPDATE sync_config SET server_url = NULL, device_api_key = NULL, bound_branch_id = NULL, last_pull_at = NULL, last_push_at = NULL, admin_key = NULL WHERE id = 1"
      );
    });
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }
};
