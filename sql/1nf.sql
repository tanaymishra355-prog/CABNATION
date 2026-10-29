-- 1NF fix: split the comma-separated luggage list into atomic rows.
-- Run with: mysql -u root -p cabnation < sql/1nf.sql
USE cabnation;

-- One row per (booking, luggage item). demo_numbers supplies 1..50; the join repeats each
-- booking row once per bag it lists, and SUBSTRING_INDEX picks the n-th piece.
-- Rows with no luggage produce a single row with an empty item value.
CREATE OR REPLACE VIEW bookings_1nf AS
SELECT
  u.booking_no,
  u.passenger_name,
  u.passenger_email,
  u.ride_no,
  u.operator_name,
  u.pickup_city,
  u.dropoff_city,
  u.seat_no,
  u.fare,
  u.payment_status,
  n.n AS bag_no,
  TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(u.luggage, ',', n.n), ',', -1)) AS luggage_item
FROM unnormalized_bookings u
JOIN demo_numbers n
  ON n.n <= IF(u.luggage = '', 1, 1 + LENGTH(u.luggage) - LENGTH(REPLACE(u.luggage, ',', '')));

-- Compare: SELECT * FROM bookings_1nf ORDER BY booking_no, bag_no;
