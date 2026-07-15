import "server-only";

import { and, asc, eq, gt, ilike, or } from "drizzle-orm";
import { z } from "zod";

import {
  appearanceConfigs,
  appearanceLockState,
  appearanceThemeDrafts,
  appearanceThemes,
} from "@/db/schema";
import {
  appearanceSnapshotSchema,
  themeListDataSchema,
  type AppearanceSnapshot,
  type DeclaredScheme,
  type StoredTheme,
} from "@/features/appearance/schemas/appearance-schema";
import {
  decodeAppearanceConfig,
  decodeAppliedTheme,
  decodeStoredDraft,
  decodeStoredTheme,
} from "@/features/appearance/server/appearance-codec";
import { ensureAppearanceAccount } from "@/features/appearance/server/appearance-db";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors/app-error";

const appearanceThemeCursorSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
});

function encodeCursor(value: { id: string }): string {
  return Buffer.from(JSON.stringify({ version: 1, id: value.id }), "utf8").toString("base64url");
}

function decodeCursor(value: string | null | undefined): { id: string } | null {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = appearanceThemeCursorSchema.safeParse(decoded);
    return parsed.success ? { id: parsed.data.id } : null;
  } catch {
    return null;
  }
}

export async function getAppearanceSnapshot(accountId: string): Promise<AppearanceSnapshot> {
  await ensureAppearanceAccount(accountId);
  return getDb().transaction(
    async (tx) => {
      const [state] = await tx
        .select({
          stateRevision: appearanceLockState.stateRevision,
          publishedRevision: appearanceLockState.publishedRevision,
        })
        .from(appearanceLockState)
        .where(eq(appearanceLockState.accountId, accountId))
        .limit(1);
      const [config] = await tx
        .select()
        .from(appearanceConfigs)
        .where(eq(appearanceConfigs.accountId, accountId))
        .limit(1);

      if (!state || !config) {
        throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "外观配置不存在。", status: 404 });
      }

      const ids = [config.lightThemeId, config.darkThemeId].filter((id): id is string => Boolean(id));
      const customThemes = ids.length
        ? await tx
            .select()
            .from(appearanceThemes)
            .where(
              and(
                eq(appearanceThemes.accountId, accountId),
                or(...ids.map((id) => eq(appearanceThemes.id, id))),
              ),
            )
        : [];
      const lightRow = customThemes.find((theme) => theme.id === config.lightThemeId);
      const darkRow = customThemes.find((theme) => theme.id === config.darkThemeId);

      if ((config.lightThemeId && !lightRow) || (config.darkThemeId && !darkRow)) {
        throw new Error("Appearance config contains a dangling theme reference.");
      }
      if (lightRow && lightRow.declaredScheme !== "light") throw new Error("Light appearance slot references a dark theme.");
      if (darkRow && darkRow.declaredScheme !== "dark") throw new Error("Dark appearance slot references a light theme.");

      return appearanceSnapshotSchema.parse({
        stateRevision: state.stateRevision.toString(),
        publishedRevision: state.publishedRevision.toString(),
        config: decodeAppearanceConfig(config),
        lightTheme: decodeAppliedTheme(lightRow, "light"),
        darkTheme: decodeAppliedTheme(darkRow, "dark"),
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function listAppearanceThemes(
  accountId: string,
  options: { cursor?: string | null; query?: string | null; scheme?: DeclaredScheme | null; limit?: number },
) {
  await ensureAppearanceAccount(accountId);
  const limit = Math.min(
    APPEARANCE_TECHNICAL_LIMITS.listMaximum,
    Math.max(1, options.limit ?? APPEARANCE_TECHNICAL_LIMITS.listDefault),
  );
  const cursor = decodeCursor(options.cursor);
  if (options.cursor && !cursor) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "主题列表游标无效。", status: 400 });
  }

  const filters = [eq(appearanceThemes.accountId, accountId)];
  if (options.scheme) filters.push(eq(appearanceThemes.declaredScheme, options.scheme));
  const query = options.query?.trim();
  if (query) filters.push(ilike(appearanceThemes.name, `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`));
  if (cursor) {
    filters.push(gt(appearanceThemes.id, cursor.id));
  }

  const rows = await getDb()
    .select({
      id: appearanceThemes.id,
      name: appearanceThemes.name,
      declaredScheme: appearanceThemes.declaredScheme,
      themeRevision: appearanceThemes.themeRevision,
      updatedAt: appearanceThemes.updatedAt,
      draftThemeId: appearanceThemeDrafts.themeId,
    })
    .from(appearanceThemes)
    .leftJoin(
      appearanceThemeDrafts,
      and(
        eq(appearanceThemeDrafts.accountId, appearanceThemes.accountId),
        eq(appearanceThemeDrafts.themeId, appearanceThemes.id),
      ),
    )
    .where(and(...filters))
    .orderBy(asc(appearanceThemes.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return themeListDataSchema.parse({
    items: page.map((row) => ({
      id: row.id,
      name: row.name,
      declaredScheme: row.declaredScheme,
      themeRevision: row.themeRevision.toString(),
      updatedAt: row.updatedAt.toISOString(),
      hasDraft: row.draftThemeId !== null,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  });
}

export async function getAppearanceTheme(accountId: string, themeId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(appearanceThemes)
    .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)))
    .limit(1);
  if (!row) {
    throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "主题不存在。", status: 404 });
  }
  const [draft] = await db
    .select()
    .from(appearanceThemeDrafts)
    .where(and(eq(appearanceThemeDrafts.accountId, accountId), eq(appearanceThemeDrafts.themeId, themeId)))
    .limit(1);
  return {
    theme: decodeStoredTheme(row),
    draft: draft ? decodeStoredDraft(draft) : null,
  };
}

export async function getFormalTheme(accountId: string, themeId: string): Promise<StoredTheme> {
  return (await getAppearanceTheme(accountId, themeId)).theme;
}
