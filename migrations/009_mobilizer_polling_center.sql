-- Mobilizers assigned to a polling center; self-select registered voters (max 30)

ALTER TABLE event_mobilization_roles
  ADD COLUMN assignedPollingCenter VARCHAR(255) NULL AFTER role,
  ADD COLUMN assignedWard VARCHAR(255) NOT NULL DEFAULT '' AFTER assignedPollingCenter,
  ADD COLUMN assignedConstituency VARCHAR(255) NOT NULL DEFAULT '' AFTER assignedWard;

CREATE INDEX idx_event_mobilization_roles_pc
  ON event_mobilization_roles (eventId, assignedPollingCenter(80), assignedWard(80), assignedConstituency(80));
