-- Give every existing partner a C0001 / F0001-style code (customers "C", suppliers-only "F"), numbered per organization by name.
WITH numbered AS (
  SELECT id,
         CASE WHEN "isCustomer" THEN 'C' ELSE 'F' END AS prefix,
         ROW_NUMBER() OVER (PARTITION BY "orgId", "isCustomer" ORDER BY name) AS n
  FROM "partners"
  WHERE code IS NULL
)
UPDATE "partners" p
SET code = numbered.prefix || LPAD(numbered.n::text, 4, '0')
FROM numbered
WHERE p.id = numbered.id;
