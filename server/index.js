import express from 'express'
import multer from 'multer'
import cors from 'cors'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())

const TSC_PORT = process.env.TSC_PORT || 9002
const TRANSCRIBE_SERVER = `http://127.0.0.1:${TSC_PORT}`

async function runTranscribe(audioPath, lang) {
    const response = await fetch(`${TRANSCRIBE_SERVER}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_path: audioPath, lang: lang || 'zh' }),
        signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `转录服务返回 ${response.status}`)
    }
    return response.json()
}

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '未接收到音频文件', success: false })
        }
        if (req.file.size === 0) {
            return res.status(400).json({ error: '音频文件为空', success: false })
        }

        const tmpDir = join(__dirname, 'tmp')
        await mkdir(tmpDir, { recursive: true })
        const tmpFile = join(tmpDir, `audio-${Date.now()}.webm`)
        await writeFile(tmpFile, req.file.buffer)

        try {
            const result = await runTranscribe(tmpFile, req.body.lang)

            if (result.error) {
                return res.status(500).json({ error: result.error, success: false })
            }

            res.json({
                text: result.text || '',
                success: true,
                lang: result.lang || 'auto',
            })
        } finally {
            await unlink(tmpFile).catch(() => {})
        }
    } catch (err) {
        console.error('转写失败:', err)
        res.status(500).json({
            error: `语音转写失败: ${err.message}`,
            success: false,
        })
    }
})

app.get('/api/health', async (_req, res) => {
    try {
        const resp = await fetch(`${TRANSCRIBE_SERVER}/health`, {
            signal: AbortSignal.timeout(3000),
        })
        const data = await resp.json()
        res.json({
            status: 'ok',
            engine: 'vosk-local',
            models: data.models,
        })
    } catch {
        res.json({
            status: 'error',
            engine: 'vosk-local',
            error: '转录服务未就绪',
        })
    }
})

const PORT = process.env.BE_PORT || 9001
app.listen(PORT, () => {
    console.log(`语音转写服务运行在 http://localhost:${PORT}`)
    console.log(`引擎: Vosk 本地模型 (中文 + 英文)`)
})
