import doms from './js/dom.mjs'

const {
    textarea, copyBtn, clearBtn, insertSampleBtn,
    micBtn, recordBtn, recordedAudio, downloadAudioBtn,
    voiceZone, statusTextSpan, interimTextDiv,
    backendDot, backendLabel, recordingTimer,
    retryTranscribeBtn, transcribeProgress, progressBarFill, progressLabel,
} = doms

const API_BASE = 'http://localhost:3001'

// ---------- 全局状态 ----------
let recognition = null
let isListening = false
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

// ---------- 后端健康检查 ----------
async function checkBackendHealth() {
    try {
        const resp = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
        const data = await resp.json()
        backendOnline = true
        backendDot.className = 'backend-dot online'
        backendLabel.textContent = data.openaiConfigured ? '后端在线' : '后端在线 (需配置Key)'
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

function updateUIForListening(active) {
    if (active) {
        voiceZone.classList.add('listening-active')
        setStatus('🎙️ 聆听中... 请开始说话')
    } else {
        voiceZone.classList.remove('listening-active')
        setStatus('空闲，点击麦克风开始')
    }
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
    [micBtn, recordBtn, copyBtn, clearBtn, insertSampleBtn].forEach(b => {
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

// ---------- 语音识别（浏览器 Web Speech API） ----------
function cleanupRecognition(recog) {
    if (!recog) return
    const events = ['start', 'end', 'error', 'result', 'audiostart', 'audioend', 'soundstart', 'soundend', 'speechstart', 'speechend']
    events.forEach(e => { recog[`on${e}`] = null })
}

function stopRecognition() {
    isListening = false
    const recog = recognition
    recognition = null
    if (recog) {
        cleanupRecognition(recog)
        try { recog.stop() } catch (e) { /* ignore */ }
    }
    updateUIForListening(false)
    clearInterimDisplay()
}

function initAndStartRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
        setStatus('❌ 当前浏览器不支持语音识别')
        return false
    }
    if (recognition) stopRecognition()

    const recog = new SpeechRecognition()
    recog.continuous = true
    recog.interimResults = true
    recog.lang = 'zh-CN'
    recog.maxAlternatives = 1

    recog.onstart = () => {
        isListening = true
        updateUIForListening(true)
        clearInterimDisplay()
    }

    recog.onend = () => {
        if (isListening && recognition === recog) {
            try { recog.start(); return } catch (e) { /* fall through */ }
        }
        isListening = false
        updateUIForListening(false)
        clearInterimDisplay()
        if (recognition === recog) {
            recognition = null
            cleanupRecognition(recog)
        }
        if (!isRecording) setStatus('空闲，点击麦克风开始')
    }

    recog.onerror = (event) => {
        console.error('语音识别错误', event.error)
        const errors = {
            'not-allowed': '❌ 未获得麦克风权限',
            'no-speech': '⚠️ 未检测到语音',
            'audio-capture': '🎙️ 无法获取音频设备',
            'network': '🌐 网络错误，识别服务不可用',
        }
        const msg = errors[event.error] || `识别出错 (${event.error})`
        setStatus(msg)
        setInterimText(msg)
        setTimeout(() => { if (!isListening) setInterimText('') }, 2500)
        isListening = false
        updateUIForListening(false)
        if (recognition === recog) { recognition = null; cleanupRecognition(recog) }
    }

    recog.onresult = (event) => {
        let interim = '', final = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i]
            if (!r || !r[0]) continue
            if (r.isFinal) final += r[0].transcript
            else interim += r[0].transcript
        }
        if (final) appendFinalTextToInput(final)
        setInterimText(interim)
    }

    try {
        recog.start()
        recognition = recog
        isListening = true
        updateUIForListening(true)
        return true
    } catch (err) {
        console.error('启动失败', err)
        setStatus('启动失败，请重试')
        return false
    }
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
            if (data.text) {
                appendFinalTextToInput(data.text)
                setStatus('✅ 转写完成')
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
                ? '❌ 上传失败，后端服务未启动（http://localhost:3001）'
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

// ---------- 麦克风按钮 ----------
function onMicToggle() {
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
        setStatus('❌ 浏览器不支持语音识别')
        return
    }
    if (isRecording) stopAudioRecording()
    if (isListening) {
        stopRecognition()
        setStatus('空闲，点击麦克风开始')
    } else {
        initAndStartRecognition()
    }
}

// ---------- 录音按钮 ----------
function onRecordToggle() {
    if (isRecording) {
        stopAudioRecording()
        return
    }
    if (isListening) stopRecognition()
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
            setTimeout(() => { if (!isListening && !isRecording) setStatus('空闲，点击麦克风开始') }, 1500)
        })
        .catch(err => { setStatus('❌ 复制失败'); console.error(err) })
}

function handleClear() {
    textarea.value = ''
    textarea.dispatchEvent(new Event('input'))
    clearInterimDisplay()
    setStatus('已清空')
    setTimeout(() => {
        if (!isListening && !isRecording) setStatus('空闲，点击麦克风开始')
    }, 1200)
}

function handleInsertSample() {
    const example = '【语音输入法演示】通过麦克风高效输入文字，支持连续语音识别。无论是会议记录、文章创作还是日常笔记，解放双手，效率倍增。'
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

// ---------- 事件绑定 ----------
micBtn.addEventListener('click', onMicToggle)
recordBtn.addEventListener('click', onRecordToggle)
copyBtn.addEventListener('click', handleCopy)
clearBtn.addEventListener('click', handleClear)
insertSampleBtn.addEventListener('click', handleInsertSample)
downloadAudioBtn.addEventListener('click', handleDownloadAudio)
retryTranscribeBtn.addEventListener('click', retryTranscription)

// ---------- 初始化 ----------
const SpeechRecognitionCheck = window.SpeechRecognition || window.webkitSpeechRecognition
if (!SpeechRecognitionCheck) {
    const warnDiv = document.getElementById('compatWarning')
    if (warnDiv) {
        warnDiv.style.display = 'block'
        warnDiv.innerHTML = '⚠️ 当前浏览器不支持语音识别API，无法使用语音输入。推荐使用 Chrome / Edge / Safari。'
    }
    setStatus('浏览器不支持')
    micBtn.style.opacity = '0.6'
    micBtn.style.cursor = 'not-allowed'
    micBtn.removeEventListener('click', onMicToggle)
} else {
    console.log('语音输入法已准备就绪')
}

checkBackendHealth()
setInterval(checkBackendHealth, 30000)
