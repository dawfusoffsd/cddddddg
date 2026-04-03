-- ============================================================
-- Migration: Add Soft Delete Functionality
-- Date: 2026-04-03
-- Description: Adds deleted_at column to support soft deletes
-- ============================================================

BEGIN;

-- Add deleted_at column to inventory_items
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add deleted_at column to employees
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add deleted_at column to assignments
ALTER TABLE assignments 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add deleted_at column to temp_custody
ALTER TABLE temp_custody 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add deleted_at column to branches
ALTER TABLE branches 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add deleted_at column to teams
ALTER TABLE teams 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add deleted_at column to categories
ALTER TABLE categories 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add deleted_at column to sim_cards
ALTER TABLE sim_cards 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Create indexes on deleted_at columns for performance
CREATE INDEX IF NOT EXISTS idx_inventory_items_deleted_at ON inventory_items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_employees_deleted_at ON employees(deleted_at);
CREATE INDEX IF NOT EXISTS idx_assignments_deleted_at ON assignments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_temp_custody_deleted_at ON temp_custody(deleted_at);
CREATE INDEX IF NOT EXISTS idx_branches_deleted_at ON branches(deleted_at);
CREATE INDEX IF NOT EXISTS idx_teams_deleted_at ON teams(deleted_at);
CREATE INDEX IF NOT EXISTS idx_categories_deleted_at ON categories(deleted_at);
CREATE INDEX IF NOT EXISTS idx_sim_cards_deleted_at ON sim_cards(deleted_at);

-- Create helper function to check if record is deleted
CREATE OR REPLACE FUNCTION is_deleted(deleted_at TIMESTAMP WITH TIME ZONE)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN deleted_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;