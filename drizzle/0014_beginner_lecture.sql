-- Beginner lecture flag: set while a paid, called beginner is attending the
-- lecture before seat assignment. Additive only; existing rows stay NULL.
ALTER TABLE tickets ADD COLUMN lecture_at INTEGER;
