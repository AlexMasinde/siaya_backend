-- Speed up mobilizer voter pool queries (registered voters per polling center)
CREATE INDEX idx_participants_mobilizer_pool
  ON participants (eventId, constituency(80), ward(80), pollingCenter(80), isRegisteredVoter);
