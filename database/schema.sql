-- ==============================================================================
-- Semantic Flood Inventory - MySQL Relational Database Schema
-- Database: semantic_flood_db
-- Description: Staging, Ingestion, CMS, and Validation Database for Admin Microservice
-- Character Set: utf8mb4 / utf8mb4_unicode_ci
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS `semantic_flood_db` 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `semantic_flood_db`;

-- -----------------------------------------------------------------------------
-- Table 1: users
-- Purpose: Authentication and authorization for system administrators & operators
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `email` VARCHAR(100) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('SUPERADMIN', 'ADMIN', 'OPERATOR', 'VIEWER') NOT NULL DEFAULT 'OPERATOR',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_users_role` (`role`),
    INDEX `idx_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 2: articles
-- Purpose: Raw, staged, and published natural disaster news articles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `articles` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `article_external_id` INT NULL UNIQUE,
    `title` VARCHAR(500) NOT NULL,
    `title_th` VARCHAR(500) NULL,
    `title_en` VARCHAR(500) NULL,
    `url` VARCHAR(1000) NULL,
    `source` VARCHAR(100) NULL,
    `publish_date` VARCHAR(50) NULL,
    `content_raw` LONGTEXT NULL,
    `content_th` LONGTEXT NULL,
    `content_en` LONGTEXT NULL,
    `content_summary_en` TEXT NULL,
    `status` ENUM('SCRAPED', 'PROCESSING', 'VALIDATED', 'PUBLISHED_TO_KG', 'REJECTED', 'INCOMPLETE_ENTITIES') NOT NULL DEFAULT 'SCRAPED',
    `is_foreign` BOOLEAN NOT NULL DEFAULT FALSE,
    `track_stats` JSON NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_articles_status` (`status`),
    INDEX `idx_articles_date` (`publish_date`),
    INDEX `idx_articles_ext_id` (`article_external_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 3: article_locations
-- Purpose: Extracted geographical locations, coordinates, and semantic roles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `article_locations` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `article_id` INT NOT NULL,
    `node_id` VARCHAR(100) NOT NULL,
    `text_th` VARCHAR(255) NULL,
    `text_en` VARCHAR(255) NULL,
    `admin_level` INT NULL COMMENT '1: Province, 2: District, 3: Subdistrict, 4: Village, 5: Hydrological Body, 6: POI / General',
    `category` VARCHAR(100) NULL,
    `lat` DECIMAL(10, 7) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `formatted_address` VARCHAR(500) NULL,
    `geocode_level` VARCHAR(50) NULL,
    `geocode_source` VARCHAR(50) NULL,
    `geocode_confidence` DECIMAL(5, 4) NULL,
    `semantic_role` ENUM('FLOOD', 'EVACUATION', 'GENERAL') NOT NULL DEFAULT 'FLOOD',
    `parent_path` JSON NULL,
    `validation_status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'MODIFIED') NOT NULL DEFAULT 'PENDING',
    `rejection_reason` VARCHAR(255) NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_locations_article` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE,
    INDEX `idx_locations_role` (`semantic_role`),
    INDEX `idx_locations_admin_level` (`admin_level`),
    INDEX `idx_locations_status` (`validation_status`),
    INDEX `idx_locations_node_id` (`node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 4: article_impacts
-- Purpose: Quantitative disaster impact metrics (casualties, evacuees, damages)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `article_impacts` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `article_id` INT NOT NULL,
    `impact_type` ENUM('HumanImpact', 'StructuralImpact', 'HydrologicalMetric', 'GeneralImpact') NOT NULL,
    `raw_expression` VARCHAR(255) NOT NULL,
    `quantity_value` DECIMAL(15, 2) NULL,
    `unit` VARCHAR(50) NULL,
    `validation_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_impacts_article` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE,
    INDEX `idx_impacts_type` (`impact_type`),
    INDEX `idx_impacts_status` (`validation_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 5: article_times
-- Purpose: Temporal mentions extracted from news articles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `article_times` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `article_id` INT NOT NULL,
    `time_expression` VARCHAR(255) NOT NULL,
    `calendar_system` VARCHAR(50) NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_times_article` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Table 6: sync_logs
-- Purpose: Audit logging for Knowledge Graph publishing, bulk imports, and updates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sync_logs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `article_id` INT NULL,
    `action` ENUM('BULK_IMPORT', 'PUBLISH_ARTICLE', 'ROLLBACK', 'REBUILD_GRAPH') NOT NULL,
    `triples_count` INT NOT NULL DEFAULT 0,
    `status` ENUM('SUCCESS', 'FAILED') NOT NULL,
    `message` TEXT NULL,
    `performed_by` INT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_sync_article` FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_sync_user` FOREIGN KEY (`performed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
    INDEX `idx_sync_action` (`action`),
    INDEX `idx_sync_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
