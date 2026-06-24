-- Survey module: call-center surveys on mobilized voters

CREATE TABLE surveys (
  id CHAR(36) NOT NULL PRIMARY KEY,
  eventId CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status ENUM('draft', 'building', 'active', 'closed') NOT NULL DEFAULT 'draft',
  createdById CHAR(36) NOT NULL,
  startedAt TIMESTAMP NULL,
  closedAt TIMESTAMP NULL,
  mobilizedSnapshot INT UNSIGNED NOT NULL DEFAULT 0,
  callableTotal INT UNSIGNED NOT NULL DEFAULT 0,
  noPhoneCount INT UNSIGNED NOT NULL DEFAULT 0,
  createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_surveys_event (eventId),
  CONSTRAINT fk_surveys_event FOREIGN KEY (eventId) REFERENCES events (eventId) ON DELETE CASCADE,
  CONSTRAINT fk_surveys_created_by FOREIGN KEY (createdById) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE survey_agents (
  id CHAR(36) NOT NULL PRIMARY KEY,
  surveyId CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_survey_agents_survey_user (surveyId, userId),
  CONSTRAINT fk_survey_agents_survey FOREIGN KEY (surveyId) REFERENCES surveys (id) ON DELETE CASCADE,
  CONSTRAINT fk_survey_agents_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE survey_assignments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  surveyId CHAR(36) NOT NULL,
  participantId VARCHAR(255) NOT NULL,
  agentId CHAR(36) NOT NULL,
  participantName VARCHAR(255) NULL,
  phoneNumber VARCHAR(20) NULL,
  county VARCHAR(255) NOT NULL DEFAULT '',
  constituency VARCHAR(255) NOT NULL DEFAULT '',
  ward VARCHAR(255) NOT NULL DEFAULT '',
  pollingCenter VARCHAR(255) NOT NULL DEFAULT '',
  grainKey CHAR(64) NOT NULL DEFAULT '',
  status ENUM('pending', 'completed') NOT NULL DEFAULT 'pending',
  response ENUM('supporter', 'not_supporter', 'undecided', 'not_found') NULL,
  recordedById CHAR(36) NULL,
  recordedAt TIMESTAMP NULL,
  createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_survey_assignments_survey_participant (surveyId, participantId),
  KEY idx_survey_assignments_queue (surveyId, agentId, status),
  KEY idx_survey_assignments_survey_status (surveyId, status),
  CONSTRAINT fk_survey_assignments_survey FOREIGN KEY (surveyId) REFERENCES surveys (id) ON DELETE CASCADE,
  CONSTRAINT fk_survey_assignments_agent FOREIGN KEY (agentId) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_survey_assignments_recorded_by FOREIGN KEY (recordedById) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE survey_stats (
  id CHAR(36) NOT NULL PRIMARY KEY,
  surveyId CHAR(36) NOT NULL,
  pending INT UNSIGNED NOT NULL DEFAULT 0,
  completed INT UNSIGNED NOT NULL DEFAULT 0,
  supporter INT UNSIGNED NOT NULL DEFAULT 0,
  notSupporter INT UNSIGNED NOT NULL DEFAULT 0,
  undecided INT UNSIGNED NOT NULL DEFAULT 0,
  notFound INT UNSIGNED NOT NULL DEFAULT 0,
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_survey_stats_survey (surveyId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE survey_agent_stats (
  id CHAR(36) NOT NULL PRIMARY KEY,
  surveyId CHAR(36) NOT NULL,
  agentId CHAR(36) NOT NULL,
  assigned INT UNSIGNED NOT NULL DEFAULT 0,
  pending INT UNSIGNED NOT NULL DEFAULT 0,
  completed INT UNSIGNED NOT NULL DEFAULT 0,
  supporter INT UNSIGNED NOT NULL DEFAULT 0,
  notSupporter INT UNSIGNED NOT NULL DEFAULT 0,
  undecided INT UNSIGNED NOT NULL DEFAULT 0,
  notFound INT UNSIGNED NOT NULL DEFAULT 0,
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_survey_agent_stats_survey_agent (surveyId, agentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE survey_jurisdiction_stats (
  id CHAR(36) NOT NULL PRIMARY KEY,
  surveyId CHAR(36) NOT NULL,
  grainKey CHAR(64) NOT NULL,
  county VARCHAR(255) NOT NULL DEFAULT '',
  constituency VARCHAR(255) NOT NULL DEFAULT '',
  ward VARCHAR(255) NOT NULL DEFAULT '',
  pollingCenter VARCHAR(255) NOT NULL DEFAULT '',
  pending INT UNSIGNED NOT NULL DEFAULT 0,
  completed INT UNSIGNED NOT NULL DEFAULT 0,
  supporter INT UNSIGNED NOT NULL DEFAULT 0,
  notSupporter INT UNSIGNED NOT NULL DEFAULT 0,
  undecided INT UNSIGNED NOT NULL DEFAULT 0,
  notFound INT UNSIGNED NOT NULL DEFAULT 0,
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_survey_jurisdiction_stats_grain (surveyId, grainKey),
  KEY idx_survey_jurisdiction_stats_survey (surveyId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE survey_daily_stats (
  id CHAR(36) NOT NULL PRIMARY KEY,
  surveyId CHAR(36) NOT NULL,
  statDate DATE NOT NULL,
  responsesRecorded INT UNSIGNED NOT NULL DEFAULT 0,
  supportersRecorded INT UNSIGNED NOT NULL DEFAULT 0,
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_survey_daily_stats_survey_date (surveyId, statDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
