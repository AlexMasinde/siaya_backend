-- Phase 0: analytics indexes + summary tables (production)
-- Run once against the live database when synchronize is disabled.
-- grainKey columns use SHA-256 hex (64 chars) to keep unique indexes under InnoDB limits.

-- ---------------------------------------------------------------------------
-- check_in_logs
-- ---------------------------------------------------------------------------
CREATE INDEX idx_check_in_logs_event_checked_at ON check_in_logs (eventId, checkedInAt);
CREATE INDEX idx_check_in_logs_event_date ON check_in_logs (eventId, checkInDate);
CREATE INDEX idx_check_in_logs_event_agent ON check_in_logs (eventId, checkedInById);

-- ---------------------------------------------------------------------------
-- participants
-- ---------------------------------------------------------------------------
CREATE INDEX idx_participants_event ON participants (eventId);
CREATE INDEX idx_participants_event_ward ON participants (eventId, ward);
CREATE INDEX idx_participants_event_polling_center ON participants (eventId, pollingCenter);
CREATE INDEX idx_participants_event_constituency ON participants (eventId, constituency);

-- ---------------------------------------------------------------------------
-- event_jurisdiction_stats
-- ---------------------------------------------------------------------------
CREATE TABLE event_jurisdiction_stats (
  id CHAR(36) NOT NULL PRIMARY KEY,
  eventId CHAR(36) NOT NULL,
  grainKey CHAR(64) NOT NULL,
  county VARCHAR(255) NOT NULL DEFAULT '',
  constituency VARCHAR(255) NOT NULL DEFAULT '',
  ward VARCHAR(255) NOT NULL DEFAULT '',
  pollingCenter VARCHAR(255) NOT NULL DEFAULT '',
  uniqueMobilized INT UNSIGNED NOT NULL DEFAULT 0,
  checkInCount INT UNSIGNED NOT NULL DEFAULT 0,
  lastMobilizedAt TIMESTAMP NULL,
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_event_jurisdiction_stats_grain (eventId, grainKey),
  KEY idx_event_jurisdiction_stats_event (eventId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- event_daily_stats
-- ---------------------------------------------------------------------------
CREATE TABLE event_daily_stats (
  id CHAR(36) NOT NULL PRIMARY KEY,
  eventId CHAR(36) NOT NULL,
  statDate DATE NOT NULL,
  checkInCount INT UNSIGNED NOT NULL DEFAULT 0,
  uniqueMobilized INT UNSIGNED NOT NULL DEFAULT 0,
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_event_daily_stats_event_date (eventId, statDate),
  KEY idx_event_daily_stats_event (eventId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- event_agent_stats
-- ---------------------------------------------------------------------------
CREATE TABLE event_agent_stats (
  id CHAR(36) NOT NULL PRIMARY KEY,
  eventId CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  grainKey CHAR(64) NOT NULL,
  pollingCenter VARCHAR(255) NOT NULL DEFAULT '',
  ward VARCHAR(255) NOT NULL DEFAULT '',
  constituency VARCHAR(255) NOT NULL DEFAULT '',
  uniqueMobilized INT UNSIGNED NOT NULL DEFAULT 0,
  checkInCount INT UNSIGNED NOT NULL DEFAULT 0,
  lastMobilizedAt TIMESTAMP NULL,
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_event_agent_stats_grain (eventId, userId, grainKey),
  KEY idx_event_agent_stats_event_user (eventId, userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
