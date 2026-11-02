-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "constraints" JSONB,
ADD COLUMN     "finalPickId" TEXT,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Watch Decision Room',
ADD COLUMN     "shortlistIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "status" SET DEFAULT 'open';

-- AlterTable
ALTER TABLE "Title" ADD COLUMN     "originalName" TEXT,
ALTER COLUMN "releaseYear" DROP NOT NULL;
