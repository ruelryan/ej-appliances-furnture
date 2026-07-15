-- Item type is a fixed two-value taxonomy (all existing rows already comply).
-- Stays nullable so a historical import can carry an unknown type as null
-- rather than failing the whole load.
alter table public.contracts
  add constraint contracts_item_type_check
  check (item_type is null or item_type in ('Appliances', 'Furniture'));
