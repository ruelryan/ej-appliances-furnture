-- 2025 Philippine holidays (Proclamation No. 727 s. 2024, plus the
-- separately proclaimed Eid dates). Added because Analyn's imported DTR
-- history starts October 2025 — without these, late-2025 holiday pay
-- (e.g. worked Rizal Day 2025-12-30) would compute as ordinary days.
-- Note: EDSA Feb 25 was NOT a holiday in 2025.

insert into public.holidays (holiday_date, name, type) values
  -- Regular
  ('2025-01-01', 'New Year''s Day',       'regular'),
  ('2025-04-01', 'Eid''l Fitr',           'regular'),
  ('2025-04-09', 'Araw ng Kagitingan',    'regular'),
  ('2025-04-17', 'Maundy Thursday',       'regular'),
  ('2025-04-18', 'Good Friday',           'regular'),
  ('2025-05-01', 'Labor Day',             'regular'),
  ('2025-06-06', 'Eid''l Adha',           'regular'),
  ('2025-06-12', 'Independence Day',      'regular'),
  ('2025-08-25', 'National Heroes Day',   'regular'),
  ('2025-11-30', 'Bonifacio Day',         'regular'),
  ('2025-12-25', 'Christmas Day',         'regular'),
  ('2025-12-30', 'Rizal Day',             'regular'),
  -- Special (non-working)
  ('2025-01-29', 'Chinese New Year',      'special'),
  ('2025-04-19', 'Black Saturday',        'special'),
  ('2025-08-21', 'Ninoy Aquino Day',      'special'),
  ('2025-10-31', 'All Saints'' Day Eve',  'special'),
  ('2025-11-01', 'All Saints'' Day',      'special'),
  ('2025-12-08', 'Feast of the Immaculate Conception', 'special'),
  ('2025-12-24', 'Christmas Eve',         'special'),
  ('2025-12-31', 'Last Day of the Year',  'special')
on conflict (holiday_date) do nothing;
