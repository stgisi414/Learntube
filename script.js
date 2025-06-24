document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // --- CORE STATE & UI REFERENCES ---
    // =================================================================================
    let currentLessonPlan = null;
    let currentLearningPath = null;
    let currentSegmentIndex = -1;
    let lessonState = 'idle'; // 'idle', 'narrating', 'choosing_video', 'searching_videos', 'generating_segments', 'playing_video', 'paused', 'quiz', 'summary', 'complete'
    let currentVideoChoices = [];
    let currentTranscript = null;
    let currentSegments = [];
    let currentSegmentPlayIndex = 0;

    const ui = {
        topicInput: document.getElementById('topic-input'),
        curateButton: document.getElementById('curate-button'),
        inputSection: document.getElementById('input-section'),
        loadingIndicator: document.getElementById('loading-indicator'),
        loadingMessage: document.getElementById('loading-message'),
        levelSelection: document.getElementById('level-selection'),
        levelButtonsContainer: document.getElementById('level-buttons-container'),
        learningCanvasContainer: document.getElementById('learning-canvas-container'),
        lessonProgressContainer: document.getElementById('lesson-progress-container'),
        canvas: document.getElementById('lessonCanvas'),
        playPauseButton: document.getElementById('play-pause-button'),
        lessonControls: document.getElementById('lesson-controls'),
        playIcon: document.getElementById('play-icon'),
        pauseIcon: document.getElementById('pause-icon'),
        nextSegmentButton: document.getElementById('next-segment-button'),
        skipVideoButton: document.getElementById('skip-video-button'),
        currentTopicDisplay: document.getElementById('current-topic-display'),
        segmentProgress: document.getElementById('segment-progress'),
        segmentProgressText: document.getElementById('segment-progress-text'),
        errorDisplay: document.getElementById('error-display'),
        errorMessage: document.getElementById('error-message'),
        headerDescription: document.querySelector('.header-description'),
        headerFeatures: document.querySelector('.header-features'),
        youtubePlayerContainer: document.getElementById('youtube-player-container'),
    };
    const canvasCtx = ui.canvas.getContext('2d');

    // =================================================================================
    // --- API & CONFIGURATION ---
    // =================================================================================
    const GEMINI_API_KEY = "AIzaSyAo4mWr5x3UPEACzFC3_6W0bd1DG8dCudA";
    const YOUTUBE_API_KEY = "AIzaSyDbxmMIxsnVWW16iHrVrq1kNe9KTTSpNH4";
    const CSE_ID = "b53121b78d1c64563";
    const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
    const SUPADATA_API_KEY = "sd_1d4e0e4e3d5aecda115fc39d1d47a33b";

    const log = (message, ...args) => console.log(`[${new Date().toLocaleTimeString()}] ${message}`, ...args);
    const logError = (message, ...args) => console.error(`[${new Date().toLocaleTimeString()}] ERROR: ${message}`, ...args);

    // =================================================================================
    // --- CLASS DEFINITIONS (MERGED) ---
    // =================================================================================

    class GeminiOrchestrator {
        constructor() { this.requestQueue = []; this.isProcessing = false; this.rateLimitDelay = 1000; }
        async makeRequest(prompt, options = {}) { return new Promise((resolve, reject) => { this.requestQueue.push({ prompt, options, resolve, reject }); if (!this.isProcessing) this.processQueue(); }); }
        async processQueue() { if (this.requestQueue.length === 0) { this.isProcessing = false; return; } this.isProcessing = true; const { prompt, options, resolve, reject } = this.requestQueue.shift(); try { await new Promise(r => setTimeout(r, this.rateLimitDelay)); const result = await this.executeSingleRequest(prompt, options); resolve(result); } catch (error) { reject(error); } finally { this.processQueue(); } }
        async executeSingleRequest(prompt, options = {}) { 
            const defaultConfig = { temperature: 0.7, maxOutputTokens: 2048, ...options };
            const requestBody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: defaultConfig, safetySettings: [ { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" } ] };
            const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
            if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error(`Gemini API failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`); }
            const data = await response.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!content) { log('Gemini response data:', data); throw new Error('No content in Gemini response'); }
            return content.trim();
        }
        parseJSONResponse(response) { if (!response) return null; try { let cleanedResponse = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, ''); const jsonMatch = cleanedResponse.match(/(\{[\s\S]*\}|\[[\s\S]*\])/); if (jsonMatch) { return JSON.parse(jsonMatch[0]); } logError(`No valid JSON found in response:`, response); return null; } catch (error) { logError(`Failed to parse JSON:`, error, `Raw response: "${response}"`); return null; } }

        // =========================================================================
        // --- V4 ARCHITECTURE: CONTEXT-AWARE CONTENT GENERATION (SURGICALLY INSERTED) ---
        // =========================================================================

        async generateLessonPlan(topic) {
            log("GEMINI (V4 Architecture): Generating lesson plan for:", topic);

            const brainstormKeywords = async (topicForBrainstorm) => {
                log("GEMINI (V4): Step 1 - Brainstorming keywords for:", topicForBrainstorm);
                const prompt = `You are a curriculum research assistant. Your task is to analyze the user's topic and extract a list of essential, specific keywords that capture the core concepts and any cultural or linguistic context.
                Topic: "${topicForBrainstorm}"
                Instructions:
                1. Identify the primary subject (e.g., "onomatopoeia").
                2. Identify any specific language or cultural context (e.g., "Korean").
                3. List 5-10 highly relevant sub-topics, technical terms, or cultural examples.
                4. Output ONLY a comma-separated list of these keywords.
                Example for "Korean Onomatopoeia": Keywords: 의성어 (uiseongeo), 의태어 (uitaeeo), sound symbolism, webtoons, K-dramas, mimetic words, phonetic aesthetics
                Topic: "${topicForBrainstorm}"
                Keywords:`;
                try {
                    const response = await this.makeRequest(prompt, { temperature: 0.2 });
                    if (typeof response === 'string' && response.length > 10) {
                        log("GEMINI (V4): Brainstormed keywords:", response);
                        return response.split(',').map(k => k.trim());
                    }
                    throw new Error("Brainstorming returned invalid keyword format.");
                } catch (error) {
                    logError("GEMINI (V4): Keyword brainstorming failed. Falling back to topic words.", error);
                    return topicForBrainstorm.split(' '); 
                }
            };

            const createPlanFromKeywords = (topic, keywords) => {
                log("Code Architecture: Step 2 - Building lesson plan template from keywords.");
                const usedKeywords = new Set();
                const pickKeyword = () => {
                    const available = keywords.filter(k => !usedKeywords.has(k) && k.toLowerCase() !== topic.toLowerCase());
                    if (available.length === 0) return keywords[Math.floor(Math.random() * keywords.length)] || '';
                    const keyword = available[0]; usedKeywords.add(keyword);
                    return keyword;
                };
                const apprenticePoints = [ `Introduction to ${topic}: Understanding the Core Concepts`, `Exploring a key aspect of ${topic}: ${pickKeyword()}`, `Practical application of ${topic}` ];
                const journeymanPoints = [ ...apprenticePoints, `Advanced topic in ${topic}: The role of ${pickKeyword()}`, `Comparing and contrasting different elements of ${topic}` ];
                const seniorPoints = [ ...journeymanPoints, `The historical context and evolution of ${topic}`, `Analyzing the impact of ${pickKeyword()} on ${topic}` ];
                const masterPoints = [ ...seniorPoints, `Expert-level analysis: The intersection of ${topic} and ${pickKeyword()}`, `Synthesizing knowledge of ${topic} for creative application` ];
                const lessonPlan = { "Apprentice": apprenticePoints, "Journeyman": journeymanPoints, "Senior": seniorPoints, "Master": masterPoints };
                log("Code Architecture: Lesson plan template created successfully.");
                return lessonPlan;
            };

            try {
                const brainstormedKeywords = await brainstormKeywords(topic);
                const finalLessonPlan = createPlanFromKeywords(topic, brainstormedKeywords);
                return finalLessonPlan;
            } catch (error) {
                logError("generateLessonPlan (V4) failed. Returning null.", error);
                return null;
            }
        }
        
        async generateNarration(learningPoint, previousPoint, mainTopic) {
            log(`GEMINI: Generating narration for "${learningPoint}"`);
            const coreConcept = learningPoint.replace(/\s*\(e\.g\..*\)/i, '').trim();
            const prompt = `You are a curriculum narrator. Your task is to create a simple, 1-2 sentence narration.
            - Main Lesson Topic: "${mainTopic}"
            - Previous Learning Point: "${previousPoint || 'None'}"
            - Core Concept to Explain: "${coreConcept}"
            - Full Learning Point (for context): "${learningPoint}"
            Instructions: Your narration must be about the Core Concept, framed within the Main Lesson Topic. Keep it friendly and educational. Return only the text.`;
            return await this.makeRequest(prompt, { temperature: 0.5, maxOutputTokens: 256 });
        }

        async generateSearchQueries(learningPoint, mainTopic) {
            log(`GEMINI: Generating search queries for "${learningPoint}"`);
            const getForbiddenTerms = (topic) => {
                const topicLower = topic.toLowerCase();
                if (topicLower.includes('korean') && topicLower.includes('onomatopoeia')) { return ['music production', 'sound design', 'audio editing', 'daw', 'sfx']; }
                return [];
            };
            const forbiddenTerms = getForbiddenTerms(mainTopic);
            const prompt = `Generate 3-5 Youtube queries for a video about: "${learningPoint}". The overall lesson topic is: "${mainTopic}".
            CRITICAL INSTRUCTIONS:
            1. SPECIFICITY: Queries must be specific to "${learningPoint}" and reflect "${mainTopic}".
            2. CONTENT TYPE: Target educational content like tutorials or explanations.
            ${forbiddenTerms.length > 0 ? `3. NEGATIVE KEYWORDS: AVOID terms like: "${forbiddenTerms.join('", "')}".` : ''}
            Return ONLY a valid JSON array of strings.`;
            const response = await this.makeRequest(prompt, { temperature: 0.25 });
            return this.parseJSONResponse(response);
        }

        async checkVideoRelevance(videoTitle, learningPoint, mainTopic, transcript = null) {
            log(`RELEVANCE V4: Analyzing "${videoTitle}" for "${learningPoint}"`);
            const extractKeywords = (topic) => {
                const text = topic.toLowerCase();
                const languages = ['korean', 'japanese', 'chinese', 'spanish', 'french', 'german', 'italian'];
                const subjects = { onomatopoeia: ['onomatopoeia', 'sound words'], history: ['history', 'historical'] };
                const forbidden = { onomatopoeia: ['music production', 'sound design', 'sfx'] };
                const detectedLang = languages.find(lang => text.includes(lang)) || null;
                const detectedSubj = Object.keys(subjects).find(subj => subjects[subj].some(kw => text.includes(kw))) || null;
                return { lang: detectedLang, subj: detectedSubj, forbidden: detectedSubj ? (forbidden[detectedSubj] || []) : [] };
            };
            const keywords = extractKeywords(mainTopic + ' ' + learningPoint);
            const titleLower = videoTitle.toLowerCase();

            if (keywords.forbidden.some(term => titleLower.includes(term))) { log(`RELEVANCE V4 REJECT (PRE-FILTER): Forbidden term.`); return { relevant: false }; }
            if (keywords.lang && !titleLower.includes(keywords.lang)) { log(`RELEVANCE V4 REJECT (PRE-FILTER): Language missing.`); return { relevant: false }; }
            
            const prompt = `You are a Strict Educational Content Validator. Is the YouTube video "${videoTitle}" DIRECTLY relevant for learning about "${learningPoint}" (main topic: "${mainTopic}")?
            ${transcript ? `Transcript Snippet: "${transcript.substring(0, 1500)}"` : `(No transcript)`}
            CRITICAL: If the topic requires a specific language (e.g., Korean), a generic video is NOT relevant.
            Return JSON: {"isRelevant": boolean, "confidenceScore": number, "reasoning": "...", "identifiedLanguageFocus": "e.g., korean, english"}`;
            const aiResult = await this.makeRequest(prompt, { temperature: 0.1 }).then(this.parseJSONResponse);

            if (!aiResult?.isRelevant || aiResult.confidenceScore < 7) { log(`RELEVANCE V4 REJECT (AI)`); return { relevant: false }; }
            if (keywords.lang && aiResult.identifiedLanguageFocus && !aiResult.identifiedLanguageFocus.toLowerCase().includes(keywords.lang)) { log(`RELEVANCE V4 REJECT (AI): Language mismatch.`); return { relevant: false }; }
            
            log(`RELEVANCE V4 ACCEPT: "${videoTitle}"`);
            return { relevant: true, confidence: aiResult.confidenceScore };
        }
        
        async findVideoSegments(videoTitle, learningPoint, transcript = null) {
            log(`SEGMENTER: Analyzing video for "${learningPoint}"`);
            const prompt = `You are a video analyst. For a video titled "${videoTitle}", find the most relevant segments for the topic: "${learningPoint}".
            ${transcript ? `Use this transcript:\n"${transcript.substring(0, 5000)}"` : `(No transcript available)`}
            Find 1-3 key segments, each 30-180 seconds. Return JSON array: [{"startTime": 45, "endTime": 135, "reason": "..."}]`;
            const response = await this.makeRequest(prompt, { temperature: 0.2 });
            const segments = this.parseJSONResponse(response);
            if (Array.isArray(segments) && segments.length > 0 && segments[0].startTime !== undefined) { return segments; }
            return [{ startTime: 30, endTime: 180, reason: "Main educational content (fallback)" }];
        }
        async generateConcludingNarration(learningPoint, mainTopic) { return await this.generateNarration(learningPoint, `We just finished watching a video about ${learningPoint}`, mainTopic); }
        async generateDetailedExplanation(learningPoint) { const prompt = `Create a comprehensive, educational explanation about "${learningPoint}" (150-250 words). Return ONLY the explanation text.`; return await this.makeRequest(prompt); }
        async generateQuiz(learningPoint) { const prompt = `Create a single multiple-choice quiz about "${learningPoint}". Return JSON: {"question": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}`; return await this.makeRequest(prompt).then(this.parseJSONResponse); }
        async generateLessonSummary(topic, learningPoints) { const prompt = `Generate a brief, encouraging summary for a lesson on "${topic}". Covered points: ${learningPoints.join(', ')}. Return markdown bullet points.`; return await this.makeRequest(prompt); }
    }

    class VideoSourcer {
        async searchYouTube(query) {
            log(`SEARCH: Using Custom Search for: "${query}"`);
            const searchParams = new URLSearchParams({ key: YOUTUBE_API_KEY, cx: CSE_ID, q: query, num: 10 });
            try {
                const response = await fetch(`https://www.googleapis.com/customsearch/v1?${searchParams}`);
                if (!response.ok) throw new Error(`Search failed: ${response.status}`);
                const data = await response.json();
                return this.processSearchResults(data);
            } catch (error) { logError(`SEARCH: Error for "${query}":`, error); return []; }
        }
        async getVideoTranscript(youtubeId) {
            log(`TRANSCRIPT: Fetching for ${youtubeId}`);
            const SUPADATA_API_KEY = "sd_1d4e0e4e3d5aecda115fc39d1d47a33b";
            if (!SUPADATA_API_KEY || SUPADATA_API_KEY === "sd_1d4e0e4e3d5aecda115fc39d1d47a33b") {
                log(`TRANSCRIPT: No API key available, skipping transcript for ${youtubeId}`);
                return null;
            }
            try {
                const apiUrl = `https://api.supadata.ai/v1/transcript?video_id=${youtubeId}`;
                const response = await fetch(apiUrl, { 
                    method: 'GET',
                    headers: { 
                        'x-api-key': SUPADATA_API_KEY,
                        'Content-Type': 'application/json'
                    } 
                });
                if (!response.ok) { 
                    log(`TRANSCRIPT: API failed for ${youtubeId}: ${response.status}`); 
                    if (response.status === 401) {
                        log(`TRANSCRIPT: Invalid or expired API key`);
                    }
                    return null; 
                }
                const data = await response.json();
                if (data && Array.isArray(data.transcript)) { return data.transcript.map(item => item.text || '').join(' '); }
                return null;
            } catch (error) { logError(`TRANSCRIPT: Fetch error for ${youtubeId}:`, error); return null; }
        }
        processSearchResults(data) {
            if (!data.items) return [];
            return data.items.map(item => {
                const videoIdMatch = (item.link || '').match(/(?:watch\?v=)([a-zA-Z0-9_-]{11})/);
                if (videoIdMatch) return { youtubeId: videoIdMatch[1], title: item.title };
                return null;
            }).filter(Boolean);
        }
    }
    
    // Using your original, full SpeechEngine with multilingual support
    class SpeechEngine {
        constructor() { 
            this.apiKey = "AIzaSyA43RRVypjAAXwYdpKrojWVmdRAGyLKwr8"; 
            this.apiUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize'; 
            this.onCompleteCallback = null; this.onProgressCallback = null; 
            this.isPaused = false; this.isPlaying = false;
            this.audioQueue = []; this.currentAudioIndex = 0; this.startTime = null;
        }
        detectLanguage(text) { const patterns = [ { lang: 'ko', pattern: /[\u3131-\u3163\uac00-\ud7a3]/g }, { lang: 'ja', pattern: /[\u3040-\u309f\u30a0-\u30ff]/g }, { lang: 'zh', pattern: /[\u4e00-\u9fff]/g } ]; for (const {lang, pattern} of patterns) { if (pattern.test(text)) return lang; } return 'en'; }
        getVoiceConfig(languageCode) {
            const voices = { 'ko': { languageCode: 'ko-KR', name: 'ko-KR-Standard-C' }, 'ja': { languageCode: 'ja-JP', name: 'ja-JP-Standard-B' }, 'zh': { languageCode: 'zh-CN', name: 'zh-CN-Standard-A' }, 'en': { languageCode: 'en-US', name: 'en-US-Standard-H' } };
            return voices[languageCode] || voices['en'];
        }
        parseMultilingualText(text) {
            const segments = []; const langPattern = /\[LANG:(.*?)\](.*?)(?=\[LANG:|$)/g; let match; let lastIndex = 0;
            while ((match = langPattern.exec(text)) !== null) { if (lastIndex === 0 && match.index > 0) { const beforeText = text.substring(0, match.index).trim(); if (beforeText) segments.push({ text: beforeText, language: 'en' }); } const lang = match[1].toLowerCase(); const content = match[2].trim(); if (content) segments.push({ text: content, language: lang }); lastIndex = match.index + match[0].length; }
            if (segments.length === 0) { return this.smartLanguageSplit(text); } else { const remainingText = text.substring(lastIndex).trim(); if (remainingText) { segments.push({ text: remainingText, language: this.detectLanguage(remainingText) }); } }
            return segments.filter(segment => segment.text.length > 0);
        }
        smartLanguageSplit(text) {
            const segments = []; const sentences = text.match(/[^\.!?]+[\.!?]+/g) || [text];
            for (const sentence of sentences) { const cleanSentence = sentence.trim(); if (!cleanSentence) continue; const detectedLang = this.detectLanguage(cleanSentence); if (segments.length > 0 && segments[segments.length - 1].language === detectedLang) { segments[segments.length - 1].text += ' ' + cleanSentence; } else { segments.push({ text: cleanSentence, language: detectedLang }); } }
            if (segments.length === 0) { segments.push({ text: text.trim(), language: this.detectLanguage(text) }); }
            return segments;
        }
        async synthesizeSegment(text, languageCode) {
            const voiceConfig = this.getVoiceConfig(languageCode);
            const requestBody = { input: { text }, voice: voiceConfig, audioConfig: { audioEncoding: 'MP3' } };
            const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
            if (!response.ok) throw new Error(`Speech API failed for ${languageCode}`);
            const data = await response.json();
            return this.base64ToBlob(data.audioContent);
        }
        async play(text, { onProgress = null, onComplete = null } = {}) {
            this.stop(); if (!text) { if (onComplete) onComplete(); return; }
            this.onProgressCallback = onProgress; this.onCompleteCallback = onComplete; this.isPaused = false; this.isPlaying = true; this.startTime = Date.now();
            try {
                const segments = this.parseMultilingualText(text);
                const audioPromises = segments.map(segment => this.synthesizeSegment(segment.text, segment.language));
                const audioBlobs = await Promise.all(audioPromises);
                this.audioQueue = audioBlobs.map((blob, index) => { const audio = new Audio(); audio.src = URL.createObjectURL(blob); return { audio, segment: segments[index], duration: 0 }; });
                await this.loadAudioDurations();
                this.playCurrentSegment();
            } catch (error) { logError(`SPEECH: Multilingual synthesis error:`, error); this.fallbackTiming(text); }
        }
        async loadAudioDurations() { const loadPromises = this.audioQueue.map(item => new Promise(resolve => { const audio = item.audio; const onLoad = () => { item.duration = audio.duration || 2; audio.removeEventListener('loadedmetadata', onLoad); resolve(); }; audio.addEventListener('loadedmetadata', onLoad); setTimeout(() => { item.duration = item.duration || 2; resolve(); }, 3000); })); await Promise.all(loadPromises); }
        playCurrentSegment() {
            if (!this.isPlaying || this.currentAudioIndex >= this.audioQueue.length) { this.handlePlaybackComplete(); return; }
            const currentItem = this.audioQueue[this.currentAudioIndex];
            const audio = currentItem.audio;
            audio.onended = () => { this.currentAudioIndex++; this.playCurrentSegment(); };
            audio.onerror = () => { this.currentAudioIndex++; this.playCurrentSegment(); };
            audio.ontimeupdate = () => this.updateProgress();
            audio.play().catch(e => { logError(`Error playing segment`, e); this.currentAudioIndex++; this.playCurrentSegment(); });
        }
        updateProgress() {
            if (!this.onProgressCallback || this.audioQueue.length === 0) return;
            const totalDuration = this.audioQueue.reduce((sum, item) => sum + item.duration, 0);
            if (totalDuration === 0) return;
            let elapsedDuration = 0;
            for (let i = 0; i < this.currentAudioIndex; i++) { elapsedDuration += this.audioQueue[i].duration; }
            if (this.currentAudioIndex < this.audioQueue.length) { elapsedDuration += this.audioQueue[this.currentAudioIndex].audio.currentTime || 0; }
            this.onProgressCallback(Math.min(elapsedDuration / totalDuration, 1));
        }
        handlePlaybackComplete() { this.isPlaying = false; this.isPaused = false; if (this.onProgressCallback) this.onProgressCallback(1); if (this.onCompleteCallback) this.onCompleteCallback(); }
        fallbackTiming(text) { const estimatedDuration = Math.max(3000, text.length * 80); if (this.onProgressCallback) { const interval = setInterval(() => { if (!this.isPlaying) { clearInterval(interval); return; } const progress = Math.min((Date.now() - this.startTime) / estimatedDuration, 1); this.onProgressCallback(progress); if (progress >= 1) clearInterval(interval); }, 100); } setTimeout(() => { if (this.isPlaying && this.onCompleteCallback) this.handlePlaybackComplete(); }, estimatedDuration); }
        pause() { if (this.isPlaying && !this.isPaused && this.audioQueue[this.currentAudioIndex]) { this.audioQueue[this.currentAudioIndex].audio.pause(); this.isPaused = true; } }
        resume() { if (this.isPaused && this.isPlaying && this.audioQueue[this.currentAudioIndex]) { this.audioQueue[this.currentAudioIndex].audio.play().catch(e => logError(`Resume error:`, e)); this.isPaused = false; } }
        stop() { this.isPlaying = false; this.isPaused = false; this.audioQueue.forEach(item => { try { item.audio.pause(); item.audio.currentTime = 0; if (item.audio.src) URL.revokeObjectURL(item.audio.src); } catch (e) {} }); this.audioQueue = []; this.currentAudioIndex = 0; }
        base64ToBlob(base64) { const byteCharacters = atob(base64); const byteArrays = []; for (let offset = 0; offset < byteCharacters.length; offset += 512) { const slice = byteCharacters.slice(offset, offset + 512); const byteNumbers = new Array(slice.length); for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i); byteArrays.push(new Uint8Array(byteNumbers)); } return new Blob(byteArrays, { type: 'audio/mpeg' }); }
    }

    // Using your original, full LearningPipeline and UI functions
    class LearningPipeline {
        constructor() { this.gemini = new GeminiOrchestrator(); this.videoSourcer = new VideoSourcer(); this.speechEngine = new SpeechEngine(); this.youtubePlayer = null; }

        async start(topic) {
            log("FLOW: Step 1 - Generate lesson plan");
            showLoading("Generating comprehensive lesson plan...");
            const plan = await this.gemini.generateLessonPlan(topic);
            hideLoading();
            if (plan && plan.Apprentice) {
                currentLessonPlan = { ...plan, topic };
                displayLevelSelection();
            } else {
                displayError("Failed to generate a valid lesson plan. Please try again.");
                ui.curateButton.disabled = false;
            }
        }

        startLevel(level) {
            log("FLOW: Starting level", level);
            currentLearningPath = level;
            currentSegmentIndex = -1;
            ui.levelSelection.classList.add('hidden');
            ui.lessonProgressContainer.classList.remove('hidden');
            ui.learningCanvasContainer.classList.remove('hidden');
            document.querySelector('header').classList.add('content-hidden');
            this.processNextLearningPoint();
        }

        async processNextLearningPoint() {
            if (currentSegmentIndex >= currentLessonPlan[currentLearningPath].length - 1) {
                this.showLessonSummary();
                return;
            }
            currentSegmentIndex++;
            const learningPoints = currentLessonPlan[currentLearningPath];
            const learningPoint = learningPoints[currentSegmentIndex];
            const previousPoint = currentSegmentIndex > 0 ? learningPoints[currentSegmentIndex - 1] : null;
            updateSegmentProgress();
            ui.currentTopicDisplay.textContent = learningPoint;
            await this.playNarration(learningPoint, previousPoint, () => this.searchVideos(learningPoint));
        }

        async playNarration(learningPoint, previousPoint, onComplete) {
            log("FLOW: Play intro narration");
            updateStatus('narrating');
            updatePlayPauseIcon();
            ui.nextSegmentButton.disabled = true;

            try {
                const narrationText = await this.gemini.generateNarration(learningPoint, previousPoint, currentLessonPlan.topic);
                if (!narrationText) { onComplete(); return; }
                displayTextContent(narrationText);
                await new Promise((resolve) => {
                    this.speechEngine.play(narrationText, {
                        onProgress: (progress) => { if (lessonState === 'narrating') animateTextProgress(narrationText, progress); },
                        onComplete: () => { if (lessonState === 'narrating') resolve(); }
                    });
                });
                if (lessonState === 'narrating') onComplete();
            } catch (error) { logError("NARRATION: Error during playback", error); onComplete(); }
        }

        async playConcludingNarration(learningPoint) {
            log("FLOW: Play concluding narration");
            updateStatus('narrating');
            updatePlayPauseIcon();
            const narrationText = await this.gemini.generateConcludingNarration(learningPoint, currentLessonPlan.topic);
            if (!narrationText) return;
            showTextDisplay();
            displayTextContent(narrationText);
            await new Promise(resolve => this.speechEngine.play(narrationText, { onComplete: resolve }));
        }

        async searchVideos(learningPoint) {
            log("FLOW: Step 2 - Search videos");
            updateStatus('searching_videos');
            displayStatusMessage('🔎 Finding educational content...', `Searching for: "${learningPoint}"`);
            try {
                const searchQueries = await this.gemini.generateSearchQueries(learningPoint, currentLessonPlan.topic);
                if (!searchQueries || searchQueries.length === 0) throw new Error("No queries.");
                let allVideos = [];
                for (const query of searchQueries.slice(0, 2)) { allVideos.push(...await this.videoSourcer.searchYouTube(query)); }
                if (allVideos.length === 0) { await this.createFallbackContent(learningPoint); return; }

                displayStatusMessage('🎯 Filtering relevant content...', `Analyzing videos...`);
                const uniqueVideos = [...new Map(allVideos.map(v => [v.youtubeId, v])).values()];
                const relevantVideos = [];
                for (const video of uniqueVideos.slice(0, 5)) {
                    const transcript = await this.videoSourcer.getVideoTranscript(video.youtubeId);
                    const relevance = await this.gemini.checkVideoRelevance(video.title, learningPoint, currentLessonPlan.topic, transcript);
                    if (relevance.relevant) { relevantVideos.push({ ...video, transcript, confidence: relevance.confidence }); }
                }

                if (relevantVideos.length === 0) { await this.createFallbackContent(learningPoint); return; }
                relevantVideos.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
                this.generateSegments(relevantVideos[0]);
            } catch (error) { logError('Video search failed:', error); await this.createFallbackContent(learningPoint); }
        }

        async createFallbackContent(learningPoint) {
            log("FLOW: Creating fallback content");
            updateStatus('generating_segments');
            displayStatusMessage('🤖 Creating custom content...', 'No suitable videos found.');
            const explanation = await this.gemini.generateDetailedExplanation(learningPoint);
            if (explanation) {
                displayTextContent(explanation);
                await this.speechEngine.play(explanation, {
                    onProgress: animateTextProgress,
                    onComplete: () => { if (lessonState === 'generating_segments') this.showQuiz(); }
                });
            } else {
                displayStatusMessage('⏭️ Skipping segment', 'Could not generate content.');
                setTimeout(() => this.processNextLearningPoint(), 2000);
            }
        }

        async generateSegments(video) {
            log("FLOW: Generate segments");
            updateStatus('generating_segments');
            displayStatusMessage('✂️ Finding best segments...', `Analyzing: "${video.title}"`);
            try {
                const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
                currentSegments = await this.gemini.findVideoSegments(video.title, learningPoint, video.transcript);
                this.playSegments(video);
            } catch (error) { logError('Failed to generate segments:', error); this.playSegments(video); }
        }

        playSegments(video) {
            log("FLOW: Play segments");
            updateStatus('playing_video');
            updatePlayPauseIcon();
            this.createYouTubePlayer(video);
        }

        createYouTubePlayer(videoInfo) {
            if (this.youtubePlayer) { try { this.youtubePlayer.destroy(); } catch (e) {} }
            hideTextDisplay();
            ui.skipVideoButton.style.display = 'block';
            currentSegments = currentSegments && currentSegments.length > 0 ? currentSegments : [{ startTime: 30, endTime: 180, reason: "Default segment" }];
            currentSegmentPlayIndex = 0;
            this.currentVideoInfo = videoInfo;
            this.playCurrentSegment();
        }

        playCurrentSegment() {
            if (currentSegmentPlayIndex >= currentSegments.length) { this.handleVideoEnd(); return; }
            const segment = currentSegments[currentSegmentPlayIndex];
            log(`Playing segment ${currentSegmentPlayIndex + 1}/${currentSegments.length}: ${segment.startTime}s - ${segment.endTime}s`);
            if (this.youtubePlayer) { try { this.youtubePlayer.destroy(); } catch (e) {} }
            if (this.segmentTimer) clearInterval(this.segmentTimer);
            const playerDivId = 'youtube-player-' + Date.now();
            ui.youtubePlayerContainer.innerHTML = `<div id="${playerDivId}" class="w-full h-full"></div>`;
            this.youtubePlayer = new YT.Player(playerDivId, {
                height: '100%', width: '100%', videoId: this.currentVideoInfo.youtubeId,
                playerVars: { autoplay: 1, controls: 1, rel: 0, start: segment.startTime, modestbranding: 1, iv_load_policy: 3 },
                events: { 'onReady': (e) => { e.target.playVideo(); this.startSegmentTimer(segment.endTime); }, 'onStateChange': (e) => { if (e.data === YT.PlayerState.ENDED) this.endCurrentSegment(); } }
            });
        }

        startSegmentTimer(endTime) {
            if (this.segmentTimer) clearInterval(this.segmentTimer);
            this.segmentTimer = setInterval(() => { if (this.youtubePlayer?.getCurrentTime() >= endTime) this.endCurrentSegment(); }, 1000);
        }

        endCurrentSegment() {
            if (this.segmentTimer) clearInterval(this.segmentTimer);
            currentSegmentPlayIndex++;
            this.playCurrentSegment();
        }

        async handleVideoEnd() {
            log('Video playbook finished');
            ui.skipVideoButton.style.display = 'none';
            if (this.youtubePlayer) { try { this.youtubePlayer.destroy(); } catch(e){} }
            showTextDisplay();
            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            displayStatusMessage('🎯 Wrapping up...', `Summarizing: "${learningPoint}"`);
            await this.playConcludingNarration(learningPoint);
            this.showQuiz();
        }

        async showQuiz() {
            log("FLOW: Show quiz");
            updateStatus('quiz');
            hideTextDisplay();
            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            const quiz = await this.gemini.generateQuiz(learningPoint);
            if (quiz?.question) { this.displayQuiz(quiz); } 
            else { logError("Failed to generate quiz."); this.processNextLearningPoint(); }
        }

        displayQuiz(quiz) {
            ui.youtubePlayerContainer.innerHTML = `<div class="p-6 md:p-8 text-white h-full flex flex-col justify-start"><div class="flex-grow flex flex-col justify-center max-w-3xl mx-auto w-full"><div class="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6 border border-white/20"><p class="text-xl lg:text-2xl leading-relaxed">${quiz.question}</p></div><div class="space-y-4 mb-6">${quiz.options.map((option, index) => `<button class="quiz-option w-full text-left p-4 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all" data-index="${index}"><span>${String.fromCharCode(65 + index)})</span> <span class="ml-3">${option}</span></button>`).join('')}</div><div id="quiz-result" class="hidden opacity-0 transition-opacity duration-500"><div id="quiz-explanation-container" class="border rounded-xl p-4 mb-4"><p id="quiz-explanation"></p></div><div class="text-center"><button id="continue-button" class="bg-green-600 hover:bg-green-700 px-8 py-3 rounded-xl font-semibold">Continue →</button></div></div></div></div>`;
            ui.youtubePlayerContainer.querySelectorAll('.quiz-option').forEach(option => {
                option.addEventListener('click', () => {
                    const selectedIndex = parseInt(option.dataset.index);
                    const isCorrect = selectedIndex === quiz.correct;
                    ui.youtubePlayerContainer.querySelectorAll('.quiz-option').forEach(opt => { opt.disabled = true; opt.classList.remove('bg-blue-600', 'hover:bg-blue-700'); if (parseInt(opt.dataset.index) === quiz.correct) opt.classList.add('bg-green-700'); });
                    if (!isCorrect) option.classList.add('bg-red-700');
                    const resultDiv = document.getElementById('quiz-result');
                    const explanationDiv = document.getElementById('quiz-explanation-container');
                    document.getElementById('quiz-explanation').textContent = quiz.explanation;
                    explanationDiv.className = `border rounded-xl p-4 mb-4 ${isCorrect ? 'bg-green-500/20 border-green-500/50' : 'bg-red-500/20 border-red-500/50'}`;
                    resultDiv.classList.remove('hidden');
                    setTimeout(() => resultDiv.classList.remove('opacity-0'), 10);
                    document.getElementById('continue-button').addEventListener('click', () => { ui.lessonControls.style.display = 'flex'; this.processNextLearningPoint(); });
                });
            });
        }

        async showLessonSummary() {
            log("FLOW: Show lesson summary");
            updateStatus('summary');
            hideTextDisplay();
            const summary = await this.gemini.generateLessonSummary(currentLessonPlan.topic, currentLessonPlan[currentLearningPath]);
            ui.youtubePlayerContainer.innerHTML = `<div class="p-8 text-white h-full flex flex-col justify-center items-center"><h2 class="text-4xl font-bold mb-4">Congratulations!</h2><p class="text-xl mb-8">You've completed the ${currentLearningPath} level.</p><div class="bg-white/10 p-6 rounded-xl">${summary.replace(/•/g, '<li class="ml-4">')}</div><button id="finish-lesson-button" class="mt-8 bg-purple-600 px-10 py-4 rounded-xl">Finish</button></div>`;
            document.getElementById('finish-lesson-button').addEventListener('click', resetUIState);
        }
    }

    // =================================================================================
    // --- UI & UTILITY FUNCTIONS (Your complete, original code) ---
    // =================================================================================

    function showTextDisplay() { ui.canvas.style.display = 'block'; ui.youtubePlayerContainer.style.display = 'none'; }
    function hideTextDisplay() { ui.canvas.style.display = 'none'; ui.youtubePlayerContainer.style.display = 'block'; }
    function displayTextContent(text) {
        if (!ui.canvas || !text) { log('TEXT DISPLAY: Missing canvas or text'); return; }
        showTextDisplay();
        const { width, height } = ui.canvas.parentElement.getBoundingClientRect();
        ui.canvas.width = width; ui.canvas.height = height;
        const ctx = canvasCtx;
        ctx.clearRect(0, 0, width, height);
        const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
        bgGradient.addColorStop(0, '#1e293b'); bgGradient.addColorStop(1, '#0f172a');
        ctx.fillStyle = bgGradient; ctx.fillRect(0, 0, width, height);
        const isMobile = width <= 768;
        const fontSize = isMobile ? Math.max(18, width / 25) : Math.max(28, width / 35);
        ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
        const lines = wrapText(ctx, text, width * 0.9);
        const lineHeight = fontSize * 1.5;
        const totalTextHeight = lines.length * lineHeight;
        let startY = (height / 2) - (totalTextHeight / 2) + (lineHeight / 2);
        lines.forEach((line, i) => ctx.fillText(line, width / 2, startY + (i * lineHeight)));
    }
    function animateTextProgress(fullText, progress) {
        if (!ui.canvas || !fullText) return;
        showTextDisplay();
        const { width, height } = ui.canvas.parentElement.getBoundingClientRect();
        ui.canvas.width = width; ui.canvas.height = height;
        const ctx = canvasCtx;
        ctx.clearRect(0, 0, width, height);
        const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
        bgGradient.addColorStop(0, '#1e293b'); bgGradient.addColorStop(1, '#0f172a');
        ctx.fillStyle = bgGradient; ctx.fillRect(0, 0, width, height);
        const isMobile = width <= 768;
        const fontSize = isMobile ? Math.max(18, width / 25) : Math.max(28, width / 35);
        const lineHeight = fontSize * 1.5;
        const maxWidth = width * 0.9;
        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const lines = wrapText(ctx, fullText, maxWidth);
        const totalTextHeight = lines.length * lineHeight;
        const scrollDistance = Math.max(0, totalTextHeight - height * 0.7);
        const currentScroll = progress * scrollDistance;
        let startY = (height / 2) - (totalTextHeight / 2) + (lineHeight / 2) - currentScroll;
        const charsToShow = fullText.length * progress;
        let charsDrawn = 0;
        lines.forEach((line, index) => {
            const lineY = startY + (index * lineHeight);
            if (lineY > -lineHeight && lineY < height + lineHeight) {
                const charsInLine = line.length; let textToDraw = '';
                if (charsDrawn + charsInLine < charsToShow) { textToDraw = line; } 
                else if (charsDrawn < charsToShow) { textToDraw = line.substring(0, charsToShow - charsDrawn); }
                ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.fillText(line, width / 2, lineY);
                if (textToDraw) { ctx.fillStyle = '#6ee7b7'; ctx.fillText(textToDraw, width / 2, lineY); }
                charsDrawn += charsInLine + 1;
            }
        });
    }
    function wrapText(context, text, maxWidth) {
        const words = text.split(' '); let lines = []; let currentLine = words[0] || '';
        for (let i = 1; i < words.length; i++) { const word = words[i]; const testLine = currentLine + ' ' + word; if (context.measureText(testLine).width > maxWidth && i > 0) { lines.push(currentLine); currentLine = word; } else { currentLine = testLine; } }
        lines.push(currentLine); return lines;
    }
    function displayStatusMessage(mainText, subText = '') { displayTextContent(`${mainText}${subText ? `\n\n${subText}` : ''}`); }
    const learningPipeline = new LearningPipeline();
    function updateStatus(state) { lessonState = state; log(`STATE: ${state}`); updatePlayPauseIcon(); }
    function initializeUI() {
        ui.curateButton.addEventListener('click', handleCurateClick);
        ui.playPauseButton.addEventListener('click', playPauseLesson);
        ui.nextSegmentButton.addEventListener('click', () => { if (!ui.nextSegmentButton.disabled) { learningPipeline.processNextLearningPoint(); } });
        ui.skipVideoButton.addEventListener('click', () => { if (lessonState === 'playing_video' || lessonState === 'paused') { if (learningPipeline.segmentTimer) clearInterval(learningPipeline.segmentTimer); learningPipeline.handleVideoEnd(); } });
        window.onYouTubeIframeAPIReady = () => { log("YouTube IFrame API is ready."); };
    }
    function playPauseLesson() {
        switch (lessonState) {
            case 'narrating': learningPipeline.speechEngine.pause(); updateStatus("paused"); break;
            case 'playing_video': learningPipeline.youtubePlayer?.pauseVideo(); updateStatus("paused"); break;
            case 'paused':
                if (learningPipeline.speechEngine.isPaused) { learningPipeline.speechEngine.resume(); updateStatus("narrating"); } 
                else if (learningPipeline.youtubePlayer) { learningPipeline.youtubePlayer.playVideo(); updateStatus("playing_video"); }
                break;
        }
    }
    function updatePlayPauseIcon() {
        const isPlaying = lessonState === 'playing_video' || lessonState === 'narrating';
        ui.playIcon.classList.toggle('hidden', isPlaying);
        ui.pauseIcon.classList.toggle('hidden', !isPlaying);
    }
    async function handleCurateClick() {
        const topic = ui.topicInput.value.trim();
        if (!topic) return;
        localStorage.setItem('lastTopic', topic);
        resetUIState(false);
        ui.curateButton.disabled = true;
        document.querySelector('header').classList.add('content-hidden');
        await learningPipeline.start(topic);
    }
    function displayLevelSelection() {
        ui.inputSection.classList.add('hidden');
        ui.levelButtonsContainer.innerHTML = '';
        const levels = Object.keys(currentLessonPlan).filter(k => k !== 'topic');
        levels.forEach(level => {
            const button = document.createElement('button');
            button.className = 'w-full p-6 rounded-xl transition-all transform hover:scale-105 shadow-lg bg-blue-600 hover:bg-blue-700 text-white';
            const segmentCount = currentLessonPlan[level]?.length || 'N/A';
            button.innerHTML = `<div class="text-2xl font-bold">${level}</div><div class="text-sm opacity-75">${segmentCount} segments</div>`;
            button.onclick = () => learningPipeline.startLevel(level);
            ui.levelButtonsContainer.appendChild(button);
        });
        ui.loadingIndicator.classList.add('hidden');
        ui.levelSelection.classList.remove('hidden');
    }
    function updateSegmentProgress() {
        const total = currentLessonPlan[currentLearningPath].length;
        const current = currentSegmentIndex + 1;
        ui.segmentProgress.style.width = `${(current / total) * 100}%`;
        ui.segmentProgressText.textContent = `${current}/${total}`;
    }
    function showLoading(message) { ui.inputSection.classList.add('hidden'); ui.levelSelection.classList.add('hidden'); ui.loadingMessage.textContent = message; ui.loadingIndicator.classList.remove('hidden'); }
    function hideLoading() { ui.loadingIndicator.classList.add('hidden'); }
    function resetUIState(fullReset = true) {
        log("Resetting UI state");
        if(learningPipeline?.speechEngine) learningPipeline.speechEngine.stop();
        if(learningPipeline?.youtubePlayer) { try { learningPipeline.youtubePlayer.destroy(); } catch(e){} }
        if (learningPipeline?.segmentTimer) clearInterval(learningPipeline.segmentTimer);
        ui.learningCanvasContainer.classList.add('hidden');
        ui.lessonProgressContainer.classList.add('hidden');
        ui.levelSelection.classList.add('hidden');
        document.querySelector('header').classList.remove('content-hidden');
        ui.inputSection.classList.remove('hidden');
        ui.curateButton.disabled = false;
        if (fullReset) { 
            ui.headerDescription.classList.remove('hidden');
            ui.headerFeatures.classList.remove('hidden');
        }
        currentLessonPlan = null; currentLearningPath = null; currentSegmentIndex = -1;
        updateStatus('idle');
    }
    function displayError(message) { logError(message); ui.errorMessage.textContent = message; ui.errorDisplay.classList.remove('hidden'); setTimeout(() => ui.errorDisplay.classList.add('hidden'), 5000); }
    initializeUI();
    if (localStorage.getItem('lastTopic')) { ui.topicInput.value = localStorage.getItem('lastTopic'); }
});