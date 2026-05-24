import doms from './js/dom.mjs'

// doms
const {
    textarea, copyBtn, clearBtn, insertSampleBtn,
    recordBtn, recordedAudio, downloadAudioBtn,
    voiceZone, statusTextSpan, interimTextDiv,
    backendDot, backendLabel, recordingTimer,
    retryTranscribeBtn, transcribeProgress, progressBarFill, progressLabel,
    langSelector, langOptions,
} = doms

const API_BASE = 'http://localhost:9001'

// ---------- 全局状态 ----------
let mediaRecorder = null
let audioChunks = []
let recordedBlob = null
let isRecording = false
let mediaStream = null
let backendOnline = false
let recordingStartTime = null
let timerInterval = null
let uploadAbortController = null
let lastRecordedBlob = null
let currentLang = 'zh'

// ---------- 后端健康检查 ----------
async function checkBackendHealth() {
    try {
        const resp = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
        const data = await resp.json()
        backendOnline = true
        backendDot.className = 'backend-dot online'
        backendLabel.textContent = data.status === 'ok' ? '后端在线' : '后端在线 (需配置Key)'
    } catch (e) {
        backendOnline = false
        backendDot.className = 'backend-dot offline'
        backendLabel.textContent = '后端离线'
    }
}

// ---------- 录制计时器 ----------
function startTimer() {
    recordingStartTime = Date.now()
    recordingTimer.classList.add('active')
    updateTimerDisplay()
    timerInterval = setInterval(updateTimerDisplay, 200)
}

function stopTimer() {
    clearInterval(timerInterval)
    timerInterval = null
    recordingStartTime = null
    recordingTimer.classList.remove('active')
    recordingTimer.textContent = '00:00'
}

function updateTimerDisplay() {
    if (!recordingStartTime) return
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000)
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    recordingTimer.textContent = `${m}:${s}`
}

// ---------- 进度条 ----------
function showProgress(label) {
    transcribeProgress.style.display = 'block'
    progressBarFill.style.width = '0%'
    progressLabel.textContent = label
}

function updateProgress(label, pct) {
    progressBarFill.style.width = `${Math.min(pct, 95)}%`
    if (label) progressLabel.textContent = label
}

function hideProgress() {
    transcribeProgress.style.display = 'none'
    progressBarFill.style.width = '0%'
}

// ---------- UI 更新 ----------
function setStatus(text) {
    statusTextSpan.innerText = text
}

function updateRecordingUI(active) {
    if (active) {
        recordBtn.classList.add('btn-primary')
        recordBtn.innerText = '⏹ 停止录音'
    } else {
        recordBtn.classList.remove('btn-primary')
        recordBtn.innerText = '🎧 录音转文字'
    }
}

function setButtonsEnabled(enabled) {
    [recordBtn, copyBtn, clearBtn, insertSampleBtn].forEach(b => {
        b.style.pointerEvents = enabled ? '' : 'none'
        b.style.opacity = enabled ? '' : '0.55'
    })
}

// ---------- 文本操作 ----------
function appendFinalTextToInput(finalText) {
    if (!finalText || finalText.trim() === '') return
    textarea.value += finalText
    textarea.scrollTop = textarea.scrollHeight
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

function clearInterimDisplay() {
    interimTextDiv.innerText = ''
}

function setInterimText(text) {
    interimTextDiv.innerText = text || ''
}

// ---------- 录音与后端转写 ----------
function stopMediaStream() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop())
        mediaStream = null
    }
}

function configureRecordedAudio(blob) {
    if (!blob) return
    recordedBlob = blob
    recordedAudio.src = URL.createObjectURL(blob)
    recordedAudio.controls = true
    downloadAudioBtn.disabled = false
}

async function uploadAndTranscribe(blob) {
    lastRecordedBlob = blob
    uploadAbortController = new AbortController()

    setButtonsEnabled(false)
    retryTranscribeBtn.style.display = 'none'
    hideProgress()

    showProgress('正在上传音频...')
    updateProgress('正在上传音频...', 10)

    const formData = new FormData()
    formData.append('audio', blob, 'recording.webm')
    formData.append('lang', currentLang)

    try {
        updateProgress('正在上传音频...', 30)

        const response = await fetch(`${API_BASE}/api/transcribe`, {
            method: 'POST',
            body: formData,
            signal: uploadAbortController.signal,
        })

        updateProgress('正在转写识别...', 70)
        const data = await response.json()

        if (data.success) {
            updateProgress('转写完成', 100)
            const langLabel = data.lang === 'en' ? '[EN]' : data.lang === 'zh' ? '[中文]' : ''
            if (data.text) {
                appendFinalTextToInput(data.text)
                setStatus(`✅ 转写完成 ${langLabel}`)
            } else {
                setStatus('⚠️ 转写完成，未识别到语音内容')
            }
            setInterimText(data.text || '(未识别到语音)')
            hideProgress()
        } else {
            throw new Error(data.error || '转写失败')
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            setStatus('已取消上传')
        } else {
            console.error('上传/转写失败', err)
            const msg = err.message.includes('Failed to fetch')
                ? '❌ 上传失败，后端服务未启动（http://localhost:9001）'
                : `❌ ${err.message}`
            setStatus(msg)
            setInterimText(err.message || '转写失败，请重试')
            retryTranscribeBtn.style.display = 'inline-flex'
        }
        hideProgress()
    } finally {
        setButtonsEnabled(true)
        uploadAbortController = null
    }
}

function retryTranscription() {
    if (!lastRecordedBlob) return
    uploadAndTranscribe(lastRecordedBlob)
}

// ---------- 录音按钮 ----------
function onRecordToggle() {
    if (isRecording) {
        stopAudioRecording()
        return
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
        setStatus('❌ 当前浏览器不支持录音功能')
        return
    }

    setStatus('🎙️ 获取麦克风权限中...')

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            mediaStream = stream
            audioChunks = []
            lastRecordedBlob = null
            retryTranscribeBtn.style.display = 'none'
            hideProgress()

            mediaRecorder = new MediaRecorder(stream)
            mediaRecorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) audioChunks.push(event.data)
            }
            mediaRecorder.onstop = () => {
                if (audioChunks.length > 0) {
                    const blob = new Blob(audioChunks, { type: 'audio/webm' })
                    configureRecordedAudio(blob)
                    uploadAndTranscribe(blob)
                }
            }
            mediaRecorder.start()
            isRecording = true
            updateRecordingUI(true)
            startTimer()
            setStatus('🎙️ 正在录音，点击「停止录音」后自动转写...')
        })
        .catch(err => {
            console.error('录音权限获取失败', err)
            setStatus('❌ 无法获取麦克风权限，录音失败。')
        })
}

function stopAudioRecording() {
    if (mediaRecorder && isRecording) {
        try { mediaRecorder.stop() } catch (e) { /* ignore */ }
        mediaRecorder = null
        isRecording = false
        updateRecordingUI(false)
        stopTimer()
        setStatus('已停止录音，正在转写...')
    }
    stopMediaStream()
}

// ---------- 辅助按钮 ----------
function handleCopy() {
    const text = textarea.value
    if (!text) { setStatus('📋 没有可复制的文本'); return }
    navigator.clipboard.writeText(text)
        .then(() => {
            setStatus('✅ 已复制到剪贴板')
            setTimeout(() => { if (!isRecording) setStatus('空闲，点击录音按钮开始') }, 1500)
        })
        .catch(err => { setStatus('❌ 复制失败'); console.error(err) })
}

function handleClear() {
    textarea.value = ''
    textarea.dispatchEvent(new Event('input'))
    clearInterimDisplay()
    setStatus('已清空')
    setTimeout(() => {
        if (!isRecording) setStatus('空闲，点击录音按钮开始')
    }, 1200)
}

function handleInsertSample() {
    const example = '【语音输入法演示】解放双手，效率倍增。'
    textarea.value = textarea.value
        ? textarea.value + (textarea.value.endsWith('\n') ? '' : '\n') + example
        : example
    textarea.scrollTop = textarea.scrollHeight
    textarea.focus()
}

function handleDownloadAudio() {
    if (!recordedBlob) return
    const url = URL.createObjectURL(recordedBlob)
    const a = document.createElement('a')
    a.href = url; a.download = 'recorded-voice.webm'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function onLangChange(lang) {
    currentLang = lang
    langOptions.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang)
    })
    const tips = { zh: '空闲，点击录音按钮开始', en: 'Idle · Click record to start' }
    if (!isRecording) setStatus(tips[lang] || '')
}

// ---------- 事件绑定 ----------
recordBtn.addEventListener('click', onRecordToggle)
copyBtn.addEventListener('click', handleCopy)
clearBtn.addEventListener('click', handleClear)
insertSampleBtn.addEventListener('click', handleInsertSample)
downloadAudioBtn.addEventListener('click', handleDownloadAudio)
retryTranscribeBtn.addEventListener('click', retryTranscription)
langOptions.forEach(btn => {
    btn.addEventListener('click', () => onLangChange(btn.dataset.lang))
})

checkBackendHealth()
setInterval(checkBackendHealth, 30000)
