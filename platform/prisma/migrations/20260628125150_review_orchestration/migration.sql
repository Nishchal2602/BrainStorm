-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgentType" ADD VALUE 'SharedAnalysis';
ALTER TYPE "AgentType" ADD VALUE 'PMReview';

-- AlterTable
ALTER TABLE "review_runs" ADD COLUMN     "agent_status" JSONB,
ADD COLUMN     "shared_analysis" JSONB;
