-- Relocated / out-of-electoral-area survey response category

ALTER TABLE survey_response_options
  MODIFY COLUMN category ENUM('supporter', 'opposition', 'neutral', 'unreachable', 'relocated') NOT NULL;

ALTER TABLE survey_stats
  ADD COLUMN relocated INT UNSIGNED NOT NULL DEFAULT 0 AFTER notFound;

ALTER TABLE survey_agent_stats
  ADD COLUMN relocated INT UNSIGNED NOT NULL DEFAULT 0 AFTER notFound;

ALTER TABLE survey_jurisdiction_stats
  ADD COLUMN relocated INT UNSIGNED NOT NULL DEFAULT 0 AFTER notFound;
