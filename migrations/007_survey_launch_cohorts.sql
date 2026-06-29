-- Follow-up survey launch: optional cohort selection from a prior survey

ALTER TABLE surveys
  ADD COLUMN sourceSurveyId CHAR(36) NULL AFTER noPhoneCount,
  ADD COLUMN launchCohorts JSON NULL AFTER sourceSurveyId,
  ADD CONSTRAINT fk_surveys_source_survey
    FOREIGN KEY (sourceSurveyId) REFERENCES surveys (id) ON DELETE SET NULL;
