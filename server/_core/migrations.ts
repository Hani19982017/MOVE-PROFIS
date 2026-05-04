/**
 * Idempotent runtime migrations.
 *
 * Reason: the production MySQL database has some columns that drifted from
 * the Drizzle schema. Most notably `moves.pickupDate` and `moves.deliveryDate`
 * were created as `DATE NULL` in production, while the schema defines them as
 * `TIMESTAMP NOT NULL`. The mismatch causes inserts of JS Date objects to
 * silently store NULL.
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
      await (db as any).execute(
        `UPDATE \`moves\` SET \`${col}\` = COALESCE(\`${col}\`, NOW()) WHERE \`${col}\` IS NULL`
      );
      await (db as any).execute(
        `ALTER TABLE \`moves\` MODIFY COLUMN \`${col}\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
      );
      console.log(`[migrations] moves.${col} fixed successfully`);
    } catch (alterErr) {
      console.error(`[migrations] Failed to ALTER moves.${col}:`, alterErr);
    }
  }
}

export async function runRuntimeMigrations(): Promise<void> {
  console.log("[migrations] starting runtime migrations");
  try {
    await fixMovesDateColumns();
  } catch (err) {
    console.error("[migrations] unexpected error:", err);
  }
  console.log("[migrations] done");
}
