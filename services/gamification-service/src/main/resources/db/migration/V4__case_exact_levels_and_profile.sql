ALTER TABLE analyst_profiles DROP CONSTRAINT analyst_profiles_level_check;
UPDATE analyst_profiles
   SET level = CASE level
       WHEN 'BEGINNER' THEN 'BRONZ'
       WHEN 'EXPERIENCED' THEN 'GUMUS'
       WHEN 'EXPERT' THEN 'ALTIN'
       WHEN 'MASTER' THEN 'PLATIN'
       ELSE level
   END;
ALTER TABLE analyst_profiles ALTER COLUMN level SET DEFAULT 'BRONZ';
ALTER TABLE analyst_profiles ADD CONSTRAINT analyst_profiles_level_check
    CHECK (level IN ('BRONZ', 'GUMUS', 'ALTIN', 'PLATIN'));

ALTER TABLE case_facts ADD COLUMN feedback_score SMALLINT
    CHECK (feedback_score BETWEEN 1 AND 5);
