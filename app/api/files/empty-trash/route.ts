import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import ImageKit from "imagekit";

// Initialize ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT || "",
});

export async function DELETE() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all trashed files for this user
    const trashedFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.isTrash, true)));

    if (trashedFiles.length === 0) {
      return NextResponse.json(
        { message: "No files in trash" },
        { status: 200 }
      );
    }

    // Delete each file from ImageKit if it's not a folder
    const deletePromises = trashedFiles
      .filter((file) => !file.isFolder)
      .map(async (file) => {
        try {
          let imagekitFileName: string | null = null;

          if (file.fileUrl) {
            const urlWithoutQuery = file.fileUrl.split("?")[0];
            imagekitFileName = urlWithoutQuery.split("/").pop() ?? null;
          }

          if (!imagekitFileName && file.path) {
            imagekitFileName = file.path.split("/").pop() ?? null;
          }

          if (imagekitFileName) {
            const searchResults = await imagekit.listFiles({
              name: imagekitFileName,
              limit: 1,
            });

            const result = searchResults[0];

            if (result && result.type === "file") {
              await imagekit.deleteFile(result.fileId);
            } else {
              console.warn("ImageKit: Not a file or not found, skipping.");
            }
          }
        } catch (error) {
          console.error(`ImageKit delete error for file ${file.id}:`, error);
        }
      });

    // Wait for all deletions
    await Promise.allSettled(deletePromises);

    // Delete trashed files from DB
    const deletedFiles = await db
      .delete(files)
      .where(and(eq(files.userId, userId), eq(files.isTrash, true)))
      .returning();

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${deletedFiles.length} files from trash`,
    });
  } catch (error) {
    console.error("Error emptying trash:", error);
    return NextResponse.json(
      { error: "Failed to empty trash" },
      { status: 500 }
    );
  }
}
