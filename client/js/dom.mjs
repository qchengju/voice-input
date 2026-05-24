const textarea = document.querySelector('#mainTextarea')
const copyBtn = document.querySelector('#copyBtn')
const clearBtn = document.querySelector('#clearBtn')
const insertSampleBtn = document.querySelector('#insertSampleBtn')
const micBtn = document.querySelector('#micBtn')
const recordBtn = document.querySelector('#recordBtn')
const recordedAudio = document.querySelector('#recordedAudio')
const downloadAudioBtn = document.querySelector('#downloadAudioBtn')
const voiceZone = document.querySelector('#voiceZone')
const statusTextSpan = document.querySelector('#statusText')
const interimTextDiv = document.querySelector('#interimText')
const backendDot = document.querySelector('#backendDot')
const backendLabel = document.querySelector('#backendLabel')
const recordingTimer = document.querySelector('#recordingTimer')
const retryTranscribeBtn = document.querySelector('#retryTranscribeBtn')
const transcribeProgress = document.querySelector('#transcribeProgress')
const progressBarFill = document.querySelector('#progressBarFill')
const progressLabel = document.querySelector('#progressLabel')

export default {
    textarea, copyBtn, clearBtn, insertSampleBtn,
    micBtn, recordBtn, recordedAudio, downloadAudioBtn,
    voiceZone, statusTextSpan, interimTextDiv,
    backendDot, backendLabel, recordingTimer,
    retryTranscribeBtn, transcribeProgress, progressBarFill, progressLabel,
}
