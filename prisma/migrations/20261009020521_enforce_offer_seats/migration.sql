-- E2-02: las postulaciones aceptadas de una oferta no superan sus cupos, garantizado por la base.
--
-- Por qué un trigger y no solo código: `ApplicationService.decide` lee cuántas hay aceptadas y después
-- escribe; entre las dos operaciones hay una ventana (E2-01). Un trigger se ejecuta dentro del mismo
-- UPDATE, así que ningún camino (el servicio, otro servicio, un script, psql) puede dejar la oferta
-- sobrecupada.
--
-- Cómo evita la carrera: bloquea la fila de la oferta (FOR UPDATE) antes de contar. Dos aceptaciones
-- simultáneas de la misma oferta se serializan: la segunda espera, ve la aceptada de la primera y falla.
--
-- Alcance a propósito: solo protege las TRANSICIONES a ACCEPTED (UPDATE OF status), que es la única
-- vía del producto (`decide`). No toca los INSERT: `prisma/seed.ts` inserta postulaciones ya
-- ACCEPTED, y hoy el seed deja 36 de 37 ofertas con más aceptadas que cupos; bloquear el INSERT
-- rompería `pnpm db:seed`. Tampoco bloquea reescribir una aceptada que sigue aceptada.

CREATE OR REPLACE FUNCTION enforce_offer_seats() RETURNS trigger AS $$
DECLARE
  seats_allowed integer;
  accepted_others integer;
BEGIN
  IF NEW."status" <> 'ACCEPTED' THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACCEPTED' AND OLD."offerId" = NEW."offerId" THEN
    RETURN NEW;
  END IF;

  SELECT "seats" INTO seats_allowed FROM "offers" WHERE "id" = NEW."offerId" FOR UPDATE;

  SELECT count(*) INTO accepted_others
  FROM "applications"
  WHERE "offerId" = NEW."offerId" AND "status" = 'ACCEPTED' AND "id" <> NEW."id";

  IF accepted_others >= seats_allowed THEN
    RAISE EXCEPTION 'offer_full: la oferta % ya no tiene cupos', NEW."offerId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "applications_enforce_offer_seats"
  BEFORE UPDATE OF "status", "offerId" ON "applications"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_offer_seats();
