-- Custom survey response options + per-option stats

CREATE TABLE survey_response_options (
  id CHAR(36) NOT NULL PRIMARY KEY,
  surveyId CHAR(36) NOT NULL,
  code VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  category ENUM('supporter', 'opposition', 'neutral', 'unreachable') NOT NULL,
  sortOrder INT UNSIGNED NOT NULL DEFAULT 0,
  isSystem TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_survey_response_options_survey_code (surveyId, code),
  KEY idx_survey_response_options_survey (surveyId),
  CONSTRAINT fk_survey_response_options_survey FOREIGN KEY (surveyId) REFERENCES surveys (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE survey_response_option_stats (
  id CHAR(36) NOT NULL PRIMARY KEY,
  surveyId CHAR(36) NOT NULL,
  optionId CHAR(36) NOT NULL,
  count INT UNSIGNED NOT NULL DEFAULT 0,
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_survey_response_option_stats (surveyId, optionId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE survey_assignments
  ADD COLUMN responseOptionId CHAR(36) NULL AFTER response,
  ADD KEY idx_survey_assignments_response_option (responseOptionId),
  ADD CONSTRAINT fk_survey_assignments_response_option
    FOREIGN KEY (responseOptionId) REFERENCES survey_response_options (id);
