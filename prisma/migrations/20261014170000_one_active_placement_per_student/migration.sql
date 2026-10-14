-- N-1: enforce exclusivity for all writers, including concurrent activations.
-- Existing duplicate ACTIVE placements must be resolved explicitly before deployment.
CREATE UNIQUE INDEX "placements_one_active_per_student"
ON "placements" ("studentId") WHERE "status" = 'ACTIVE';
