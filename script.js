document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // --- CORE STATE & UI REFERENCES ---
    // =================================================================================
    let currentLessonPlan = null;
    let currentLearningPath = null;
    let currentSegmentIndex = -1;
    let lessonState = 'idle'; // 'idle', 'narrating', 'choosing_video', 'searching_videos', 'generating_segments', 'playing_video', 'paused', 'quiz', 'summary', 'complete'
    let currentVideoChoices = [];
    let currentSegments = [];
    let currentSegmentPlayIndex = 0;

    const ui = {
        topicInput: document.getElementById('topic-input'),
        curateButton: document.getElementById('curate-button'),
        inputSection: document.getElementById('input-section'),
        loadingIndicator: document.getElementById('loading-indicator'),
        levelSelection: document.getElementById('level-selection'),
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
        youtubePlayerContainer: document.getElementById('youtube-player-container'),
        progressSpacer: document.getElementById('progress-spacer'),
        viewContainer: document.getElementById('view-container'),
    };
    const canvasCtx = ui.canvas.getContext('2d');

    // =================================================================================
    // --- API & CONFIGURATION ---
    // =================================================================================
    const GEMINI_API_KEY = "AIzaSyAo4mWr5x3UPEACzFC3_6W0bd1DG8dCudA";
    const YOUTUBE_API_KEY = "AIzaSyDbxmMIxsnVWW16iHrVrq1kNe9KTTSpNH4";
    const CSE_ID = 'b53121b78d1c64563';
    const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

    const log = (message, ...args) => console.log(`[${new Date().toLocaleTimeString()}] ${message}`, ...args);
    const logError = (message, ...args) => console.error(`[${new Date().toLocaleTimeString()}] ERROR: ${message}`, ...args);

    // =================================================================================
    // --- CLASS DEFINITIONS ---
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
            if (!content) { log('Gemini response data:', data); throw new Error('No content in Gemini response - content may have been blocked by safety filters'); }
            return content.trim();
        }
        parseJSONResponse(response) { 
            if (!response) {
                logError("Empty response received");
                return null; 
            }
            
            try { 
                // Clean up the response by removing markdown and extra whitespace
                let cleanedResponse = response.trim()
                    .replace(/```json\s*/g, '')
                    .replace(/```\s*/g, '')
                    .replace(/^\s*[\r\n]/gm, '');
                
                // Try to find JSON object or array
                const jsonMatch = cleanedResponse.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
                
                if (jsonMatch) { 
                    const parsed = JSON.parse(jsonMatch[0]);
                    
                    // Validate lesson plan structure if this is a lesson plan response
                    if (parsed.Apprentice && parsed.Journeyman && parsed.Senior && parsed.Master) {
                        if (Array.isArray(parsed.Apprentice) && Array.isArray(parsed.Journeyman) && 
                            Array.isArray(parsed.Senior) && Array.isArray(parsed.Master)) {
                            log("Valid lesson plan structure found");
                            return parsed;
                        } else {
                            logError("Lesson plan has invalid array structure");
                            return null;
                        }
                    }
                    
                    return parsed;
                } 
                
                logError(`No valid JSON found in response:`, response.substring(0, 200) + "...");
                return null; 
            } catch (error) { 
                logError(`Failed to parse JSON:`, error.message, `Raw response: "${response.substring(0, 200)}..."`); 
                return null; 
            } 
        }
        async generateLessonPlan(topic) {
            log("GEMINI: Generating lesson plan...");
            const prompt = `Create a comprehensive learning plan for "${topic}". 

IMPORTANT: Return ONLY valid JSON in this exact format:
{
  "Apprentice": [
    "topic 1",
    "topic 2", 
    "topic 3"
  ],
  "Journeyman": [
    "topic 1",
    "topic 2",
    "topic 3",
    "topic 4",
    "topic 5"
  ],
  "Senior": [
    "topic 1",
    "topic 2",
    "topic 3",
    "topic 4",
    "topic 5",
    "topic 6",
    "topic 7"
  ],
  "Master": [
    "topic 1",
    "topic 2",
    "topic 3",
    "topic 4",
    "topic 5",
    "topic 6",
    "topic 7",
    "topic 8",
    "topic 9"
  ]
}

Requirements:
- Apprentice level: 3 basic foundational topics
- Journeyman level: 5 intermediate topics building on basics
- Senior level: 7 advanced topics with deeper understanding
- Master level: 9 expert-level topics with cutting-edge concepts
- Each topic should be concise (3-8 words) and educational
- Topics should progress logically from basic to advanced
- NO markdown formatting, NO explanatory text, ONLY the JSON object`;
            const response = await this.makeRequest(prompt, { temperature: 0.3 });
            return this.parseJSONResponse(response);
        }
        async generateSearchQueries(learningPoint) {
            log(`GEMINI: Generating search queries for "${learningPoint}"`);
            const prompt = `Generate 3 highly specific Youtube queries for the learning topic: "${learningPoint}". The queries must target educational content like university lectures, detailed documentaries, or expert explanations. Avoid overly simplistic or general terms. Each query should be 3-7 words. Return ONLY a valid JSON array of strings. Example for "Mitochondria": ["mitochondria function cellular respiration lecture", "mitochondrion structure and function documentary", "ATP synthesis in mitochondria explanation"]`;
            const response = await this.makeRequest(prompt, { temperature: 0.4 });
            return this.parseJSONResponse(response);
        }
        async generateNarration(learningPoint, previousPoint) {
            log(`GEMINI: Generating narration for "${learningPoint}"`);
            let prompt = previousPoint ?
                `Write a simple 1-2 sentence transition. The previous topic was "${previousPoint}". Now we're learning about "${learningPoint}". Keep it simple and educational. Just return the text.` :
                `Write a simple 1-2 sentence welcome message for a lesson about "${learningPoint}". Keep it friendly and educational. Just return the text.`;
            return await this.makeRequest(prompt, { temperature: 0.5, maxOutputTokens: 256 });
        }
        async generateConcludingNarration(learningPoint) {
            log(`GEMINI: Generating concluding narration for "${learningPoint}"`);
            const prompt = `Write a short, 1-sentence concluding summary for the topic "${learningPoint}" that we just covered. This will play after the video or quiz. Keep it encouraging. Just return the text.`;
            return await this.makeRequest(prompt, { temperature: 0.6, maxOutputTokens: 256 });
        }
        async findVideoSegments(videoTitle, learningPoint) {
            log(`SEGMENTER: Analyzing YouTube video for "${learningPoint}"`);
            try {
                const prompt = `You are a video analyst. For a YouTube video titled "${videoTitle}", identify the most relevant segments for the learning topic: "${learningPoint}".
- Focus on the main educational content, skipping intros/outros.
- Identify 1-2 key segments, each 45-180 seconds long.
- Return ONLY a valid JSON array like: [{"startTime": 45, "endTime": 135, "reason": "Explanation of core concepts"}]
- If you can't determine specific segments, return one comprehensive segment: [{"startTime": 30, "endTime": 210, "reason": "Core educational content"}]`;
                const response = await this.makeRequest(prompt, { temperature: 0.3, maxOutputTokens: 1024 });
                const segments = this.parseJSONResponse(response);
                if (Array.isArray(segments) && segments.length > 0 && typeof segments[0].startTime === 'number') {
                    log(`SEGMENTER: Found ${segments.length} valid segments.`);
                    return segments;
                }
                log("SEGMENTER WARN: AI response invalid. Using fallback.");
                return [{ startTime: 30, endTime: 180, reason: "Main educational content (fallback)" }];
            } catch (error) {
                logError("SEGMENTER ERROR:", error);
                return [{ startTime: 30, endTime: 180, reason: "Main educational content (fallback)" }];
            }
        }
        async generateDetailedExplanation(learningPoint) {
            log(`GEMINI: Generating detailed explanation for "${learningPoint}"`);
            const prompt = `Create a comprehensive, educational explanation about "${learningPoint}" (150-250 words). Structure it as an engaging lesson covering: 1) What it is, 2) Why it's important, 3) Key concepts/examples. Write in a clear, teaching style. Return ONLY the explanation text.`;
            return await this.makeRequest(prompt, { temperature: 0.8, maxOutputTokens: 1024 });
        }
        async generateQuiz(learningPoint) {
            log(`GEMINI: Generating quiz for "${learningPoint}"`);
            const prompt = `Create a single multiple-choice quiz question about "${learningPoint}". The question should test understanding of a key concept. Return ONLY valid JSON with format: {"question": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}`;
            const response = await this.makeRequest(prompt, { temperature: 0.7 });
            return this.parseJSONResponse(response);
        }
        async generateLessonSummary(topic, learningPoints) {
            log(`GEMINI: Generating lesson summary for "${topic}"`);
            const prompt = `Generate a brief, encouraging summary for a lesson on "${topic}". The lesson covered these points: ${learningPoints.join(', ')}. Provide 3-5 bullet points highlighting the key takeaways. The tone should be positive and affirm the user's progress. Return ONLY the summary text in markdown format.`;
            return await this.makeRequest(prompt, { temperature: 0.6, maxOutputTokens: 1024 });
        }
    }

    class VideoSourcer {
        async searchYouTube(query) {
            log(`SEARCH: Using Custom Search for: "${query}"`);
            const searchParams = new URLSearchParams({ key: YOUTUBE_API_KEY, cx: CSE_ID, q: `${query} site:youtube.com`, num: 10, filter: '1' });
            try {
                const response = await fetch(`https://www.googleapis.com/customsearch/v1?${searchParams}`);
                if (!response.ok) throw new Error(`Search failed: ${response.status} ${await response.text()}`);
                const data = await response.json();
                return this.processSearchResults(data, query);
            } catch (error) {
                logError(`SEARCH: Error for "${query}":`, error);
                return [];
            }
        }
        processSearchResults(data, query) {
            if (!data.items || data.items.length === 0) { log(`SEARCH: No results found for "${query}"`); return []; }
            const results = data.items.map(item => {
                const videoIdMatch = item.link.match(/(?:watch\?v=)([a-zA-Z0-9_-]{11})/);
                const videoId = videoIdMatch ? videoIdMatch[1] : null;
                if (videoId) {
                    let score = 1;
                    const title = (item.title || '').toLowerCase();
                    if (title.includes('tutorial') || title.includes('explained') || title.includes('how to')) score += 3;
                    if (title.includes('course') || title.includes('lesson') || title.includes('learn')) score += 2;
                    if (title.includes('lecture') || title.includes('documentary')) score += 2;
                    return { youtubeId: videoId, title: item.title || 'Untitled', educationalScore: score };
                }
                return null;
            }).filter(item => item && item.youtubeId && item.youtubeId.length === 11);
            log(`SEARCH: Found ${results.length} valid videos for "${query}"`);
            return results;
        }
    }

    class SpeechEngine {
        constructor() { this.apiKey = "AIzaSyA43RRVypjAAXwYdpKrojWVmdRAGyLKwr8"; this.apiUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize'; this.audioElement = new Audio(); this.onCompleteCallback = null; this.onProgressCallback = null; this.isPaused = false; this.isPlaying = false; }
        async play(text, { onProgress = null, onComplete = null } = {}) { this.stop(); if (!text) { if (onComplete) onComplete(); return; } this.onProgressCallback = onProgress; this.onCompleteCallback = onComplete; this.isPaused = false; this.isPlaying = true; try { const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { text }, voice: { languageCode: 'en-US', name: 'en-US-Standard-C' }, audioConfig: { audioEncoding: 'MP3' } }) }); if (!response.ok) { throw new Error((await response.json()).error?.message || 'Speech API error'); } const data = await response.json(); const audioBlob = this.base64ToBlob(data.audioContent); this.audioElement.src = URL.createObjectURL(audioBlob); this.audioElement.onloadeddata = () => { if (this.isPlaying && !this.isPaused) this.audioElement.play().catch(e => log(`Audio play error: ${e}`)); }; this.audioElement.ontimeupdate = () => { if (this.onProgressCallback && this.audioElement.duration) this.onProgressCallback(this.audioElement.currentTime / this.audioElement.duration); }; this.audioElement.onended = () => { this.isPlaying = false; this.isPaused = false; if (this.onProgressCallback) this.onProgressCallback(1); if (this.onCompleteCallback) this.onCompleteCallback(); }; this.audioElement.onerror = (e) => { logError(`Audio error, skipping speech`, e); this.isPlaying = false; this.isPaused = false; if (this.onCompleteCallback) setTimeout(this.onCompleteCallback, 500); }; } catch (error) { logError(`Speech Error: ${error}`); this.isPlaying = false; this.isPaused = false; if (this.onCompleteCallback) setTimeout(this.onCompleteCallback, 500); } }
        pause() { if (this.isPlaying && !this.isPaused) { this.audioElement.pause(); this.isPaused = true; log('Speech paused'); } }
        resume() { if (this.isPaused && this.isPlaying) { this.audioElement.play().catch(e => logError(`Resume error: ${e}`)); this.isPaused = false; log('Speech resumed'); } }
        stop() { this.audioElement.pause(); this.isPlaying = false; this.isPaused = false; if (this.audioElement.src) { this.audioElement.currentTime = 0; URL.revokeObjectURL(this.audioElement.src); this.audioElement.src = ''; } log('Speech stopped'); }
        base64ToBlob(base64) { const byteCharacters = atob(base64); const byteArrays = []; for (let offset = 0; offset < byteCharacters.length; offset += 512) { const slice = byteCharacters.slice(offset, offset + 512); const byteNumbers = new Array(slice.length); for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i); byteArrays.push(new Uint8Array(byteNumbers)); } return new Blob(byteArrays, { type: 'audio/mpeg' }); }
    }

    class LearningPipeline {
        constructor() {
            this.gemini = new GeminiOrchestrator();
            this.videoSourcer = new VideoSourcer();
            this.speechEngine = new SpeechEngine();
            this.youtubePlayer = null;
        }

        // --- FIX: Improved error handling to be more specific ---
        async start(topic) {
            setView('loading');
            ui.loadingMessage.textContent = "Generating your personalized lesson plan...";
            
            try {
                const rawPlan = await this.gemini.generateLessonPlan(topic);

                if (rawPlan && rawPlan.Apprentice && rawPlan.Journeyman && rawPlan.Senior && rawPlan.Master) {
                    // Validate that each level has the correct number of topics
                    if (rawPlan.Apprentice.length >= 3 && rawPlan.Journeyman.length >= 5 && 
                        rawPlan.Senior.length >= 7 && rawPlan.Master.length >= 9) {
                        currentLessonPlan = rawPlan;
                        currentLessonPlan.topic = topic;
                        log("Successfully generated lesson plan:", rawPlan);
                        displayLevelSelection();
                        setView('level-selection');
                        return; // Success path, exit early
                    } else {
                        logError("Lesson plan has incorrect topic counts:", rawPlan);
                        displayError("Generated lesson plan is incomplete. Please try again or use a different topic.");
                    }
                } else {
                    logError("Gemini returned an invalid or empty lesson plan:", rawPlan);
                    displayError("Failed to generate a valid lesson plan. Please try a different topic or check your internet connection.");
                }
            } catch (error) {
                logError("Failed to generate lesson plan due to an API error:", error);
                let errorMessage = "AI service temporarily unavailable. Please try again.";
                
                if (error.message.includes("quota")) {
                    errorMessage = "API quota exceeded. Please try again later.";
                } else if (error.message.includes("blocked")) {
                    errorMessage = "Content was blocked by safety filters. Try a different topic.";
                } else if (error.message.includes("network") || error.message.includes("fetch")) {
                    errorMessage = "Network error. Check your internet connection and try again.";
                }
                
                displayError(errorMessage);
            }
            
            // Reset UI state on any error
            this.resetToInput();
        }

        resetToInput() {
            setView('input');
            ui.curateButton.disabled = false;
            ui.headerDescription.classList.remove('hidden');
            updateStatus('idle');
        }

        startLevel(level) {
            log("FLOW: Starting level", level);
            currentLearningPath = level;
            currentSegmentIndex = -1;
            ui.viewContainer.classList.add('hidden');
            ui.learningCanvasContainer.classList.remove('hidden');
            ui.lessonProgressContainer.classList.remove('hidden');
            ui.progressSpacer.classList.remove('hidden');
            this.processNextLearningPoint();
        }

        async processNextLearningPoint() {
            currentSegmentIndex++;
            const learningPoints = currentLessonPlan[currentLearningPath];
            if (currentSegmentIndex >= learningPoints.length) {
                this.showLessonSummary();
                return;
            }

            log(`--- Starting Learning Point ${currentSegmentIndex + 1}/${learningPoints.length} ---`);

            const learningPoint = learningPoints[currentSegmentIndex];
            const previousPoint = currentSegmentIndex > 0 ? learningPoints[currentSegmentIndex - 1] : null;

            updateSegmentProgress();
            ui.currentTopicDisplay.textContent = learningPoint;

            await this.playNarration(learningPoint, previousPoint, () => {
                this.searchVideos(learningPoint);
            });
        }

        async playNarration(learningPoint, previousPoint, onComplete) {
            log("FLOW: Play intro narration for:", learningPoint);
            updateStatus('narrating');
            const narrationText = await this.gemini.generateNarration(learningPoint, previousPoint);
            await this.speechEngine.play(narrationText, {
                onProgress: (progress) => updateTeleprompter(narrationText, progress),
                onComplete: () => {
                    if (lessonState === 'narrating') onComplete();
                }
            });
        }

        async searchVideos(learningPoint) {
            log("FLOW: Search educational videos");
            updateStatus('searching_videos');
            updateCanvasVisuals('🔎 Finding educational content...', `Searching for: "${learningPoint}"`);
            try {
                const searchQueries = await this.gemini.generateSearchQueries(learningPoint);
                if (!searchQueries || searchQueries.length === 0) throw new Error("Failed to generate search queries.");

                log(`Generated search queries:`, searchQueries);
                let allVideos = [];
                for (const query of searchQueries.slice(0, 2)) {
                    const results = await this.videoSourcer.searchYouTube(query);
                    allVideos.push(...results);
                    if (allVideos.length >= 10) break;
                }

                if (allVideos.length === 0) {
                    await this.createFallbackContent(learningPoint);
                    return;
                }

                const uniqueVideos = [...new Map(allVideos.map(v => [v.youtubeId, v])).values()]
                    .sort((a, b) => b.educationalScore - a.educationalScore);
                currentVideoChoices = uniqueVideos.slice(0, 5);

                if (currentVideoChoices.length === 0) {
                    await this.createFallbackContent(learningPoint);
                    return;
                }

                this.autoSelectBestVideo();
            } catch (error) {
                logError('Video search failed:', error);
                await this.createFallbackContent(learningPoint);
            }
        }

        autoSelectBestVideo() {
            log("FLOW: Auto-selecting best video");
            updateStatus('choosing_video');
            const bestVideo = currentVideoChoices[0];
            log(`FLOW: Selected video: ${bestVideo.title} (ID: ${bestVideo.youtubeId})`);
            updateCanvasVisuals('✅ Video selected!', `"${bestVideo.title}"`);
            setTimeout(() => this.generateSegments(bestVideo), 1500);
        }

        async createFallbackContent(learningPoint) {
            log("FLOW: Creating fallback content");
            updateStatus('generating_segments');
            updateCanvasVisuals('🤖 Creating custom content...', 'No suitable videos found. Generating text explanation...');
            const explanation = await this.gemini.generateDetailedExplanation(learningPoint);
            if (explanation) {
                await this.speechEngine.play(explanation, {
                    onProgress: (progress) => updateTeleprompter(explanation, progress),
                    onComplete: () => { if (lessonState === 'generating_segments') this.showQuiz(); }
                });
            } else {
                updateCanvasVisuals('⏭️ Skipping segment', 'Could not generate content. Moving on...');
                setTimeout(() => this.processNextLearningPoint(), 2000);
            }
        }

        async generateSegments(video) {
            log("FLOW: Generate segments");
            updateStatus('generating_segments');
            updateCanvasVisuals('✂️ Finding best segments...', `Analyzing: "${video.title}"`);
            try {
                const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
                currentSegments = await this.gemini.findVideoSegments(video.title, learningPoint);
                log(`Generated ${currentSegments.length} segments:`, currentSegments);
                this.playSegments(video);
            } catch (error) {
                logError('Failed to generate segments:', error);
                currentSegments = [{ startTime: 30, endTime: 180, reason: "Fallback segment due to error" }];
                this.playSegments(video);
            }
        }

        playSegments(video) {
            log("FLOW: Play segments");
            updateStatus('playing_video');
            currentSegmentPlayIndex = 0;
            this.createYouTubePlayer(video);
        }

        createYouTubePlayer(videoInfo) {
            if (this.youtubePlayer) { try { this.youtubePlayer.destroy(); } catch (e) {} this.youtubePlayer = null; }

            setCanvasVisible(false);
            ui.skipVideoButton.style.display = 'block';
            ui.youtubePlayerContainer.innerHTML = '';

            if (!videoInfo?.youtubeId) {
                this.handleVideoError();
                return;
            }
            this.currentVideoInfo = videoInfo;
            this.playCurrentSegment();
        }

        playCurrentSegment() {
            if (currentSegmentPlayIndex >= currentSegments.length) {
                this.handleVideoEnd();
                return;
            }
            const segment = currentSegments[currentSegmentPlayIndex];
            log(`Playing segment ${currentSegmentPlayIndex + 1}/${currentSegments.length}: ${segment.startTime}s - ${segment.endTime}s`);

            const playerDivId = 'youtube-player-div';
            ui.youtubePlayerContainer.innerHTML = `<div id="${playerDivId}"></div>`;

            this.youtubePlayer = new YT.Player(playerDivId, {
                height: '100%', width: '100%', videoId: this.currentVideoInfo.youtubeId,
                playerVars: { autoplay: 1, controls: 1, rel: 0, start: segment.startTime, modestbranding: 1, iv_load_policy: 3, enablejsapi: 1, origin: window.location.origin, fs: 0 },
                events: {
                    'onReady': e => e.target.playVideo(),
                    'onStateChange': e => {
                        if (e.data === YT.PlayerState.PAUSED) updateStatus('paused');
                        if (e.data === YT.PlayerState.PLAYING) updateStatus('playing_video');
                    },
                    'onError': e => {
                        logError(`Youtubeer error: ${e.data}`);
                        this.tryNextSegmentOrQuiz();
                    }
                }
            });
        }

        tryNextSegmentOrQuiz() {
            currentSegmentPlayIndex++;
            if (currentSegmentPlayIndex >= currentSegments.length) {
                this.handleVideoEnd();
            } else {
                this.playCurrentSegment();
            }
        }

        async handleVideoEnd() {
            log('Video playback finished');
            ui.skipVideoButton.style.display = 'none';
            if (this.youtubePlayer) { try { this.youtubePlayer.destroy(); } catch(e){} this.youtubePlayer = null; }

            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            const narrationText = await this.gemini.generateConcludingNarration(learningPoint);

            await this.speechEngine.play(narrationText, {
                onProgress: (p) => updateTeleprompter(narrationText, p),
                onComplete: () => this.showQuiz()
            });
        }

        handleVideoError() {
            logError('Handling video error. Creating fallback content.');
            this.createFallbackContent(currentLessonPlan[currentLearningPath][currentSegmentIndex]);
        }

        async showQuiz() {
            log("FLOW: Show quiz");
            updateStatus('quiz');
            ui.lessonControls.style.display = 'none';
            setCanvasVisible(false);

            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            const quiz = await this.gemini.generateQuiz(learningPoint);

            if (quiz?.question) {
                this.displayQuiz(quiz);
            } else {
                logError("Failed to generate quiz. Skipping.");
                this.processNextLearningPoint();
            }
        }

        displayQuiz(quiz) {
            ui.youtubePlayerContainer.innerHTML = `
                <div class="p-6 md:p-8 text-white h-full flex flex-col justify-start">
                    <div class="flex-grow flex flex-col justify-center max-w-3xl mx-auto w-full">
                        <div class="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6 border border-white/20"><p class="text-xl lg:text-2xl leading-relaxed">${quiz.question}</p></div>
                        <div class="space-y-4 mb-6">${quiz.options.map((option, index) => `<button class="quiz-option w-full text-left p-4 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all" data-index="${index}"><span>${String.fromCharCode(65 + index)})</span> <span class="ml-3">${option}</span></button>`).join('')}</div>
                        <div id="quiz-result" class="hidden opacity-0 transition-opacity duration-500">
                            <div id="quiz-explanation-container" class="border rounded-xl p-4 mb-4"><p id="quiz-explanation"></p></div>
                            <div class="text-center"><button id="continue-button" class="bg-green-600 hover:bg-green-700 px-8 py-3 rounded-xl font-semibold">Continue →</button></div>
                        </div>
                    </div>
                </div>`;

            ui.youtubePlayerContainer.querySelectorAll('.quiz-option').forEach(option => {
                option.addEventListener('click', () => {
                    const selectedIndex = parseInt(option.dataset.index);
                    const isCorrect = selectedIndex === quiz.correct;
                    ui.youtubePlayerContainer.querySelectorAll('.quiz-option').forEach(opt => {
                        opt.disabled = true;
                        opt.classList.remove('bg-blue-600', 'hover:bg-blue-700');
                        if (parseInt(opt.dataset.index) === quiz.correct) opt.classList.add('bg-green-700');
                    });
                    if (!isCorrect) option.classList.add('bg-red-700');

                    const resultDiv = document.getElementById('quiz-result');
                    const explanationDiv = document.getElementById('quiz-explanation-container');
                    document.getElementById('quiz-explanation').textContent = quiz.explanation;
                    explanationDiv.className = `border rounded-xl p-4 mb-4 ${isCorrect ? 'bg-green-500/20 border-green-500/50' : 'bg-red-500/20 border-red-500/50'}`;
                    resultDiv.classList.remove('hidden');
                    setTimeout(() => resultDiv.classList.remove('opacity-0'), 10);

                    document.getElementById('continue-button').addEventListener('click', () => {
                        ui.lessonControls.style.display = 'flex';
                        this.processNextLearningPoint();
                    });
                });
            });
        }

        async showLessonSummary() {
            log("FLOW: Show lesson summary");
            updateStatus('summary');
            ui.lessonControls.style.display = 'none';
            setCanvasVisible(false);

            const topic = currentLessonPlan.topic;
            const learningPoints = currentLessonPlan[currentLearningPath];
            const summary = await this.gemini.generateLessonSummary(topic, learningPoints);

            ui.youtubePlayerContainer.innerHTML = `
                <div class="p-8 text-white h-full flex flex-col justify-center items-center" style="background: linear-gradient(135deg, #16213e 0%, #0f172a 100%);">
                    <h2 class="text-4xl font-bold mb-4 text-purple-300">Congratulations!</h2>
                    <p class="text-xl mb-8">You've completed the ${currentLearningPath} level for "${topic}".</p>
                    <div class="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/20 max-w-2xl w-full text-left">
                         <h3 class="text-2xl font-semibold mb-4 text-blue-300">Key Takeaways</h3>
                         <div id="summary-content" class="prose prose-invert max-w-none">${summary.replace(/•/g, '<li class="ml-4">')}</div>
                    </div>
                    <button id="finish-lesson-button" class="bg-purple-600 hover:bg-purple-700 px-10 py-4 rounded-xl font-semibold text-lg">Finish Lesson & Start Over</button>
                </div>`;

            document.getElementById('finish-lesson-button').addEventListener('click', resetUIState);
        }
    }

    // =================================================================================
    // --- UTILITY & UI FUNCTIONS ---
    // =================================================================================

    const learningPipeline = new LearningPipeline();

    function updateStatus(state) {
        lessonState = state;
        log(`STATE: ${state}`);
        updatePlayPauseIcon();
    }

    function setView(viewName) {
        const views = {
            'input': ui.inputSection,
            'loading': ui.loadingIndicator,
            'level-selection': ui.levelSelection
        };
        for (const key in views) {
            if (views[key]) {
                if (key === viewName) {
                    views[key].classList.remove('hidden');
                } else {
                    views[key].classList.add('hidden');
                }
            }
        }
    }

    function initializeUI() {
        ui.curateButton.addEventListener('click', handleCurateClick);
        ui.playPauseButton.addEventListener('click', playPauseLesson);
        ui.nextSegmentButton.addEventListener('click', () => learningPipeline.processNextLearningPoint());
        ui.skipVideoButton.addEventListener('click', () => learningPipeline.handleVideoEnd());

        window.onYouTubeIframeAPIReady = () => log("YouTube IFrame API is ready.");

        if (localStorage.getItem('lastTopic')) {
            ui.topicInput.value = localStorage.getItem('lastTopic');
        }
    }

    function playPauseLesson() {
        switch (lessonState) {
            case 'narrating': learningPipeline.speechEngine.pause(); updateStatus("paused"); break;
            case 'playing_video': learningPipeline.youtubePlayer?.pauseVideo(); updateStatus("paused"); break;
            case 'paused':
                if (learningPipeline.speechEngine.isPaused) {
                    learningPipeline.speechEngine.resume();
                    updateStatus('narrating');
                } else if (learningPipeline.youtubePlayer) {
                    learningPipeline.youtubePlayer.playVideo();
                    updateStatus('playing_video');
                }
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
        ui.curateButton.disabled = true;
        ui.headerDescription.classList.add('hidden');
        await learningPipeline.start(topic);
    }

    function displayLevelSelection() {
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
    }

    function updateSegmentProgress() {
        const total = currentLessonPlan[currentLearningPath].length;
        const current = currentSegmentIndex + 1;
        ui.segmentProgress.style.width = `${(current / total) * 100}%`;
        ui.segmentProgressText.textContent = `${current}/${total}`;
    }

    function setCanvasVisible(visible) {
        ui.canvas.style.opacity = visible ? '1' : '0';
        ui.canvas.style.pointerEvents = visible ? 'auto' : 'none';
        if (visible) {
            if (ui.youtubePlayerContainer) ui.youtubePlayerContainer.innerHTML = '';
        }
    }

    function drawCenteredText(ctx, text, options) {
        const { y, font, color, maxWidth } = options;
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = wrapText(text, maxWidth, ctx);
        const lineHeight = parseInt(ctx.font.match(/(\d+)px/)[1]) * 1.4;
        const totalHeight = (lines.length -1) * lineHeight;
        const startY = y - totalHeight / 2;

        lines.forEach((line, i) => {
            ctx.fillText(line, ctx.canvas.width / 2, startY + i * lineHeight);
        });
    }

    function updateCanvasVisuals(mainText, subText = '') {
        setCanvasVisible(true);
        const { width, height } = ui.canvas;
        ui.canvas.width = ui.canvas.clientWidth;
        ui.canvas.height = ui.canvas.clientHeight;

        const gradient = canvasCtx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(0, 0, width, height);

        const maxWidth = width * 0.85;

        drawCenteredText(canvasCtx, mainText, {
            y: height / 2 - (subText ? 20 : 0),
            font: `bold ${Math.max(22, Math.min(width / 25, 36))}px Inter, sans-serif`,
            color: 'rgba(255, 255, 255, 0.95)',
            maxWidth: maxWidth
        });

        if (subText) {
            drawCenteredText(canvasCtx, subText, {
                y: height / 2 + 30,
                font: `${Math.max(16, Math.min(width / 40, 20))}px Inter, sans-serif`,
                color: 'rgba(200, 200, 200, 0.8)',
                maxWidth: maxWidth
            });
        }
    }

    function updateTeleprompter(fullText, progress) {
        setCanvasVisible(true);
        const { width, height } = ui.canvas;
        ui.canvas.width = ui.canvas.clientWidth;
        ui.canvas.height = ui.canvas.clientHeight;
        const ctx = canvasCtx;

        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        const maxWidth = width * 0.9;
        const fontSize = Math.max(24, Math.min(width / 30, 36));
        const lineHeight = fontSize * 1.5;
        ctx.font = `400 ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';

        const lines = wrapText(fullText, maxWidth, ctx);
        const totalContentHeight = (lines.length) * lineHeight;
        const yOffset = height / 2 - (totalContentHeight * progress);

        ctx.save();
        ctx.translate(width / 2, yOffset);
        lines.forEach((line, index) => ctx.fillText(line, 0, index * lineHeight));
        ctx.restore();
    }

    function wrapText(text, maxWidth, ctx) {
        const words = text.split(' ');
        let lines = [];
        let currentLine = words[0] || '';
        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = ctx.measureText(currentLine + " " + word).width;
            if (width < maxWidth) {
                currentLine += " " + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
    }

    function resetUIState(fullReset = true) {
        log("Resetting UI state");
        if(learningPipeline.speechEngine) learningPipeline.speechEngine.stop();
        if(learningPipeline.youtubePlayer) { try { learningPipeline.youtubePlayer.destroy(); } catch(e){} }

        ui.learningCanvasContainer.classList.add('hidden');
        ui.lessonProgressContainer.classList.add('hidden');
        ui.progressSpacer.classList.add('hidden');
        ui.viewContainer.classList.remove('hidden');
        
        currentLessonPlan = null;
        learningPipeline.resetToInput();
        
        if (fullReset) {
            ui.headerDescription.classList.remove('hidden');
        }
    }

    function displayError(message) { logError(message); ui.errorMessage.textContent = message; ui.errorDisplay.classList.remove('hidden'); setTimeout(() => { if(ui.errorDisplay) ui.errorDisplay.classList.add('hidden') }, 5000); }

    initializeUI();
});