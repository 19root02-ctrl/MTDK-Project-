-- IMTSE Database Schema
-- Use this file to create the database and student registration table for the IMTSE portal.

CREATE DATABASE IF NOT EXISTS `imtse_portal`;
USE `imtse_portal`;

CREATE TABLE IF NOT EXISTS `students` (
  `reg_no` VARCHAR(50) NOT NULL,
  `full_name` VARCHAR(255) NOT NULL,
  `student_class` VARCHAR(20) NOT NULL,
  `medium` VARCHAR(50) NOT NULL,
  `school_name` VARCHAR(255) NOT NULL,
  `dob` DATE NOT NULL,
  `parent_name` VARCHAR(255) NOT NULL,
  `whatsapp` VARCHAR(20) NOT NULL,
  `address` TEXT NOT NULL,
  `amount` VARCHAR(50) NOT NULL,
  `pay_mode` VARCHAR(100) NOT NULL,
  `status` VARCHAR(100) NOT NULL,
  `reg_date` DATE NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`whatsapp`),
  UNIQUE KEY `uniq_reg_no` (`reg_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin access credentials for the portal control panel
-- Username: admin
-- Password: admin

CREATE TABLE IF NOT EXISTS `admin_users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `study_resources` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `category` VARCHAR(50) NOT NULL,
  `resource_type` VARCHAR(20) NOT NULL,
  `url` VARCHAR(1000) NULL,
  `description` TEXT NULL,
  `file_name` VARCHAR(255) NULL,
  `file_data` LONGTEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Resource form behavior:
-- YouTube -> show URL field and require it
-- PDF, DOC, Other -> show Upload File field and require it

INSERT INTO `admin_users` (`username`, `password`) VALUES ('admin', 'admin') ON DUPLICATE KEY UPDATE `password` = VALUES(`password`);

-- Example insert for initial test data
INSERT INTO `students` (
  `full_name`,
  `student_class`,
  `medium`,
  `school_name`,
  `dob`,
  `parent_name`,
  `whatsapp`,
  `address`,
  `amount`,
  `pay_mode`,
  `reg_no`,
  `status`,
  `reg_date`
) VALUES (
  'RAHUL RAMESH SHINDE',
  'VII',
  'English',
  'MATOSHREE ENGLISH SCHOOL, MIRAJ',
  '2014-08-15',
  'RAMESH SHINDE',
  '9876543210',
  'Plot No 4, Shivaji Nagar, Taluka Miraj, District Sangli - 416410',
  '₹550.00',
  'UPI (Verified)',
  'IMTSE-10984',
  'Approved & Active (Fees Paid)',
  '2026-07-15'
);
