-- D-11: el trigger de cupos también protege los INSERT con status ACCEPTED.
--
-- E2-02 dejó los INSERT sin proteger porque `prisma/seed.ts` insertaba postulaciones ya ACCEPTED y
-- dejaba casi todas las ofertas sobrecupadas. El seed ya calcula los cupos a partir de las aceptadas
-- que reparte (D-11), así que la excepción deja de hacer falta: ningún camino que cree una aceptada
-- (servicio, script, psql, seed) puede pasar de `seats`.
--
-- Cuidado con OLD: en un INSERT no existe, por eso solo se consulta cuando TG_OP = 'UPDATE'.
-- Una aceptada que sigue aceptada en la misma oferta no se bloquea (ofertas ya sobrecupadas por datos
-- anteriores siguen siendo editables). Los datos existentes no se tocan.

CREATE OR REPLACE FUNCTION enforce_offer_seats() RETURNS trigger AS $$
DECLARE
  seats_allowed integer;
  accepted_others integer;
BEGIN
  IF NEW."status" <> 'ACCEPTED' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'ACCEPTED' AND OLD."offerId" = NEW."offerId" THEN
      RETURN NEW;
    END IF;
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

DROP TRIGGER "applications_enforce_offer_seats" ON "applications";

CREATE TRIGGER "applications_enforce_offer_seats"
  BEFORE INSERT OR UPDATE OF "status", "offerId" ON "applications"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_offer_seats();
