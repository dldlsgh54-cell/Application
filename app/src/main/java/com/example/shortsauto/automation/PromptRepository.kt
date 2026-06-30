package com.example.shortsauto.automation

import android.content.Context
import android.graphics.Bitmap
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object PromptRepository {
    fun sanitizeProjectName(value: String): String {
        val sanitized = value.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim()
        return sanitized.ifBlank { "shorts_project" }
    }

    fun rootDir(context: Context): File {
        return File(context.getExternalFilesDir(null), "ShortsAuto").apply { mkdirs() }
    }

    fun projectDir(context: Context, projectName: String): File {
        return File(rootDir(context), sanitizeProjectName(projectName)).apply { mkdirs() }
    }

    fun savePrompts(context: Context, prompts: List<String>, projectName: String) {
        File(projectDir(context, projectName), "prompts.txt").writeText(
            prompts.take(6).joinToString(separator = "\n\n") { it.trim() },
            Charsets.UTF_8
        )
    }

    fun appendLog(context: Context, projectName: String, message: String) {
        val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA).format(Date())
        File(projectDir(context, projectName), "log.txt").appendText("[$timestamp] $message\n", Charsets.UTF_8)
    }

    fun readLog(context: Context, projectName: String): String {
        val file = File(projectDir(context, projectName), "log.txt")
        return if (file.exists()) file.readText(Charsets.UTF_8) else ""
    }

    fun saveImage(context: Context, projectName: String, index: Int, bitmap: Bitmap): File {
        val file = File(projectDir(context, projectName), "%02d.png".format(Locale.US, index + 1))
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return file
    }
}
