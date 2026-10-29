-- CABNATION demo data. Safe to re-run: clears and rebuilds the sample dataset.
-- Run with: mysql -u root -p < seed.sql
USE cabnation;

-- Delete child rows first: InnoDB will not TRUNCATE referenced tables.
DELETE FROM luggage;
DELETE FROM payments;
DELETE FROM bookings;
DELETE FROM passengers;
DELETE FROM seats;
DELETE FROM rides;
DELETE FROM cabs;
DELETE FROM stands;
DELETE FROM unnormalized_bookings;
DELETE FROM demo_numbers;
DELETE FROM audit_log;

ALTER TABLE stands AUTO_INCREMENT = 1;
ALTER TABLE cabs AUTO_INCREMENT = 1;
ALTER TABLE rides AUTO_INCREMENT = 1;
ALTER TABLE seats AUTO_INCREMENT = 1;
ALTER TABLE passengers AUTO_INCREMENT = 1;
ALTER TABLE bookings AUTO_INCREMENT = 1;
ALTER TABLE payments AUTO_INCREMENT = 1;
ALTER TABLE luggage AUTO_INCREMENT = 1;
ALTER TABLE unnormalized_bookings AUTO_INCREMENT = 1;
ALTER TABLE audit_log AUTO_INCREMENT = 1;

INSERT INTO stands (code, stand_name, city) VALUES
  ('BOM', 'Borivali East', 'Mumbai'),
  ('PUN', 'Swargate Cab Stand', 'Pune'),
  ('DEL', 'Kashmere Gate ISBT', 'Delhi'),
  ('JAI', 'Sindhi Camp Cab Stand', 'Jaipur'),
  ('BLR', 'Majestic Cab Station', 'Bengaluru'),
  ('CHE', 'Koyambedu Cab Terminus', 'Chennai');

INSERT INTO cabs (cab_code, operator_name, cab_name, cab_type) VALUES
  ('SFR-204', 'Saffron Cabs', 'Innova Crysta', 'AC 6+1 MUV'),
  ('DST-318', 'Desert Cabs', 'Swift Dzire', 'AC 4+1 Sedan'),
  ('CST-441', 'Coastline Cabs', 'Ertiga', 'AC 6+1 MUV');

INSERT INTO rides (ride_no, cab_id, pickup_id, dropoff_id, pickup_at, dropoff_at) VALUES
  ('CB204', 1, 1, 2, '2026-11-02 22:15:00', '2026-11-03 05:45:00'),
  ('CB318', 2, 3, 4, '2026-11-03 07:30:00', '2026-11-03 12:40:00'),
  ('CB441', 3, 5, 6, '2026-11-03 21:45:00', '2026-11-04 04:15:00');

-- 24 numbered seats per ride, in a 2 + aisle + 2 layout. Rows 1-2 are premium.
INSERT INTO seats (ride_id, seat_no, class, fare) VALUES
  (1,'1A','FRONT_ROW',949.00),(1,'1B','FRONT_ROW',949.00),(1,'1C','FRONT_ROW',949.00),(1,'1D','FRONT_ROW',949.00),
  (1,'2A','FRONT_ROW',949.00),(1,'2B','FRONT_ROW',949.00),(1,'2C','FRONT_ROW',949.00),(1,'2D','FRONT_ROW',949.00),
  (1,'3A','STANDARD',799.00),(1,'3B','STANDARD',799.00),(1,'3C','STANDARD',799.00),(1,'3D','STANDARD',799.00),
  (1,'4A','STANDARD',799.00),(1,'4B','STANDARD',799.00),(1,'4C','STANDARD',799.00),(1,'4D','STANDARD',799.00),
  (1,'5A','STANDARD',799.00),(1,'5B','STANDARD',799.00),(1,'5C','STANDARD',799.00),(1,'5D','STANDARD',799.00),
  (1,'6A','STANDARD',799.00),(1,'6B','STANDARD',799.00),(1,'6C','STANDARD',799.00),(1,'6D','STANDARD',799.00),
  (2,'1A','FRONT_ROW',549.00),(2,'1B','FRONT_ROW',549.00),(2,'1C','FRONT_ROW',549.00),(2,'1D','FRONT_ROW',549.00),
  (2,'2A','FRONT_ROW',549.00),(2,'2B','FRONT_ROW',549.00),(2,'2C','FRONT_ROW',549.00),(2,'2D','FRONT_ROW',549.00),
  (2,'3A','STANDARD',449.00),(2,'3B','STANDARD',449.00),(2,'3C','STANDARD',449.00),(2,'3D','STANDARD',449.00),
  (2,'4A','STANDARD',449.00),(2,'4B','STANDARD',449.00),(2,'4C','STANDARD',449.00),(2,'4D','STANDARD',449.00),
  (2,'5A','STANDARD',449.00),(2,'5B','STANDARD',449.00),(2,'5C','STANDARD',449.00),(2,'5D','STANDARD',449.00),
  (2,'6A','STANDARD',449.00),(2,'6B','STANDARD',449.00),(2,'6C','STANDARD',449.00),(2,'6D','STANDARD',449.00),
  (3,'1A','FRONT_ROW',799.00),(3,'1B','FRONT_ROW',799.00),(3,'1C','FRONT_ROW',799.00),(3,'1D','FRONT_ROW',799.00),
  (3,'2A','FRONT_ROW',799.00),(3,'2B','FRONT_ROW',799.00),(3,'2C','FRONT_ROW',799.00),(3,'2D','FRONT_ROW',799.00),
  (3,'3A','STANDARD',649.00),(3,'3B','STANDARD',649.00),(3,'3C','STANDARD',649.00),(3,'3D','STANDARD',649.00),
  (3,'4A','STANDARD',649.00),(3,'4B','STANDARD',649.00),(3,'4C','STANDARD',649.00),(3,'4D','STANDARD',649.00),
  (3,'5A','STANDARD',649.00),(3,'5B','STANDARD',649.00),(3,'5C','STANDARD',649.00),(3,'5D','STANDARD',649.00),
  (3,'6A','STANDARD',649.00),(3,'6B','STANDARD',649.00),(3,'6C','STANDARD',649.00),(3,'6D','STANDARD',649.00);

INSERT INTO passengers (name, email, phone) VALUES
  ('Asha Verma', 'asha@mail.com', '9810012345'),
  ('Rahul Iyer', 'rahul@mail.com', '9810023456'),
  ('Meera Nair', 'meera@mail.com', '9810034567'),
  ('Dev Patel', 'dev@mail.com', '9810045678'),
  ('Sara Khan', 'sara@mail.com', '9810056789'),
  ('John Dsouza', 'john@mail.com', '9810067890');

INSERT INTO bookings (ride_id, seat_id, passenger_id, status)
VALUES (1, (SELECT seat_id FROM seats WHERE ride_id = 1 AND seat_no = '2A'),
           (SELECT passenger_id FROM passengers WHERE email = 'asha@mail.com'), 'CONFIRMED');
INSERT INTO payments (booking_id, amount, status)
SELECT bk.booking_id, s.fare, 'PAID'
FROM bookings bk JOIN seats s ON s.seat_id = bk.seat_id
WHERE bk.ride_id = 1 AND s.seat_no = '2A'
ORDER BY bk.booking_id DESC LIMIT 1;
INSERT INTO luggage (booking_id, kg, fee)
VALUES ((SELECT booking_id FROM bookings WHERE ride_id = 1 AND seat_id = (SELECT seat_id FROM seats WHERE ride_id = 1 AND seat_no = '2A')), 15, 750.00);

INSERT INTO bookings (ride_id, seat_id, passenger_id, status)
VALUES (1, (SELECT seat_id FROM seats WHERE ride_id = 1 AND seat_no = '3C'),
           (SELECT passenger_id FROM passengers WHERE email = 'rahul@mail.com'), 'CONFIRMED');
INSERT INTO payments (booking_id, amount, status)
SELECT bk.booking_id, s.fare, 'PAID'
FROM bookings bk JOIN seats s ON s.seat_id = bk.seat_id
WHERE bk.ride_id = 1 AND s.seat_no = '3C'
ORDER BY bk.booking_id DESC LIMIT 1;

INSERT INTO bookings (ride_id, seat_id, passenger_id, status)
VALUES (2, (SELECT seat_id FROM seats WHERE ride_id = 2 AND seat_no = '1A'),
           (SELECT passenger_id FROM passengers WHERE email = 'dev@mail.com'), 'CONFIRMED');
INSERT INTO payments (booking_id, amount, status)
SELECT bk.booking_id, s.fare, 'PAID'
FROM bookings bk JOIN seats s ON s.seat_id = bk.seat_id
WHERE bk.ride_id = 2 AND s.seat_no = '1A'
ORDER BY bk.booking_id DESC LIMIT 1;
INSERT INTO luggage (booking_id, kg, fee)
VALUES ((SELECT booking_id FROM bookings WHERE ride_id = 2 AND seat_id = (SELECT seat_id FROM seats WHERE ride_id = 2 AND seat_no = '1A')), 12, 600.00);

INSERT INTO bookings (ride_id, seat_id, passenger_id, status)
VALUES (3, (SELECT seat_id FROM seats WHERE ride_id = 3 AND seat_no = '5B'),
           (SELECT passenger_id FROM passengers WHERE email = 'meera@mail.com'), 'CONFIRMED');
INSERT INTO payments (booking_id, amount, status)
SELECT bk.booking_id, s.fare, 'PAID'
FROM bookings bk JOIN seats s ON s.seat_id = bk.seat_id
WHERE bk.ride_id = 3 AND s.seat_no = '5B'
ORDER BY bk.booking_id DESC LIMIT 1;

INSERT INTO unnormalized_bookings
  (booking_no, passenger_name, passenger_email, ride_no, operator_name, pickup_city, dropoff_city, seat_no, fare, payment_status, luggage) VALUES
  ('CT-1001','Asha Verma','asha@mail.com','CB204','Saffron Cabs','Mumbai','Pune','2A',949.00,'PAID','15kg,7kg'),
  ('CT-1002','Asha Verma','asha@mail.com','CB204','Saffron Cabs','Mumbai','Pune','2B',949.00,'PAID',''),
  ('CT-1003','Asha Verma','asha@mail.com','CB204','Saffron Cabs','Mumbai','Pune','3A',799.00,'REFUNDED','20kg'),
  ('CT-1004','Rahul Iyer','rahul@mail.com','CB204','Saffron Cabs','Mumbai','Pune','1C',949.00,'PAID','10kg'),
  ('CT-1005','Meera Nair','meera@mail.com','CB204','Saffron Cabs','Mumbai','Pune','4D',799.00,'FAILED',''),
  ('CT-1006','Dev Patel','dev@mail.com','CB318','Desert Cabs','Delhi','Jaipur','1A',549.00,'PAID','12kg,5kg'),
  ('CT-1007','Sara Khan','sara@mail.com','CB318','Desert Cabs','Delhi','Jaipur','2C',549.00,'PAID',''),
  ('CT-1008','John Dsouza','john@mail.com','CB318','Desert Cabs','Delhi','Jaipur','3B',449.00,'PAID','18kg'),
  ('CT-1009','Priya Bose','priya@mail.com','CB318','Desert Cabs','Delhi','Jaipur','4A',449.00,'REFUNDED',''),
  ('CT-1010','Rahul Iyer','rahul@mail.com','CB318','Desert Cabs','Delhi','Jaipur','5B',449.00,'PAID','');

INSERT INTO demo_numbers (n) VALUES
  (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),
  (11),(12),(13),(14),(15),(16),(17),(18),(19),(20),
  (21),(22),(23),(24),(25),(26),(27),(28),(29),(30),
  (31),(32),(33),(34),(35),(36),(37),(38),(39),(40),
  (41),(42),(43),(44),(45),(46),(47),(48),(49),(50);
-- Seeding fires audit triggers; leave the log empty for the live demo.
TRUNCATE TABLE audit_log;
