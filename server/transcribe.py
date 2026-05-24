#!/usr/bin/env python3
"""Vosk 语音转写脚本 —— 接收 webm 文件路径，输出 JSON 转写结果"""
import sys
import json
import subprocess
import os
import tempfile

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'models', 'vosk-model-small-cn-0.22')

def transcribe(audio_path):
    if not os.path.exists(audio_path):
        return {'error': f'文件不存在: {audio_path}', 'text': ''}

    # 1. 用 ffmpeg 转 webm → 16kHz mono PCM
    pcm_path = audio_path + '.pcm'
    try:
        subprocess.run([
            'ffmpeg', '-y', '-i', audio_path,
            '-ar', '16000', '-ac', '1',
            '-f', 's16le', '-acodec', 'pcm_s16le',
            pcm_path
        ], capture_output=True, check=True, timeout=30)
    except subprocess.CalledProcessError as e:
        return {'error': f'ffmpeg 转换失败: {e.stderr.decode()}', 'text': ''}
    except subprocess.TimeoutExpired:
        return {'error': 'ffmpeg 转换超时', 'text': ''}

    # 2. Vosk 识别
    try:
        from vosk import Model, KaldiRecognizer, SetLogLevel
        SetLogLevel(-1)

        if not os.path.exists(MODEL_PATH):
            return {'error': f'模型未找到: {MODEL_PATH}', 'text': ''}

        model = Model(MODEL_PATH)
        rec = KaldiRecognizer(model, 16000)

        with open(pcm_path, 'rb') as f:
            while True:
                data = f.read(4000)
                if not data:
                    break
                rec.AcceptWaveform(data)

        result = json.loads(rec.FinalResult())
        text = result.get('text', '').strip()
        return {'text': text}

    except Exception as e:
        return {'error': f'识别失败: {str(e)}', 'text': ''}
    finally:
        if os.path.exists(pcm_path):
            os.remove(pcm_path)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': '缺少音频文件路径参数', 'text': ''}))
        sys.exit(1)

    result = transcribe(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
