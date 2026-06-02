// ==========================================
// WAV AUDIO RECORDER CLASS (Pure JS)
// ==========================================
class WAVRecorder {
    constructor() {
        this.audioContext = null;
        this.processor = null;
        this.input = null;
        this.stream = null;
        this.leftchannel = [];
        this.recordingLength = 0;
        this.sampleRate = 44100;
        this.isRecording = false;
    }

    async start() {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sampleRate = this.audioContext.sampleRate;
        this.input = this.audioContext.createMediaStreamSource(this.stream);
        
        // 2048 buffer size, 1 input channel, 1 output channel
        this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
        
        this.leftchannel = [];
        this.recordingLength = 0;

        this.processor.onaudioprocess = (e) => {
            const left = e.inputBuffer.getChannelData(0);
            this.leftchannel.push(new Float32Array(left));
            this.recordingLength += 2048;
        };

        this.input.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
        this.isRecording = true;
    }

    stop() {
        if (!this.isRecording) return null;

        this.isRecording = false;
        
        if (this.processor) this.processor.disconnect();
        if (this.input) this.input.disconnect();
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        if (this.audioContext) {
            this.audioContext.close();
        }

        // Flatten the left channel buffers
        const leftBuffer = this.mergeBuffers(this.leftchannel, this.recordingLength);
        
        // Create WAV file binary buffer (44 bytes header + PCM samples)
        const buffer = new ArrayBuffer(44 + this.recordingLength * 2);
        const view = new DataView(buffer);

        /* RIFF identifier */
        this.writeString(view, 0, 'RIFF');
        /* file length */
        view.setUint32(4, 36 + this.recordingLength * 2, true);
        /* RIFF type */
        this.writeString(view, 8, 'WAVE');
        /* format chunk identifier */
        this.writeString(view, 12, 'fmt ');
        /* format chunk length */
        view.setUint32(16, 16, true);
        /* sample format (1 = raw PCM) */
        view.setUint16(20, 1, true);
        /* channel count (1 = mono) */
        view.setUint16(22, 1, true);
        /* sample rate */
        view.setUint32(24, this.sampleRate, true);
        /* byte rate (sample rate * block align) */
        view.setUint32(28, this.sampleRate * 2, true);
        /* block align (channel count * bytes per sample) */
        view.setUint16(32, 2, true);
        /* bits per sample (16-bit PCM) */
        view.setUint16(34, 16, true);
        /* data chunk identifier */
        this.writeString(view, 36, 'data');
        /* data chunk length */
        view.setUint32(40, this.recordingLength * 2, true);

        // Write PCM audio samples
        let offset = 44;
        for (let i = 0; i < leftBuffer.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, leftBuffer[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    mergeBuffers(channelBuffer, recordingLength) {
        const result = new Float32Array(recordingLength);
        let offset = 0;
        for (let i = 0; i < channelBuffer.length; i++) {
            const buffer = channelBuffer[i];
            result.set(buffer, offset);
            offset += buffer.length;
        }
        return result;
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}

// Global recorder instance
const recorder = new WAVRecorder();
let currentStsAudio = null;

// ==========================================
// CLIENT ROUTING (TAB SWITCHING)
// ==========================================
function showTab(tabId) {
    // Stop recording if active when switching tabs
    stopAllRecording();

    // Hide all cards
    document.querySelectorAll('.card').forEach(card => {
        card.classList.add('hidden');
    });

    // Remove active state from all buttons
    document.querySelectorAll('.tabs button').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected card and set active tab button
    document.getElementById(tabId).classList.remove('hidden');
    document.getElementById(`tab-${tabId}`).classList.add('active');
}

function stopAllRecording() {
    if (recorder.isRecording) {
        recorder.stop();
        resetSttUI();
        resetStsUI();
    }
}

// ==========================================
// MODULE 1: TEXT → TEXT TRANSLATION
// ==========================================
async function translateText() {
    const textInput = document.getElementById("textInput").value.trim();
    const sourceLang = document.getElementById("textSourceLang").value;
    const targetLang = document.getElementById("textTargetLang").value;
    const outputBox = document.getElementById("output");
    
    const btnText = document.getElementById("textBtnText");
    const spinner = document.getElementById("textSpinner");

    if (!textInput) {
        alert("Please enter some text to translate.");
        return;
    }

    // Update UI states
    btnText.textContent = "Translating...";
    spinner.classList.remove("hidden");
    outputBox.classList.add("empty");
    outputBox.textContent = "Translating text...";

    try {
        const response = await fetch(`/api/translate/?text=${encodeURIComponent(textInput)}&src=${sourceLang}&dest=${targetLang}`);
        const data = await response.json();

        if (response.ok) {
            outputBox.classList.remove("empty");
            outputBox.textContent = data.translated;
        } else {
            outputBox.textContent = `Error: ${data.error || "Failed to translate"}`;
        }
    } catch (error) {
        console.error("Text Translation error:", error);
        outputBox.textContent = "Network error: Could not reach the server.";
    } finally {
        btnText.textContent = "Translate";
        spinner.classList.add("hidden");
    }
}

// ==========================================
// MODULE 2: TEXT → SPEECH SYNTHESIS
// ==========================================
async function speakText() {
    const ttsText = document.getElementById("ttsText").value.trim();
    const ttsLang = document.getElementById("ttsLang").value;
    const btnText = document.getElementById("ttsBtnText");
    const spinner = document.getElementById("ttsSpinner");
    const statusBadge = document.getElementById("ttsStatus");

    if (!ttsText) {
        alert("Please enter some text to speak.");
        return;
    }

    // Update UI
    btnText.textContent = "Generating...";
    spinner.classList.remove("hidden");
    statusBadge.classList.remove("hidden");
    statusBadge.classList.remove("playing");
    statusBadge.textContent = "Synthesizing audio...";

    try {
        const response = await fetch(`/api/tts/?text=${encodeURIComponent(ttsText)}&lang=${ttsLang}`);
        const data = await response.json();

        if (response.ok && data.audio) {
            statusBadge.classList.add("playing");
            statusBadge.textContent = "🔊 Playing Audio...";
            
            // Play base64 audio
            const audioSrc = "data:audio/mp3;base64," + data.audio;
            const audio = new Audio(audioSrc);
            audio.onended = () => {
                statusBadge.classList.add("hidden");
            };
            await audio.play();
        } else {
            alert(`Error: ${data.error || "Failed to synthesize speech"}`);
            statusBadge.classList.add("hidden");
        }
    } catch (error) {
        console.error("TTS error:", error);
        alert("Network error: Could not generate speech audio.");
        statusBadge.classList.add("hidden");
    } finally {
        btnText.textContent = "🔊 Generate & Play";
        spinner.classList.add("hidden");
    }
}

// ==========================================
// MODULE 3: SPEECH → TEXT TRANSCRIBER
// ==========================================
function resetSttUI() {
    const recordBtn = document.getElementById("sttRecordBtn");
    const wave = document.getElementById("sttWave");
    const status = document.getElementById("sttStatus");

    recordBtn.classList.remove("recording");
    recordBtn.innerHTML = "<span>🎤 Start Recording</span>";
    wave.classList.remove("recording");
    status.classList.add("hidden");
}

async function toggleSttRecording() {
    const recordBtn = document.getElementById("sttRecordBtn");
    const wave = document.getElementById("sttWave");
    const status = document.getElementById("sttStatus");
    const speechOutput = document.getElementById("speechOutput");
    const sttLang = document.getElementById("sttLang").value;
    const sttTargetLang = document.getElementById("sttTargetLang").value;

    if (!recorder.isRecording) {
        // Start recording
        try {
            status.classList.remove("hidden");
            status.classList.add("listening");
            status.textContent = "🎙️ Recording... Speak now";
            
            await recorder.start();
            
            recordBtn.classList.add("recording");
            recordBtn.innerHTML = "<span>🛑 Stop & Transcribe</span>";
            wave.classList.add("recording");
            speechOutput.classList.add("empty");
            speechOutput.textContent = "Listening to microphone...";
        } catch (err) {
            console.error("Mic access denied:", err);
            alert("Could not access microphone. Please check browser permissions.");
            resetSttUI();
        }
    } else {
        // Stop and send audio
        status.classList.remove("listening");
        status.textContent = "⏳ Processing speech...";
        speechOutput.textContent = "Transcribing audio...";

        const audioBlob = recorder.stop();
        resetSttUI();

        if (!audioBlob) {
            speechOutput.textContent = "Error: No audio recorded.";
            return;
        }

        // Upload audio blob to backend
        const formData = new FormData();
        formData.append("audio", audioBlob, "speech.wav");
        formData.append("language", sttLang);
        formData.append("target_language", sttTargetLang);

        try {
            const response = await fetch("/api/stt/", {
                method: "POST",
                body: formData
            });
            const data = await response.json();

            if (response.ok) {
                speechOutput.classList.remove("empty");
                speechOutput.textContent = data.text;
            } else {
                speechOutput.textContent = `Error: ${data.error || "Failed to transcribe speech"}`;
            }
        } catch (error) {
            console.error("STT Upload error:", error);
            speechOutput.textContent = "Network error: Could not reach the server.";
        }
    }
}

// ==========================================
// MODULE 4: SPEECH → SPEECH TRANSLATOR
// ==========================================
function resetStsUI() {
    const recordBtn = document.getElementById("stsRecordBtn");
    const wave = document.getElementById("stsWave");
    const status = document.getElementById("stsStatus");

    recordBtn.classList.remove("recording");
    recordBtn.innerHTML = "<span>🎤 Speak & Translate</span>";
    wave.classList.remove("recording");
    status.classList.add("hidden");
}

async function toggleStsRecording() {
    const recordBtn = document.getElementById("stsRecordBtn");
    const wave = document.getElementById("stsWave");
    const status = document.getElementById("stsStatus");
    
    const speechText = document.getElementById("speechText");
    const stsOutput = document.getElementById("stsOutput");
    const replayBtn = document.getElementById("stsPlayBtn");

    const sourceLang = document.getElementById("stsSourceLang").value;
    const targetLang = document.getElementById("stsTargetLang").value;

    if (!recorder.isRecording) {
        // Start recording
        try {
            status.classList.remove("hidden");
            status.classList.add("listening");
            status.textContent = "🎙️ Recording... Speak now";
            
            await recorder.start();
            
            recordBtn.classList.add("recording");
            recordBtn.innerHTML = "<span>🛑 Stop & Translate</span>";
            wave.classList.add("recording");
            
            speechText.classList.add("empty");
            speechText.textContent = "Listening to microphone...";
            stsOutput.classList.add("empty");
            stsOutput.textContent = "Waiting for transcription...";
            
            replayBtn.disabled = true;
            currentStsAudio = null;
        } catch (err) {
            console.error("Mic access denied:", err);
            alert("Could not access microphone. Please check browser permissions.");
            resetStsUI();
        }
    } else {
        // Stop and send audio
        status.classList.remove("listening");
        status.textContent = "⏳ Processing speech...";
        speechText.textContent = "Transcribing original speech...";
        stsOutput.textContent = "Translating and synthesizing...";

        const audioBlob = recorder.stop();
        resetStsUI();

        if (!audioBlob) {
            speechText.textContent = "Error: No audio recorded.";
            stsOutput.textContent = "";
            return;
        }

        // Upload audio blob to backend
        const formData = new FormData();
        formData.append("audio", audioBlob, "speech.wav");
        formData.append("source_lang", sourceLang);
        formData.append("target_lang", targetLang);

        try {
            const response = await fetch("/api/sts/", {
                method: "POST",
                body: formData
            });
            const data = await response.json();

            if (response.ok) {
                speechText.classList.remove("empty");
                speechText.textContent = data.original_text;

                stsOutput.classList.remove("empty");
                stsOutput.textContent = data.translated_text;

                if (data.audio) {
                    currentStsAudio = "data:audio/mp3;base64," + data.audio;
                    replayBtn.disabled = false;
                    playStsAudio();
                }
            } else {
                speechText.textContent = `Error: ${data.error || "Failed to process"}`;
                stsOutput.textContent = "";
            }
        } catch (error) {
            console.error("STS Upload error:", error);
            speechText.textContent = "Network error: Could not reach the server.";
            stsOutput.textContent = "";
        }
    }
}

async function playStsAudio() {
    if (!currentStsAudio) return;

    const status = document.getElementById("stsStatus");
    const panda = document.getElementById("sts-panda");
    
    status.classList.remove("hidden");
    status.classList.add("playing");
    status.textContent = "🔊 Playing Translation...";
    
    if (panda) {
        panda.classList.add("speaking");
    }

    try {
        const audio = new Audio(currentStsAudio);
        audio.onended = () => {
            status.classList.add("hidden");
            if (panda) {
                panda.classList.remove("speaking");
            }
        };
        await audio.play();
    } catch (e) {
        console.error("Playback failed:", e);
        status.classList.add("hidden");
        if (panda) {
            panda.classList.remove("speaking");
        }
    }
}

async function loadLanguages() {
    try {
        const response = await fetch('/api/languages/');
        const data = await response.json();
        
        if (response.ok) {
            populateSelect("textSourceLang", data.text, "auto", "Auto-Detect");
            populateSelect("textTargetLang", data.text, "en");
            
            populateSelect("ttsLang", data.speech, "en");
            
            populateSelect("sttLang", data.speech, "en");
            populateSelect("sttTargetLang", data.speech, "en");
            
            populateSelect("stsSourceLang", data.speech, "en");
            populateSelect("stsTargetLang", data.speech, "es");
        } else {
            console.error("Failed to load languages:", data.error);
        }
    } catch (error) {
        console.error("Error loading languages:", error);
    }
}

const flagMap = {
    'en': '🇺🇸',
    'es': '🇪🇸',
    'fr': '🇫🇷',
    'de': '🇩🇪',
    'hi': '🇮🇳',
    'ja': '🇯🇵',
    'zh': '🇨🇳',
    'it': '🇮🇹',
    'ar': '🇸🇦',
    'ru': '🇷🇺',
    'pt': '🇵🇹',
    'ko': '🇰🇷',
    'nl': '🇳🇱',
    'pl': '🇵🇱',
    'tr': '🇹🇷',
    'sv': '🇸🇪',
    'vi': '🇻🇳',
    'th': '🇹🇭',
    'el': '🇬🇷',
    'uk': '🇺🇦',
    'he': '🇮🇱',
    'iw': '🇮🇱',
    'id': '🇮🇩',
    'ms': '🇲🇾',
    'da': '🇩🇰',
    'fi': '🇫🇮',
    'no': '🇳🇴',
    'cs': '🇨🇿',
    'hu': '🇭🇺',
    'ro': '🇷🇴',
    'sk': '🇸🇰',
    'bg': '🇧🇬',
    'hr': '🇭🇷',
    'sr': '🇷🇸',
    'lt': '🇱🇹',
    'lv': '🇱🇻',
    'et': '🇪🇪',
    'sl': '🇸🇮',
    'sq': '🇦🇱',
    'mk': '🇲🇰',
    'is': '🇮🇸',
    'ga': '🇮🇪',
    'cy': '🇬🇧',
    'mt': '🇲🇹',
    'af': '🇿🇦',
    'sw': '🇰🇪',
    'tl': '🇵🇭',
    'ca': '🇪🇸',
    'gl': '🇪🇸',
    'eu': '🇪🇸',
    'fa': '🇮🇷',
    'ur': '🇵🇰',
    'bn': '🇧🇩',
    'ta': '🇮🇳',
    'te': '🇮🇳',
    'kn': '🇮🇳',
    'ml': '🇮🇳',
    'gu': '🇮🇳',
    'mr': '🇮🇳',
    'pa': '🇮🇳',
    'si': '🇱🇰',
    'ne': '🇳🇵',
    'my': '🇲🇲',
    'km': '🇰🇭',
    'la': '🇻🇦',
    'am': '🇪🇹',
    'ha': '🇳🇬',
    'su': '🇮🇩',
    'jw': '🇮🇩'
};

function getLanguageFlag(code) {
    if (!code) return '🏳️';
    const cleanCode = code.split('-')[0].toLowerCase();
    return flagMap[cleanCode] || '🏳️';
}

function populateSelect(selectId, languages, defaultValue, autoOptionText = null) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    select.innerHTML = "";
    
    if (autoOptionText) {
        const opt = document.createElement("option");
        opt.value = "auto";
        opt.textContent = `🌍 ${autoOptionText}`;
        if (defaultValue === "auto") {
            opt.selected = true;
        }
        select.appendChild(opt);
    }
    
    // Sort languages alphabetically by their display name
    const sortedLangs = Object.entries(languages).sort((a, b) => a[1].localeCompare(b[1]));
    
    sortedLangs.forEach(([code, name]) => {
        const opt = document.createElement("option");
        opt.value = code;
        const flag = getLanguageFlag(code);
        opt.textContent = `${flag} ${name}`;
        if (code === defaultValue) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

function initFlagSelectors() {
    document.querySelectorAll('.flag-selector-grid').forEach((grid) => {
        const selectId = grid.nextElementSibling.id;
        const selectEl = document.getElementById(selectId);
        
        grid.querySelectorAll('.flag-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                grid.querySelectorAll('.flag-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const langCode = btn.getAttribute('data-lang');
                
                // Ensure value exists in underlying select dropdown
                let exists = false;
                for (let i = 0; i < selectEl.options.length; i++) {
                    if (selectEl.options[i].value === langCode) {
                        exists = true;
                        break;
                    }
                }
                
                if (!exists) {
                    const opt = document.createElement('option');
                    opt.value = langCode;
                    opt.textContent = btn.textContent.replace(/[^\w\s-]/g, '').trim();
                    selectEl.appendChild(opt);
                }
                
                selectEl.value = langCode;
                
                // Auto translate in Text-Text if input text is filled
                if (grid.id === 'flag-dest-text' || grid.id === 'flag-src-text') {
                    const textVal = document.getElementById('textInput').value.trim();
                    if (textVal) {
                        translateText();
                    }
                }
            });
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    loadLanguages();
    initFlagSelectors();
});