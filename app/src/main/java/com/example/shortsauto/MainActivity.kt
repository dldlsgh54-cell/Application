package com.example.shortsauto

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.example.shortsauto.accessibility.ChatGptAccessibilityService
import com.example.shortsauto.automation.ChatGptAutomationService
import com.example.shortsauto.automation.ClipboardPromptParser
import com.example.shortsauto.automation.PromptRepository

class MainActivity : ComponentActivity() {
    private val prompts = mutableStateListOf("", "", "", "", "", "")
    private var projectName by mutableStateOf("shorts_project")
    private var logText by mutableStateOf("")
    private var progressText by mutableStateOf("ChatGPT에서 이미지 프롬프트를 복사하면 자동으로 감지합니다.")
    private var progressValue by mutableFloatStateOf(0f)
    private var isRunning by mutableStateOf(false)
    private var showCompletionDialog by mutableStateOf(false)
    private var completionMessage by mutableStateOf("")
    private var lastClipboardText = ""
    private var clipboardManager: ClipboardManager? = null
    private val clipboardListener = ClipboardManager.OnPrimaryClipChangedListener {
        detectClipboardPrompts(showToast = true, force = false)
    }

    private val progressReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ChatGptAutomationService.BROADCAST_PROGRESS) return
            progressText = intent.getStringExtra(ChatGptAutomationService.EXTRA_STATUS).orEmpty()
            progressValue = intent.getFloatExtra(ChatGptAutomationService.EXTRA_PROGRESS, progressValue)
            logText = PromptRepository.readLog(this@MainActivity, projectName)
            isRunning = intent.getBooleanExtra(ChatGptAutomationService.EXTRA_RUNNING, isRunning)
            if (intent.getBooleanExtra(ChatGptAutomationService.EXTRA_COMPLETE, false)) {
                completionMessage = progressText.ifBlank { "이미지 생성이 완료되었습니다." }
                showCompletionDialog = true
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        clipboardManager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboardManager?.addPrimaryClipChangedListener(clipboardListener)
        setContent {
            ShortsAutoTheme {
                DisposableEffect(Unit) {
                    val filter = android.content.IntentFilter(ChatGptAutomationService.BROADCAST_PROGRESS)
                    ContextCompat.registerReceiver(
                        this@MainActivity,
                        progressReceiver,
                        filter,
                        ContextCompat.RECEIVER_NOT_EXPORTED
                    )
                    onDispose { unregisterReceiver(progressReceiver) }
                }
                AppUi(
                    projectName = projectName,
                    prompts = prompts,
                    logText = logText,
                    progressText = progressText,
                    progressValue = progressValue,
                    isRunning = isRunning,
                    showCompletionDialog = showCompletionDialog,
                    completionMessage = completionMessage,
                    onProjectNameChange = { projectName = PromptRepository.sanitizeProjectName(it) },
                    onPromptChange = { index, value -> prompts[index] = value },
                    onStart = { startAutomation() },
                    onPause = { sendServiceAction(ChatGptAutomationService.ACTION_PAUSE) },
                    onStop = { sendServiceAction(ChatGptAutomationService.ACTION_STOP) },
                    onOpenFolder = { openOutputFolder() },
                    onParseClipboard = { parseClipboardPrompts() },
                    onReadScreenText = { readScreenTextPrompts() },
                    onOpenAccessibility = { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) },
                    onDismissCompletion = { showCompletionDialog = false }
                )
            }
        }
        handleLaunchIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunchIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        detectClipboardPrompts(showToast = false, force = false)
        fillMissingFromScreen(showToast = false)
    }

    override fun onDestroy() {
        clipboardManager?.removePrimaryClipChangedListener(clipboardListener)
        super.onDestroy()
    }

    private fun handleLaunchIntent(intent: Intent?) {
        if (intent?.getBooleanExtra(ChatGptAutomationService.EXTRA_COMPLETE, false) == true) {
            completionMessage = intent.getStringExtra(ChatGptAutomationService.EXTRA_STATUS)
                ?: "전체 이미지 생성 작업이 완료되었습니다."
            progressText = completionMessage
            progressValue = 1f
            isRunning = false
            showCompletionDialog = true
        }
    }

    private fun startAutomation() {
        detectClipboardPrompts(showToast = false, force = true)
        fillMissingFromScreen(showToast = false)
        val usablePrompts = prompts.map { it.trim() }.filter { it.isNotBlank() }.take(6)
        if (usablePrompts.isEmpty()) {
            Toast.makeText(this, "프롬프트를 1개 이상 입력하세요.", Toast.LENGTH_SHORT).show()
            return
        }
        val safeProjectName = PromptRepository.sanitizeProjectName(projectName.ifBlank { "shorts_project" })
        projectName = safeProjectName
        PromptRepository.savePrompts(this, prompts.toList(), safeProjectName)
        logText = ""
        isRunning = true
        progressText = "자동화 시작"
        progressValue = 0f
        showCompletionDialog = false
        val intent = Intent(this, ChatGptAutomationService::class.java).apply {
            action = ChatGptAutomationService.ACTION_START
            putExtra(ChatGptAutomationService.EXTRA_PROJECT_NAME, safeProjectName)
            putExtra(ChatGptAutomationService.EXTRA_PROMPTS, usablePrompts.toTypedArray())
        }
        ContextCompat.startForegroundService(this, intent)
    }

    private fun sendServiceAction(action: String) {
        ContextCompat.startForegroundService(
            this,
            Intent(this, ChatGptAutomationService::class.java).setAction(action)
        )
    }

    private fun parseClipboardPrompts() {
        if (!detectClipboardPrompts(showToast = true, force = true)) {
            Toast.makeText(this, "클립보드에서 프롬프트를 찾지 못했습니다.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun detectClipboardPrompts(showToast: Boolean, force: Boolean): Boolean {
        val manager = clipboardManager ?: getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val text = manager.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty()
        if (text.isBlank() || (!force && text == lastClipboardText)) return false
        val parsed = ClipboardPromptParser.parse(text)
        if (parsed.isEmpty()) return false
        lastClipboardText = text
        val filled = fillEmptyPromptSlots(parsed)
        if (filled == 0) {
            progressText = "직접 입력된 프롬프트를 유지했습니다. 자동 감지 내용은 덮어쓰지 않았습니다."
            if (showToast) Toast.makeText(this, "직접 입력된 프롬프트를 유지했습니다.", Toast.LENGTH_SHORT).show()
            return true
        }
        progressText = "클립보드 감지 완료: 빈 칸 ${filled}개 자동 입력"
        logText = "ChatGPT 복사 텍스트에서 빈 프롬프트 ${filled}개를 자동 입력했습니다.\n$logText"
        if (showToast) {
            Toast.makeText(this, "빈 프롬프트 ${filled}개 자동 입력 완료", Toast.LENGTH_SHORT).show()
        }
        return true
    }

    private fun readScreenTextPrompts() {
        fillMissingFromScreen(showToast = true)
    }

    private fun fillMissingFromScreen(showToast: Boolean): Boolean {
        if (prompts.none { it.isBlank() }) return true
        if (!ChatGptAccessibilityService.isConnected()) {
            val message = "접근성 서비스가 꺼져 있습니다. 접근성 설정을 켠 뒤, 실패하면 ChatGPT에서 전체 프롬프트를 복사하세요."
            if (showToast) progressText = message
            if (showToast) Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            return false
        }

        val screenText = ChatGptAccessibilityService.readCurrentScreenText()
        val parsed = ClipboardPromptParser.parseScreenText(screenText)
        if (parsed.isEmpty()) {
            val message = "화면 텍스트에서 이미지 프롬프트를 찾지 못했습니다. ChatGPT에서 컷1~컷6 또는 Prompt 1~Prompt 6 전체를 복사하세요."
            if (showToast) progressText = message
            if (showToast) Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            return false
        }

        val filled = fillEmptyPromptSlots(parsed)
        if (filled == 0) {
            progressText = "직접 입력된 프롬프트를 유지했습니다. 화면 텍스트는 덮어쓰지 않았습니다."
            if (showToast) Toast.makeText(this, "직접 입력된 프롬프트를 유지했습니다.", Toast.LENGTH_SHORT).show()
            return false
        }
        progressText = "화면 텍스트 읽기 완료: 빈 칸 ${filled}개 자동 입력"
        logText = "ChatGPT 화면 텍스트에서 빈 프롬프트 ${filled}개를 자동 입력했습니다.\n$logText"
        if (showToast) Toast.makeText(this, "화면에서 빈 프롬프트 ${filled}개 입력 완료", Toast.LENGTH_SHORT).show()
        return true
    }

    private fun fillEmptyPromptSlots(candidates: List<String>): Int {
        var candidateIndex = 0
        var filled = 0
        for (slot in prompts.indices) {
            if (prompts[slot].isNotBlank()) continue
            while (candidateIndex < candidates.size && candidates[candidateIndex].isBlank()) candidateIndex++
            if (candidateIndex >= candidates.size) break
            prompts[slot] = candidates[candidateIndex].trim()
            candidateIndex++
            filled++
        }
        return filled
    }

    private fun openOutputFolder() {
        val dir = PromptRepository.projectDir(this, projectName)
        dir.mkdirs()
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(Uri.parse(dir.toURI().toString()), "resource/folder")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { startActivity(intent) }.onFailure {
            Toast.makeText(this, "파일 앱에서 ${dir.absolutePath} 경로를 여세요.", Toast.LENGTH_LONG).show()
        }
    }

}

@Composable
private fun ShortsAutoTheme(content: @Composable () -> Unit) {
    MaterialTheme {
        Surface(color = MaterialTheme.colorScheme.background, content = content)
    }
}

@Composable
fun AppUi(
    projectName: String,
    prompts: List<String>,
    logText: String,
    progressText: String,
    progressValue: Float,
    isRunning: Boolean,
    showCompletionDialog: Boolean,
    completionMessage: String,
    onProjectNameChange: (String) -> Unit,
    onPromptChange: (Int, String) -> Unit,
    onStart: () -> Unit,
    onPause: () -> Unit,
    onStop: () -> Unit,
    onOpenFolder: () -> Unit,
    onParseClipboard: () -> Unit,
    onReadScreenText: () -> Unit,
    onOpenAccessibility: () -> Unit,
    onDismissCompletion: () -> Unit
) {
    Scaffold { innerPadding ->
        if (showCompletionDialog) {
            AlertDialog(
                onDismissRequest = onDismissCompletion,
                confirmButton = {
                    TextButton(onClick = onDismissCompletion) {
                        Text("확인")
                    }
                },
                title = { Text("이미지 생성 완료") },
                text = { Text(completionMessage.ifBlank { "전체 이미지 생성 작업이 완료되었습니다." }) }
            )
        }
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("쇼츠 이미지 자동생성 v1.0", style = MaterialTheme.typography.headlineSmall)
            Text(
                "ChatGPT에서 이미지 프롬프트 복사 -> 앱 자동 감지 -> 프롬프트 1~6 자동 분리 -> 시작",
                style = MaterialTheme.typography.bodyMedium
            )
            OutlinedTextField(
                value = projectName,
                onValueChange = onProjectNameChange,
                label = { Text("프로젝트명") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(onClick = onStart, modifier = Modifier.weight(1f)) { Text(if (isRunning) "실행 중" else "시작") }
                OutlinedButton(onClick = onPause, modifier = Modifier.weight(1f)) { Text("일시정지") }
                OutlinedButton(onClick = onStop, modifier = Modifier.weight(1f)) { Text("중지") }
            }
            LinearProgressIndicator(progress = { progressValue.coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
            Text(progressText, style = MaterialTheme.typography.bodyMedium)
            prompts.forEachIndexed { index, prompt ->
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { onPromptChange(index, it) },
                    label = { Text("프롬프트 ${index + 1}") },
                    minLines = 2,
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth()
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = onParseClipboard, modifier = Modifier.weight(1f)) { Text("클립보드 불러오기") }
                OutlinedButton(onClick = onReadScreenText, modifier = Modifier.weight(1f)) { Text("화면 텍스트 읽기") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = onOpenFolder, modifier = Modifier.weight(1f)) { Text("저장 폴더 열기") }
                OutlinedButton(onClick = onOpenAccessibility, modifier = Modifier.weight(1f)) { Text("접근성 설정") }
            }
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("로그", style = MaterialTheme.typography.titleMedium)
                    Text(logText.ifBlank { "아직 기록이 없습니다." }, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
