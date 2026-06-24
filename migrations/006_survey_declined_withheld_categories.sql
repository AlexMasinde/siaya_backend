-- Declined (not interested) and withheld (will not disclose) survey categories

ALTER TABLE survey_response_options
  MODIFY COLUMN category ENUM(
    'supporter', 'opposition', 'neutral', 'unreachable', 'relocated', 'declined', 'withheld'
  ) NOT NULL;

ALTER TABLE survey_stats
  ADD COLUMN declined INT UNSIGNED NOT NULL DEFAULT 0 AFTER relocated,
  ADD COLUMN withheld INT UNSIGNED NOT NULL DEFAULT 0 AFTER declined;

ALTER TABLE survey_agent_stats
  ADD COLUMN declined INT UNSIGNED NOT NULL DEFAULT 0 AFTER relocated,
  ADD COLUMN withheld INT UNSIGNED NOT NULL DEFAULT 0 AFTER declined;

ALTER TABLE survey_jurisdiction_stats
  ADD COLUMN declined INT UNSIGNED NOT NULL DEFAULT 0 AFTER relocated,
  ADD COLUMN withheld INT UNSIGNED NOT NULL DEFAULT 0 AFTER declined;
