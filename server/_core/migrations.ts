/**
 * Idempotent runtime migrations.
 *
 * Reason: the production MySQL database has some columns that drifted from
 * the Drizzle schema. Most notably `moves.pickupDate` and `moves.deliveryDate`
 * were created as `DATE NULL` in production, while the schema defines them as
 * `TIMESTAMP NOT NULL`. The mismatch causes inserts of JS Date objects to
 * silently store NULL.
 *
 * Each function here is safe to run multiple times: it inspects the live
 * column definition first and only runs the ALTER if needed.
 */
import { getDb } from "../db";

type ColumnInfo = {
  Field: string;
  Type: string;
  Null: "YES" | "NO";
  Key: string;
  Default: string | null;
  Extra: string;
};

async function getColumnInfo(table: string, column: string): Promise<ColumnInfo | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    // drizzle's mysql2 wrapper exposes execute() that returns
    // [rows, fields] – we just need the rows.
    const result: any = await (db as any).execute(
      `SHOW COLUMNS FROM \`${table}\` WHERE Field = '${column}'`
    );
    const rows = Array.isArray(result?.[0]) ? result[0] : result;
    return Array.isArray(rows) && rows.length > 0 ? (rows[0] as ColumnInfo) : null;
  } catch (err) {
    console.error(`[migrations] Failed to inspect ${table}.${column}:`, err);
    return null;
  }
}

async function fixMovesDateColumns(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  for (const col of ["pickupDate", "deliveryDate"] as const) {
    const info = await getColumnInfo("moves", col);
    if (!info) {
      console.log(`[migrations] moves.${col} not found, skipping`);
      continue;
    }

    const typeIsCorrect = info.Type.toLowerCase().startsWith("timestamp");
    const nullabilityIsCorrect = info.Null === "NO";

    if (typeIsCorrect && nullabilityIsCorrect) {
      console.log(`[migrations] moves.${col} OK (${info.Type}, Null=${info.Null})`);
      continue;
    }

    console.log(
      `[migrations] moves.${col} needs fix: was ${info.Type} Null=${info.Null}, fixing to TIMESTAMP NOT NULL`
    );

    try {
      // Step 1: backfill any existing NULL/zero rows with a sensible default
      // so the NOT NULL constraint can be applied.
      await (db as any).execute(
        `UPDATE \`moves\` SET \`${col}\` = COALESCE(\`${col}\`, NOW()) WHERE \`${col}\` IS NULL`
      );

      // Step 2: change the column type. We use TIMESTAMP NOT NULL DEFAULT
      // CURRENT_TIMESTAMP so existing/future inserts that somehow miss the
      // value still get a valid timestamp instead of failing.
      await (db as any).execute(
        `ALTER TABLE \`moves\` MODIFY COLUMN \`${col}\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
      );

      console.log(`[migrations] moves.${col} fixed successfully`);
    } catch (alterErr) {
      console.error(`[migrations] Failed to ALTER moves.${col}:`, alterErr);
    }
  }
}

/**
 * Run on server boot. Each migration is idempotent and logs its own status.
 * Failures are logged but do not crash the server – we'd rather start up
 * with a known-broken column than not start at all.
 */
async function fixMoveImagesColumns(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Inspect existing columns once
  let existingCols: ColumnInfo[] = [];
  try {
    const result: any = await (db as any).execute(`SHOW COLUMNS FROM \`moveImages\``);
    const rows = Array.isArray(result?.[0]) ? result[0] : result;
    existingCols = Array.isArray(rows) ? (rows as ColumnInfo[]) : [];
  } catch (err) {
    console.error("[migrations] could not list moveImages columns:", err);
    return;
  }

  const colNames = new Set(existingCols.map(c => c.Field));

  // 1. Add `data` LONGBLOB column if missing — used to store the binary
  //    bytes of customer/damage/complaint photos. Without it, every photo
  //    insert that uses .data fails silently because Drizzle's `as any`
  //    cast makes TS happy but MySQL still rejects unknown columns.
  if (!colNames.has("data")) {
    try {
      await (db as any).execute(`ALTER TABLE \`moveImages\` ADD COLUMN \`data\` LONGBLOB NULL`);
      console.log("[migrations] moveImages.data column added");
    } catch (err) {
      console.error("[migrations] failed to add moveImages.data:", err);
    }
  }

  // 2. Add `mimeType` column if missing.
  if (!colNames.has("mimeType")) {
    try {
      await (db as any).execute(
        `ALTER TABLE \`moveImages\` ADD COLUMN \`mimeType\` VARCHAR(80) NOT NULL DEFAULT 'image/jpeg'`
      );
      console.log("[migrations] moveImages.mimeType column added");
    } catch (err) {
      console.error("[migrations] failed to add moveImages.mimeType:", err);
    }
  }

  // 3. Make `imageUrl` nullable (or with a default) — historically the
  //    schema required it NOT NULL, but our new flow saves the photo to
  //    the DB first and then updates imageUrl with `/api/images/<id>`
  //    in a second statement. The intermediate insert must succeed.
  const imageUrlCol = existingCols.find(c => c.Field === "imageUrl");
  if (imageUrlCol && imageUrlCol.Null === "NO" && imageUrlCol.Default === null) {
    try {
      await (db as any).execute(
        `ALTER TABLE \`moveImages\` MODIFY COLUMN \`imageUrl\` TEXT NULL`
      );
      console.log("[migrations] moveImages.imageUrl made nullable");
    } catch (err) {
      console.error("[migrations] failed to relax moveImages.imageUrl:", err);
    }
  }
}

export async function runRuntimeMigrations(): Promise<void> {
  console.log("[migrations] starting runtime migrations");
  try {
    await fixMovesDateColumns();
  } catch (err) {
    console.error("[migrations] unexpected error in fixMovesDateColumns:", err);
  }
  try {
    await fixMoveImagesColumns();
  } catch (err) {
    console.error("[migrations] unexpected error in fixMoveImagesColumns:", err);
  }
  console.log("[migrations] done");
}
