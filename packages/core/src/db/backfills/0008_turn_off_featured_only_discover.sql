-- Turn off Jant Discover for sites that stored the retired `featured` choice.
-- Earlier releases let a site offer a directory only its featured posts. The
-- choice is gone, and reading the stored value as `latest` would list every
-- public post of a site whose owner agreed to less, so it becomes `off`: the
-- owner turns Discover on again in Settings to be listed.
--
-- Idempotent: an updated row reads `off` and matches nothing on a rerun.
UPDATE "site_setting"
SET "value" = 'off'
WHERE "key" = 'DISCOVER'
  AND "value" = 'featured';
