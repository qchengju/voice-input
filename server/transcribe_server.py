#!/usr/bin/env python3
"""Vosk 转录服务 —— 长驻进程，预加载模型，提供 HTTP API"""
import os
import json
import subprocess
import logging

from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format='[transcribe] %(message)s')
log = logging.getLogger(__name__)

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
CN_MODEL_PATH = os.path.join(MODEL_DIR, 'vosk-model-cn-0.22')
EN_MODEL_PATH = os.path.join(MODEL_DIR, 'vosk-model-small-en-us-0.15')

cn_model = None
en_model = None


def load_models():
    global cn_model, en_model
    from vosk import Model, SetLogLevel
    SetLogLevel(-1)

    if os.path.exists(CN_MODEL_PATH):
        log.info("加载中文模型: %s", CN_MODEL_PATH)
        cn_model = Model(CN_MODEL_PATH)
        log.info("中文模型加载完成")
    else:
        log.warning("中文模型未找到: %s", CN_MODEL_PATH)

    if os.path.exists(EN_MODEL_PATH):
        log.info("加载英文模型: %s", EN_MODEL_PATH)
        en_model = Model(EN_MODEL_PATH)
        log.info("英文模型加载完成")
    else:
        log.warning("英文模型未找到: %s", EN_MODEL_PATH)


def transcribe_with_model(pcm_path, model, sample_rate=16000):
    from vosk import KaldiRecognizer
    rec = KaldiRecognizer(model, sample_rate)
    rec.SetWords(True)

    with open(pcm_path, 'rb') as f:
        while True:
            data = f.read(4000)
            if not data:
                break
            rec.AcceptWaveform(data)

    result = json.loads(rec.FinalResult())
    text = result.get('text', '').strip()
    confidence = 0.0
    if 'result' in result and result['result']:
        words = result['result']
        confidence = sum(w.get('conf', 0.0) for w in words) / len(words)

    return text, confidence


def convert_to_pcm(audio_path):
    pcm_path = audio_path + '.pcm'
    subprocess.run([
        'ffmpeg', '-y', '-i', audio_path,
        '-ar', '16000', '-ac', '1',
        '-af', 'highpass=f=80,lowpass=f=8000,volume=1.5',
        '-f', 's16le', '-acodec', 'pcm_s16le',
        pcm_path
    ], capture_output=True, check=True, timeout=30)
    return pcm_path


def create_app():
    app = Flask(__name__)
    app.config['JSON_AS_ASCII'] = False

    @app.route('/transcribe', methods=['POST'])
    def transcribe():
        data = request.get_json(silent=True)
        if not data or 'audio_path' not in data:
            return jsonify({'error': '缺少 audio_path 参数', 'success': False}), 400

        audio_path = data['audio_path']
        lang = data.get('lang', 'zh')
        if lang not in ('zh', 'en'):
            lang = 'zh'
        if not os.path.exists(audio_path):
            return jsonify({'error': f'文件不存在: {audio_path}', 'success': False}), 400

        log.info("转写 [lang=%s]: %s", lang, audio_path)

        try:
            pcm_path = convert_to_pcm(audio_path)
        except subprocess.CalledProcessError as e:
            err = e.stderr.decode() if e.stderr else str(e)
            return jsonify({'error': f'ffmpeg 转换失败: {err}', 'success': False}), 500
        except subprocess.TimeoutExpired:
            return jsonify({'error': 'ffmpeg 转换超时', 'success': False}), 500

        try:
            if lang == 'zh':
                if not cn_model:
                    return jsonify({'error': '中文模型未安装，请运行 start.sh 下载', 'success': False}), 503
                model = cn_model
            else:
                if not en_model:
                    return jsonify({'error': '英文模型未安装，请运行 start.sh 下载', 'success': False}), 503
                model = en_model

            text, conf = transcribe_with_model(pcm_path, model)
            log.info("识别结果 [%s]: %r (conf=%.3f)", lang, text, conf)

            return jsonify({
                'text': text,
                'success': True,
                'lang': lang,
            })
        except Exception as e:
            log.exception("识别失败")
            return jsonify({'error': f'识别失败: {str(e)}', 'success': False}), 500
        finally:
            if os.path.exists(pcm_path):
                os.remove(pcm_path)

    @app.route('/health', methods=['GET'])
    def health():
        return jsonify({
            'status': 'ok',
            'engine': 'vosk-local',
            'models': {
                'zh': CN_MODEL_PATH if cn_model else None,
                'en': EN_MODEL_PATH if en_model else None,
            }
        })

    return app


if __name__ == '__main__':
    log.info("正在加载 Vosk 模型...")
    load_models()
    log.info("模型加载完成，启动服务 (端口 9002)")

    app = create_app()
    app.run(host='127.0.0.1', port=9002, debug=False)

