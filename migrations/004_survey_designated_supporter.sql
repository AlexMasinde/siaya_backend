-- Designated supporter flag; remove reliance on default system options

ALTER TABLE survey_response_options
  ADD COLUMN isDesignatedSupporter TINYINT(1) NOT NULL DEFAULT 0 AFTER isSystem;

DELETE FROM survey_response_options WHERE isSystem = 1;
