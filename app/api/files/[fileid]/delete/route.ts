import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import ImageKit from "imagekit";

// ✅ Initialize ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT || "",
});

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ fileId: string }> }
) {
  try {
    // 🔐 Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileId } = await props.params;
    if (!fileId) {
      return NextResponse.json(
        { error: "File ID is required" },
        { status: 400 }
      );
    }

    // 📄 Fetch the file from DB
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // 🧼 If it's a file (not folder), delete from ImageKit
    if (!file.isFolder) {
      try {
        let imagekitFileName: string | null = null;

        // Try extracting filename from fileUrl
        if (file.fileUrl) {
          const urlWithoutQuery = file.fileUrl.split("?")[0];
          imagekitFileName = urlWithoutQuery.split("/").pop() ?? null;
        }

        // Fallback: extract from path
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
            console.warn("ImageKit: File not found or not a file. Skipping delete.");
          }
        }
      } catch (error) {
        console.error(`ImageKit deletion error for fileId: ${fileId}`, error);
      }
    }

    // 🗑️ Delete file from database
    const [deletedFile] = await db
      .delete(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)))
      .returning();

    return NextResponse.json({
      success: true,
      message: "File deleted successfully",
      deletedFile,
    });
  } catch (error) {
    console.error("Unexpected error deleting file:", error);
    return NextResponse.json(
      { error: "Failed to delete file" },
      { status: 500 }
    );
  }
}
