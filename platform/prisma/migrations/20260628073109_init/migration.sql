-- CreateEnum
CREATE TYPE "ProductPhase" AS ENUM ('Idea', 'Discovery', 'Validation', 'Build', 'Beta', 'GA', 'Growth', 'Maintenance', 'Sunset');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('Active', 'Paused', 'Archived');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('Owner', 'Admin', 'Editor', 'Viewer');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('Invited', 'Active', 'Removed');

-- CreateEnum
CREATE TYPE "FeatureStage" AS ENUM ('Ideation', 'Discovery', 'Validation', 'Design', 'Development', 'Testing', 'Released');

-- CreateEnum
CREATE TYPE "FeatureStatus" AS ENUM ('Active', 'Blocked', 'Paused', 'Archived');

-- CreateEnum
CREATE TYPE "FeatureCategory" AS ENUM ('Feature', 'Improvement', 'BugFix', 'Platform', 'Other');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "PrdSource" AS ENUM ('Upload', 'Manual', 'Generated');

-- CreateEnum
CREATE TYPE "PrdStatus" AS ENUM ('Draft', 'Submitted', 'Reviewed', 'Superseded');

-- CreateEnum
CREATE TYPE "ReviewTrigger" AS ENUM ('Manual', 'PRDUpload', 'Scheduled', 'EvidenceUpdate', 'CompetitorUpdate');

-- CreateEnum
CREATE TYPE "ReviewRecommendation" AS ENUM ('Build', 'BuildWithChanges', 'ValidateFirst', 'DoNotBuild');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('Pending', 'Running', 'Completed', 'Failed');

-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('Risk', 'Opportunity', 'Insight', 'Recommendation', 'Question', 'Assumption');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('Low', 'Medium', 'High', 'Critical');

-- CreateEnum
CREATE TYPE "EvidenceVerdict" AS ENUM ('Supported', 'Mixed', 'Weak', 'Contradicted', 'NoEvidence');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('Draft', 'Proposed', 'Approved', 'Rejected', 'Superseded');

-- CreateEnum
CREATE TYPE "DecisionEvidenceSourceType" AS ENUM ('ReviewRun', 'Finding', 'CustomerEvidence', 'CompetitorSnapshot', 'File', 'PRD');

-- CreateEnum
CREATE TYPE "ThreatLevel" AS ENUM ('Low', 'Medium', 'High');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('CustomerVoice', 'Competitor', 'Research', 'Compliance', 'SolutionCritic', 'PrdQuality', 'Synthesis');

-- CreateEnum
CREATE TYPE "TimelineEntityType" AS ENUM ('Product', 'Feature', 'PRD', 'ReviewRun', 'Decision', 'File');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "vision" TEXT,
    "problem_statement" TEXT,
    "target_persona" TEXT,
    "owner_id" UUID NOT NULL,
    "phase" "ProductPhase" NOT NULL DEFAULT 'Idea',
    "status" "ProductStatus" NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "products_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "product_members" (
    "member_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'Viewer',
    "permissions" JSONB,
    "status" "MemberStatus" NOT NULL DEFAULT 'Active',
    "invited_by" UUID,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_members_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "features" (
    "feature_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "problem_statement" TEXT,
    "proposed_solution" TEXT,
    "owner_id" UUID,
    "priority" "Priority" NOT NULL DEFAULT 'P2',
    "stage" "FeatureStage" NOT NULL DEFAULT 'Ideation',
    "status" "FeatureStatus" NOT NULL DEFAULT 'Active',
    "category" "FeatureCategory" NOT NULL DEFAULT 'Feature',
    "success_metric" TEXT,
    "target_release" TEXT,
    "current_prd_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("feature_id")
);

-- CreateTable
CREATE TABLE "prds" (
    "prd_id" UUID NOT NULL,
    "feature_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "author_id" UUID,
    "source" "PrdSource" NOT NULL DEFAULT 'Upload',
    "document_file_id" UUID,
    "status" "PrdStatus" NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prds_pkey" PRIMARY KEY ("prd_id")
);

-- CreateTable
CREATE TABLE "review_runs" (
    "review_run_id" UUID NOT NULL,
    "feature_id" UUID,
    "product_id" UUID NOT NULL,
    "prd_id" UUID,
    "trigger" "ReviewTrigger" NOT NULL DEFAULT 'Manual',
    "review_version" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'Pending',
    "overall_score" DECIMAL(5,2),
    "recommendation" "ReviewRecommendation",
    "confidence" DECIMAL(5,4),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "review_runs_pkey" PRIMARY KEY ("review_run_id")
);

-- CreateTable
CREATE TABLE "pm_reviews" (
    "pm_review_id" UUID NOT NULL,
    "review_run_id" UUID NOT NULL,
    "summary" TEXT,
    "risks" JSONB,
    "missing_requirements" JSONB,
    "open_questions" JSONB,
    "rollout_risks" JSONB,
    "suggested_experiments" JSONB,

    CONSTRAINT "pm_reviews_pkey" PRIMARY KEY ("pm_review_id")
);

-- CreateTable
CREATE TABLE "customer_evidence" (
    "evidence_id" UUID NOT NULL,
    "review_run_id" UUID NOT NULL,
    "claim" TEXT NOT NULL,
    "verdict" "EvidenceVerdict" NOT NULL,
    "confidence" DECIMAL(5,4),
    "supporting_count" INTEGER NOT NULL DEFAULT 0,
    "contradicting_count" INTEGER NOT NULL DEFAULT 0,
    "sources" JSONB,
    "supporting_quotes" JSONB,
    "contradicting_quotes" JSONB,

    CONSTRAINT "customer_evidence_pkey" PRIMARY KEY ("evidence_id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "competitor_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "category" TEXT,
    "positioning" TEXT,
    "confidence" DECIMAL(5,4),
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("competitor_id")
);

-- CreateTable
CREATE TABLE "competitor_snapshots" (
    "snapshot_id" UUID NOT NULL,
    "review_run_id" UUID NOT NULL,
    "competitor_id" UUID NOT NULL,
    "capabilities" JSONB,
    "strengths" JSONB,
    "weaknesses" JSONB,
    "differentiation_score" DECIMAL(5,2),
    "threat_level" "ThreatLevel",

    CONSTRAINT "competitor_snapshots_pkey" PRIMARY KEY ("snapshot_id")
);

-- CreateTable
CREATE TABLE "findings" (
    "finding_id" UUID NOT NULL,
    "review_run_id" UUID NOT NULL,
    "agent" "AgentType" NOT NULL,
    "type" "FindingType" NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "evidence" JSONB,
    "confidence" DECIMAL(5,4),

    CONSTRAINT "findings_pkey" PRIMARY KEY ("finding_id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "decision_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "feature_id" UUID,
    "review_run_id" UUID,
    "title" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT,
    "confidence" DECIMAL(5,4),
    "status" "DecisionStatus" NOT NULL DEFAULT 'Proposed',
    "owner_id" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("decision_id")
);

-- CreateTable
CREATE TABLE "decision_evidence" (
    "evidence_id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "source_type" "DecisionEvidenceSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "weight" DECIMAL(5,4),
    "summary" TEXT,

    CONSTRAINT "decision_evidence_pkey" PRIMARY KEY ("evidence_id")
);

-- CreateTable
CREATE TABLE "files" (
    "file_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "feature_id" UUID,
    "review_run_id" UUID,
    "uploaded_by" UUID,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("file_id")
);

-- CreateTable
CREATE TABLE "timeline" (
    "event_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "entity_type" "TimelineEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "product_members_product_id_user_id_key" ON "product_members"("product_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "features_current_prd_id_key" ON "features"("current_prd_id");

-- CreateIndex
CREATE UNIQUE INDEX "pm_reviews_review_run_id_key" ON "pm_reviews"("review_run_id");

-- CreateIndex
CREATE INDEX "timeline_product_id_created_at_idx" ON "timeline"("product_id", "created_at");

-- AddForeignKey
ALTER TABLE "product_members" ADD CONSTRAINT "product_members_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "features" ADD CONSTRAINT "features_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "features" ADD CONSTRAINT "features_current_prd_id_fkey" FOREIGN KEY ("current_prd_id") REFERENCES "prds"("prd_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prds" ADD CONSTRAINT "prds_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("feature_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prds" ADD CONSTRAINT "prds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prds" ADD CONSTRAINT "prds_document_file_id_fkey" FOREIGN KEY ("document_file_id") REFERENCES "files"("file_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("feature_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_prd_id_fkey" FOREIGN KEY ("prd_id") REFERENCES "prds"("prd_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_reviews" ADD CONSTRAINT "pm_reviews_review_run_id_fkey" FOREIGN KEY ("review_run_id") REFERENCES "review_runs"("review_run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_evidence" ADD CONSTRAINT "customer_evidence_review_run_id_fkey" FOREIGN KEY ("review_run_id") REFERENCES "review_runs"("review_run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_review_run_id_fkey" FOREIGN KEY ("review_run_id") REFERENCES "review_runs"("review_run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("competitor_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_review_run_id_fkey" FOREIGN KEY ("review_run_id") REFERENCES "review_runs"("review_run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("feature_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_review_run_id_fkey" FOREIGN KEY ("review_run_id") REFERENCES "review_runs"("review_run_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_evidence" ADD CONSTRAINT "decision_evidence_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("decision_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline" ADD CONSTRAINT "timeline_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("product_id") ON DELETE CASCADE ON UPDATE CASCADE;
