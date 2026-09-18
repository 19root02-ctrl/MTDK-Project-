-- One-time correction for an existing deployment whose release row was
-- unintentionally left in the released state. Run this manually once.
BEGIN;

UPDATE release_controls
SET hall_ticket_released = FALSE,
    result_released = FALSE,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

COMMIT;