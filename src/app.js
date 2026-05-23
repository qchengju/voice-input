
(function () {
    // ---------- DOM 元素 ----------
    const textarea = document.getElementById('mainTextarea');
    const copyBtn = document.getElementById('copyBtn');
    const clearBtn = document.getElementById('clearBtn');
    const insertSampleBtn = document.getElementById('insertSampleBtn');
    const micBtn = document.getElementById('micBtn');
    const voiceZone = document.getElementById('voiceZone');
    const statusTextSpan = document.getElementById('statusText');
    const interimTextDiv = document.getElementById('interimText');

    // ---------- 语音识别状态变量 ----------
    let recognition = null;          // 当前语音识别实例
    let isListening = false;         // 是否处于监听状态
    let shouldRestartOnEnd = false;  // 连续模式下如果异常结束是否自动恢复

    // 辅助函数: 更新UI 为监听中或空闲
    function updateUIForListening(active) {
        if (active) {
            voiceZone.classList.add('listening-active');
            statusTextSpan.innerText = '聆听中... 连续语音转文字';
            micBtn.style.cursor = 'pointer';
        } else {
            voiceZone.classList.remove('listening-active');
            statusTextSpan.innerText = '空闲，点击麦克风开始';
            micBtn.style.cursor = 'pointer';
        }
    }

    // 将最终文本追加到 textarea 末尾 (自动加一个空格? 为了自然语言衔接，不加额外空格，中文语境自然)
    function appendFinalTextToInput(finalText) {
        if (!finalText || finalText.trim() === '') return;
        const current = textarea.value;
        let newValue = current;
        if (current.length > 0 && !current.endsWith(' ') && !current.endsWith('\n') && !current.endsWith('，') && !current.endsWith('。')) {
            // 可选，但为了更自然，不加空格，用户自行处理。但很多语音输入法不加空格，保持原文。
            // 为了避免 “你好世界” 连续，用户期待空格场景较少，按照原始拼接不做额外空格
            newValue = current + finalText;
        } else {
            newValue = current + finalText;
        }
        textarea.value = newValue;
        // 自动滚动到底部
        textarea.scrollTop = textarea.scrollHeight;
        // 触发一次input事件，方便后续扩展
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 清空临时显示区
    function clearInterimDisplay() {
        interimTextDiv.innerText = '';
    }

    // 设置中间识别结果
    function setInterimText(text) {
        if (text && text.trim().length > 0) {
            interimTextDiv.innerText = text;
        } else {
            interimTextDiv.innerText = '';
        }
    }

    // 停止识别并清理资源
    function stopRecognition(resetShouldRestart = false) {
        if (recognition) {
            try {
                // 如果正在监听，调用 stop 触发 onend 事件
                if (isListening) {
                    recognition.stop();
                }
            } catch (e) {
                console.warn("stop recognition error", e);
            }
            // 移除事件监听并置空实例, 避免内存泄露
            if (recognition) {
                cleanupRecognitionEvents(recognition);
            }
            recognition = null;
        }
        isListening = false;
        updateUIForListening(false);
        if (resetShouldRestart) shouldRestartOnEnd = false;
    }

    // 移除所有事件监听 (防止重复绑定)
    function cleanupRecognitionEvents(recog) {
        if (!recog) return;
        const events = ['start', 'end', 'error', 'result', 'audiostart', 'audioend', 'soundstart', 'soundend', 'speechstart', 'speechend'];
        events.forEach(event => {
            recog[`on${event}`] = null;
        });
    }

    // 初始化 SpeechRecognition 并绑定事件 (每次开始都会新建实例, 确保干净)
    function initAndStartRecognition() {
        // 检查浏览器支持
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            const warnDiv = document.getElementById('compatWarning');
            warnDiv.style.display = 'block';
            warnDiv.innerHTML = '❌ 当前浏览器不支持 Web Speech API，无法使用语音输入。请使用 Chrome、Edge 或 Safari 浏览器。';
            statusTextSpan.innerText = '不支持语音识别';
            return false;
        }

        // 如果已经处于监听状态，则先停止（用户手动停止）
        if (isListening) {
            stopRecognition();
            return false;
        }

        // 新建实例
        const recog = new SpeechRecognition();
        recog.continuous = true;       // 连续识别，适合长段落
        recog.interimResults = true;   // 获取临时结果，提升实时反馈
        recog.lang = 'zh-CN';          // 中文普通话 + 可识别简单英文单词
        recog.maxAlternatives = 1;      // 仅取最高置信度，平衡准确度与速度

        // 绑定关键事件
        recog.onstart = () => {
            isListening = true;
            updateUIForListening(true);
            clearInterimDisplay();      // 开始新会话时清空临时框
            statusTextSpan.innerText = '🎙️ 聆听中... 请开始说话';
        };

        recog.onend = () => {
            // 识别结束 (无论是用户主动stop, 或者无语音自动结束)
            isListening = false;
            updateUIForListening(false);
            // 清除临时显示
            clearInterimDisplay();
            // 注意：如果因为网络错误或者权限等原因end后不重启，保持空闲
            if (recognition === recog) {
                // 置空实例引用，避免内存
                cleanupRecognitionEvents(recog);
                if (recognition === recog) recognition = null;
            }
            statusTextSpan.innerText = '空闲，点击麦克风开始';
        };

        recog.onerror = (event) => {
            console.error('语音识别错误', event.error);
            let errorMsg = '';
            switch (event.error) {
                case 'not-allowed':
                    errorMsg = '❌ 未获得麦克风权限，请允许麦克风访问后重试。';
                    break;
                case 'no-speech':
                    errorMsg = '⚠️ 未检测到语音，请检查麦克风并尝试说话。';
                    // 没有语音不视为严重错误，安静结束即可
                    break;
                case 'audio-capture':
                    errorMsg = '🎙️ 无法获取音频设备，请检查麦克风连接。';
                    break;
                case 'network':
                    errorMsg = '🌐 网络错误，语音识别服务不可用。';
                    break;
                default:
                    errorMsg = `识别出错 (${event.error})，可重新点击麦克风。`;
            }
            if (errorMsg) {
                statusTextSpan.innerText = errorMsg;
                // 显示错误短暂提示在 interim 区域
                setInterimText(errorMsg);
                setTimeout(() => {
                    if (!isListening) setInterimText('');
                }, 2500);
            }
            // 错误后确保停止并清理
            if (recognition === recog) {
                stopRecognition();
            }
        };

        // 核心结果处理函数 (平衡准确度 + 实时)
        recog.onresult = (event) => {
            // 为了高响应与易用，将最终结果即时追加到文本框
            // 同时更新中间区域展示临时识别内容。
            let interimTranscript = '';
            let finalTranscriptBuffer = ''; // 本次结果中所有新产生的最终文本暂存(用于立刻上屏)

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript;
                if (result.isFinal) {
                    // 最终结果，代表一句完整语义，追加到文本框
                    finalTranscriptBuffer += transcript;
                } else {
                    // 临时结果，展示在下方区域，让用户看到正在识别的内容
                    interimTranscript += transcript;
                }
            }

            // 如果有最终结果，立即追加到文本框（实时上屏，提高输入效率，无需等待用户额外操作）
            if (finalTranscriptBuffer) {
                appendFinalTextToInput(finalTranscriptBuffer);
            }
            // 刷新临时结果显示（让用户看到识别过程的中间词，降低焦虑，提升准确度感知）
            if (interimTranscript) {
                setInterimText(interimTranscript);
            } else if (!finalTranscriptBuffer && !interimTranscript) {
                // 没有任何文本可以保留原有提示，不清除
            } else if (!interimTranscript && finalTranscriptBuffer) {
                // 只有最终结果时清除临时显示
                setInterimText('');
            }
        };

        // 可选: 监听audio 相关事件，没有功能性影响，但便于调试
        recog.onaudiostart = () => { /* 可选 */ };
        recog.onaudioend = () => { /* 可选 */ };

        // 开始识别
        try {
            recog.start();
            recognition = recog;
            isListening = true;
            updateUIForListening(true);
            return true;
        } catch (err) {
            console.error('启动失败', err);
            statusTextSpan.innerText = '启动失败，请重试';
            cleanupRecognitionEvents(recog);
            return false;
        }
    }

    // 用户点击麦克风：开始或停止
    function onMicToggle() {
        const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) {
            const warnDiv = document.getElementById('compatWarning');
            warnDiv.style.display = 'block';
            warnDiv.innerHTML = '❌ 当前浏览器不支持语音识别，请升级或更换Chrome/Edge/Safari。';
            return;
        }

        if (isListening) {
            // 停止识别
            stopRecognition();
        } else {
            // 开始识别前，自动检查兼容并开启新会话，不清空文本框，方便连续追加
            // 避免因实例未清理导致的冲突
            if (recognition) {
                stopRecognition();
            }
            initAndStartRecognition();
        }
    }

    // ----- 辅助功能：复制文本 -----
    copyBtn.addEventListener('click', async () => {
        const textToCopy = textarea.value;
        if (!textToCopy) {
            // 临时显示提示
            const oldStatus = statusTextSpan.innerText;
            statusTextSpan.innerText = '📋 没有可复制的文本';
            setTimeout(() => {
                if (!isListening) statusTextSpan.innerText = oldStatus;
                else statusTextSpan.innerText = '🎙️ 聆听中... 连续语音转文字';
            }, 1200);
            return;
        }
        try {
            await navigator.clipboard.writeText(textToCopy);
            statusTextSpan.innerText = '✅ 已复制到剪贴板';
            setTimeout(() => {
                if (!isListening) statusTextSpan.innerText = '空闲，点击麦克风开始';
                else statusTextSpan.innerText = '🎙️ 聆听中... 连续语音转文字';
            }, 1500);
        } catch (err) {
            statusTextSpan.innerText = '❌ 复制失败，手动选择文本复制';
            console.error(err);
        }
    });

    // 清空文本框
    clearBtn.addEventListener('click', () => {
        textarea.value = '';
        textarea.dispatchEvent(new Event('input'));
        clearInterimDisplay();
        // 如果正在录音，仅清空文本框不干扰识别流
        if (!isListening) {
            statusTextSpan.innerText = '已清空，点击麦克风继续输入';
            setTimeout(() => {
                if (!isListening) statusTextSpan.innerText = '空闲，点击麦克风开始';
            }, 1200);
        } else {
            // 不影响识别
            statusTextSpan.innerText = '🎙️ 已清空文档，继续听写';
            setTimeout(() => {
                if (isListening) statusTextSpan.innerText = '🎙️ 聆听中... 连续语音转文字';
            }, 1000);
        }
    });

    // 插入示例文本
    insertSampleBtn.addEventListener('click', () => {
        const example = "【语音输入法演示】通过麦克风高效输入文字，支持连续语音识别。无论是会议记录、文章创作还是日常笔记，解放双手，效率倍增。";
        const current = textarea.value;
        if (current && !current.endsWith('\n') && !current.endsWith(' ') && current.length > 0) {
            textarea.value = current + '\n' + example;
        } else {
            textarea.value = current + example;
        }
        textarea.scrollTop = textarea.scrollHeight;
        textarea.focus();
    });

    // 绑定麦克风点击事件
    micBtn.addEventListener('click', onMicToggle);

    // 初始化兼容性警告
    const SpeechRecognitionCheck = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCheck) {
        document.getElementById('compatWarning').style.display = 'block';
        document.getElementById('compatWarning').innerHTML = '⚠️ 当前浏览器不支持语音识别API，无法使用语音输入。推荐使用 Chrome / Edge / Safari。';
        statusTextSpan.innerText = '浏览器不支持';
        micBtn.style.opacity = '0.6';
        micBtn.style.cursor = 'not-allowed';
        micBtn.removeEventListener('click', onMicToggle);
    } else {
        // 额外说明: 所有功能正常
        console.log("语音输入法已准备就绪，平衡准确度·易用性·零成本");
    }

    // 额外提醒：用户在HTTPS或者localhost环境下体验最佳
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && !location.hostname.startsWith('127.0.0.1')) {
        const warnBox = document.getElementById('compatWarning');
        if (warnBox && !warnBox.innerText.includes('不支持')) {
            warnBox.style.display = 'block';
            warnBox.innerHTML = '🔒 建议在 HTTPS 或 localhost 下使用语音功能，部分浏览器可能限制麦克风权限。';
        }
    }
})();
