-- 3NF step: passenger identity and ride/route facts live in their own tables.
-- Run with: mysql -u root -p cabnation < sql/3nf.sql
USE cabnation;

-- One row per passenger: email lives with the person, not with every booking.
CREATE OR REPLACE VIEW passengers_3nf AS
SELECT DISTINCT passenger_name, passenger_email
FROM unnormalized_bookings;

-- One row per ride: the route facts live with the scheduled ride.
CREATE OR REPLACE VIEW rides_3nf AS
SELECT DISTINCT ride_no, operator_name, pickup_city, dropoff_city
FROM unnormalized_bookings;

-- Bookings refer to passengers by their unique email in this flat-table lesson;
-- the real schema uses the stronger passenger_id key and foreign key.
CREATE OR REPLACE VIEW bookings_3nf AS
SELECT booking_no, ride_no, seat_no, payment_status, passenger_email
FROM unnormalized_bookings;

-- Compare:
--   SELECT * FROM passengers_3nf ORDER BY passenger_name;
--   SELECT * FROM rides_3nf ORDER BY ride_no;
--   SELECT * FROM bookings_3nf ORDER BY booking_no;
