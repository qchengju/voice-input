import express from 'express'
import multer from 'multer'
import cors from 'cors'
import dotenv from 'dotenv'
import { writeFile, unlink, mkdir } from 'fs/promises'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())

function runTranscribe(audioPath) {
    return new Promise((resolve, reject) => {
        const scriptPath = join(__dirname, 'transcribe.py')
        const proc = spawn('python3', [scriptPath, audioPath], {
            timeout: 60000,
        })

        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', data => { stdout += data.toString() })
        proc.stderr.on('data', data => { stderr += data.toString() })

        proc.on('close', code => {
            if (code !== 0) {
                return reject(new Error(`转写进程退出码 ${code}: ${stderr}`))
            }
            try {
                const result = JSON.parse(stdout)
                resolve(result)
            } catch (e) {
                reject(new Error(`解析结果失败: ${stdout}`))
            }
        })

        proc.on('error', err => {
            reject(new Error(`启动转写进程失败: ${err.message}`))
        })
    })
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
            const result = await runTranscribe(tmpFile)

            if (result.error) {
                return res.status(500).json({ error: result.error, success: false })
            }

            res.json({
                text: result.text || '',
                success: true,
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

app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        engine: 'vosk-local',
        model: 'vosk-model-small-cn-0.22',
    })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
    console.log(`语音转写服务运行在 http://localhost:${PORT}`)
    console.log(`引擎: Vosk 本地模型 (vosk-model-small-cn-0.22)`)
})
