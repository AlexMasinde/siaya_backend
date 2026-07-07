-- Election-day mobilization: coordinators assign voters to mobilizers (max 30 each)

CREATE TABLE event_mobilization_roles (
  id CHAR(36) NOT NULL PRIMARY KEY,
  eventId CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  role ENUM('coordinator', 'mobilizer') NOT NULL,
  addedById CHAR(36) NOT NULL,
  createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_event_mobilization_roles_event_user (eventId, userId),
  KEY idx_event_mobilization_roles_event_role (eventId, role),
  CONSTRAINT fk_event_mobilization_roles_event FOREIGN KEY (eventId) REFERENCES events (eventId) ON DELETE CASCADE,
  CONSTRAINT fk_event_mobilization_roles_user FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_event_mobilization_roles_added_by FOREIGN KEY (addedById) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE event_mobilization_assignments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  eventId CHAR(36) NOT NULL,
  participantId VARCHAR(255) NOT NULL,
  mobilizerUserId CHAR(36) NOT NULL,
  participantName VARCHAR(255) NULL,
  phoneNumber VARCHAR(20) NULL,
  ward VARCHAR(255) NOT NULL DEFAULT '',
  constituency VARCHAR(255) NOT NULL DEFAULT '',
  pollingCenter VARCHAR(255) NOT NULL DEFAULT '',
  assignedById CHAR(36) NOT NULL,
  assignedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  votedAt TIMESTAMP NULL,
  markedById CHAR(36) NULL,
  createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_event_mobilization_assignments_event_participant (eventId, participantId),
  KEY idx_event_mobilization_assignments_mobilizer (eventId, mobilizerUserId),
  KEY idx_event_mobilization_assignments_voted (eventId, mobilizerUserId, votedAt),
  CONSTRAINT fk_event_mobilization_assignments_event FOREIGN KEY (eventId) REFERENCES events (eventId) ON DELETE CASCADE,
  CONSTRAINT fk_event_mobilization_assignments_participant FOREIGN KEY (participantId) REFERENCES participants (id) ON DELETE CASCADE,
  CONSTRAINT fk_event_mobilization_assignments_mobilizer FOREIGN KEY (mobilizerUserId) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_event_mobilization_assignments_assigned_by FOREIGN KEY (assignedById) REFERENCES users (id),
  CONSTRAINT fk_event_mobilization_assignments_marked_by FOREIGN KEY (markedById) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
