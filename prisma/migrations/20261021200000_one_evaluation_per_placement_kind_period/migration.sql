-- D-12: una sola evaluación vigente por plaza, tipo y periodo, para todos los escritores (incluidos dos envíos
-- simultáneos). Prisma no puede expresar un índice único parcial con @@unique; mismo enfoque que N-1.
--
-- Si una base existente ya tiene duplicados, se conserva la más reciente y las anteriores se marcan como borradas
-- (deletedAt) en lugar de eliminarse, y se sube su version y updatedAt para que el sync las propague. Nada se pierde:
-- `UPDATE "evaluations" SET "deletedAt" = NULL WHERE id = ...` las restaura si hiciera falta.
UPDATE "evaluations" AS old
SET "deletedAt" = NOW(), "updatedAt" = NOW(), "version" = old."version" + 1
WHERE old."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "evaluations" AS newer
    WHERE newer."deletedAt" IS NULL
      AND newer."placementId" = old."placementId"
      AND newer."kind" = old."kind"
      AND newer."period" = old."period"
      AND (newer."createdAt" > old."createdAt" OR (newer."createdAt" = old."createdAt" AND newer."id" > old."id"))
  );

CREATE UNIQUE INDEX "evaluations_one_active_per_placement_kind_period"
ON "evaluations" ("placementId", "kind", "period") WHERE "deletedAt" IS NULL;
