-- 2NF step: move repeated ride and operator facts out of ticket rows.
-- Run with: mysql -u root -p cabnation < sql/2nf.sql
USE cabnation;

-- Ride facts now exist once per ride instead of once per ticket.
CREATE OR REPLACE VIEW rides_2nf AS
SELECT DISTINCT ride_no, operator_name, pickup_city, dropoff_city
FROM unnormalized_bookings;

-- Booking rows keep only facts about the booking itself.
CREATE OR REPLACE VIEW bookings_2nf AS
SELECT booking_no, passenger_name, passenger_email, ride_no, seat_no, fare, payment_status
FROM unnormalized_bookings;

-- Compare:
--   SELECT * FROM rides_2nf ORDER BY ride_no;
--   SELECT * FROM bookings_2nf ORDER BY booking_no;
