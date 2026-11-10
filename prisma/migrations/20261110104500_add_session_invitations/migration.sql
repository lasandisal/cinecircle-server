CREATE TABLE "SessionInvitation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SessionInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionInvitation_sessionId_inviteeId_key"
ON "SessionInvitation"("sessionId", "inviteeId");

CREATE INDEX "SessionInvitation_inviteeId_status_idx"
ON "SessionInvitation"("inviteeId", "status");

ALTER TABLE "SessionInvitation"
ADD CONSTRAINT "SessionInvitation_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionInvitation"
ADD CONSTRAINT "SessionInvitation_inviterId_fkey"
FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionInvitation"
ADD CONSTRAINT "SessionInvitation_inviteeId_fkey"
FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
