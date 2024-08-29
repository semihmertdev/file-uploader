-- AlterTable
ALTER TABLE "File" ADD COLUMN     "originalFolderId" INTEGER;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_originalFolderId_fkey" FOREIGN KEY ("originalFolderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
