
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
        parseJSONResponse(response) { if (!response) return null; try { let cleanedResponse = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, ''); const jsonMatch = cleanedResponse.match(/(\{[\s\S]*\}|\[[\s\S]*\])/); if (jsonMatch) { return JSON.parse(jsonMatch[0]); } logError(`No valid JSON found in response:`, response); return null; } catch (error) { logError(`Failed to parse JSON:`, error, `Raw response: "${response}"`); return null; } }

        async generateLessonPlan(topic) {
            log("GEMINI: Generating lesson plan...");
            const prompt = `Create a learning plan for "${topic}".
- Create 4 levels: Apprentice, Journeyman, Senior, Master.
- Set the number of learning points for each level: Apprentice (3), Journeyman (5), Senior (7), Master (9).
- Keep topics concise and educational.

Example format:
{
  "Apprentice": ["Point 1", "Point 2", "Point 3"],
  "Journeyman": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],
  "Senior": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5", "Point 6", "Point 7"],
  "Master": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5", "Point 6", "Point 7", "Point 8", "Point 9"]
}

Topic: "${topic}"

Return ONLY the valid JSON, no other text.`;
            const response = await this.makeRequest(prompt);
            return this.parseJSONResponse(response);
        }

        async generateSearchQueries(learningPoint) {
            log(`GEMINI: Generating search queries for "${learningPoint}"`);
            const prompt = `Generate 3 simple, effective Youtube queries for "${learningPoint}". Each query should be 2-5 words. Focus on finding educational content like tutorials, explanations, or documentaries. Return ONLY a JSON array of strings. Example: ["quantum physics explained", "basics of quantum mechanics", "quantum theory documentary"]`;
            const response = await this.makeRequest(prompt, { temperature: 0.3 });
            return this.parseJSONResponse(response);
        }

        async checkVideoRelevance(videoTitle, learningPoint, mainTopic) {
            log(`GEMINI: Checking relevance of "${videoTitle}" for "${learningPoint}"`);
            const prompt = `You are a strict educational content filter. Analyze if this YouTube video is relevant for learning about "${learningPoint}" in the context of "${mainTopic}".

Video Title: "${videoTitle}"
Learning Topic: "${learningPoint}"
Main Subject: "${mainTopic}"

STRICT CRITERIA - Mark as relevant ONLY if:
1. Video title directly mentions concepts from "${learningPoint}" or "${mainTopic}"
2. Video appears to be a tutorial, explanation, or educational content about the specific topic
3. Video is NOT about basic software usage (like "how to open Google Docs") unless that's specifically what the learning point is about
4. Video is NOT generic advice that could apply to any topic

Examples of RELEVANT videos:
- "Building Gemini AI Apps Tutorial" for "Gemini app development"
- "JavaScript Functions Explained" for "JavaScript functions"

Examples of NOT RELEVANT videos:
- "How to Open Google Docs" for "creating app documentation" (too basic/generic)
- "General Productivity Tips" for any specific technical topic
- "WordPress Basics" for "React development"

Be very strict. When in doubt, mark as NOT relevant.

Return ONLY a JSON object: {"relevant": true/false, "reason": "specific explanation", "confidence": 1-10}`;

            const response = await this.makeRequest(prompt, { temperature: 0.1 });
            const result = this.parseJSONResponse(response);
            
            if (result && typeof result.relevant === 'boolean') {
                log(`RELEVANCE CHECK: ${result.relevant ? 'RELEVANT' : 'NOT RELEVANT'} (Confidence: ${result.confidence || 'N/A'}) - ${result.reason}`);
                return result;
            }
            
            // More conservative fallback: assume NOT relevant if we can't parse
            log('RELEVANCE CHECK: Fallback to NOT relevant (parsing failed - being conservative)');
            return { relevant: false, reason: "Could not determine relevance, being conservative" };
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

        async findVideoSegments(videoTitle, youtubeUrl, learningPoint) {
            log(`SEGMENTER: Analyzing YouTube video for "${learningPoint}"`);
            try {
                const prompt = `You are a video analyst. For a YouTube video titled "${videoTitle}", identify the most relevant segments for the learning topic: "${learningPoint}".
- Educational videos usually have an intro (0-30s), main content, and an outro. Focus on the main content.
- Identify 1-3 key segments, each 30-120 seconds long. Total duration should be 60-240 seconds.
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
            }).filter(item => item && item.youtubeId && item.youtubeId.length === 11); // Extra validation
            log(`SEARCH: Found ${results.length} valid videos for "${query}"`);
            return results;
        }
    }

    class SpeechEngine {
        constructor() { this.apiKey = "AIzaSyA43RRVypjAAXwYdpKrojWVmdRAGyLKwr8"; this.apiUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize'; this.audioElement = new Audio(); this.onCompleteCallback = null; this.onProgressCallback = null; this.isPaused = false; this.isPlaying = false; }
        async play(text, { onProgress = null, onComplete = null } = {}) {
            log(`SPEECH: Starting playback for text: "${text.substring(0, 50)}..."`);
            this.stop();
            if (!text) {
                if (onComplete) onComplete();
                return;
            }
            this.onProgressCallback = onProgress;
            this.onCompleteCallback = onComplete;
            this.isPaused = false;
            this.isPlaying = true;
            
            const startTime = Date.now(); // Track start time for fallback calculations
            log('SPEECH: State set - isPlaying: true, isPaused: false');

            const maxRetries = 2;
            let currentRetry = 0;

            try {
                let response;
                while (currentRetry <= maxRetries) {
                    try {
                        response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                input: { text },
                                voice: { languageCode: 'en-US', name: 'en-US-Standard-C' },
                                audioConfig: { audioEncoding: 'MP3' }
                            })
                        });

                        // If the response is OK, break the retry loop and proceed.
                        if (response.ok) {
                            break;
                        }

                        // Handle different error types
                        if (response.status === 429 && currentRetry < maxRetries) {
                            log(`SPEECH API: Rate limited. Retrying in ${currentRetry + 1} seconds...`);
                            currentRetry++;
                            await new Promise(resolve => setTimeout(resolve, (currentRetry) * 1000));
                        } else if (response.status >= 500 && currentRetry < maxRetries) {
                            log(`SPEECH API: Server error ${response.status}. Retrying...`);
                            currentRetry++;
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } else {
                            // For other errors or if retries are exhausted, throw an error to be caught below.
                            const errorData = await response.json().catch(() => ({}));
                            throw new Error(`Speech API failed with status ${response.status}: ${errorData.error?.message || 'Unknown API error'}`);
                        }
                    } catch (fetchError) {
                        if (currentRetry < maxRetries) {
                            log(`SPEECH API: Network error. Retrying...`);
                            currentRetry++;
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } else {
                            throw fetchError;
                        }
                    }
                }

                const data = await response.json();
                const audioBlob = this.base64ToBlob(data.audioContent);
                this.audioElement.src = URL.createObjectURL(audioBlob);

                // Add timeout for audio loading
                const audioTimeout = setTimeout(() => {
                    if (this.isPlaying) {
                        logError('Audio loading timeout, using fallback');
                        this.isPlaying = false;
                        this.isPaused = false;
                        if (this.onCompleteCallback) {
                            log('SPEECH: Using fallback timer due to loading timeout');
                            this.onCompleteCallback();
                        }
                    }
                }, 10000); // 10 second timeout

                this.audioElement.onloadeddata = () => {
                    clearTimeout(audioTimeout);
                    log('SPEECH: Audio loaded successfully, attempting to play');
                    if (this.isPlaying && !this.isPaused) {
                        // Add a small delay to ensure audio is fully ready
                        setTimeout(() => {
                            if (this.isPlaying && !this.isPaused) {
                                this.audioElement.play().then(() => {
                                    log('SPEECH: Audio playback started successfully');
                                }).catch(e => {
                                    logError(`Audio play error: ${e}`);
                                    if (this.onCompleteCallback) {
                                        log('SPEECH: Using fallback timer due to play error');
                                        this.onCompleteCallback();
                                    }
                                });
                            }
                        }, 100);
                    }
                };

                this.audioElement.ontimeupdate = () => {
                    if (this.onProgressCallback && this.audioElement.duration) this.onProgressCallback(this.audioElement.currentTime / this.audioElement.duration);
                };

                this.audioElement.onended = () => {
                    this.isPlaying = false;
                    this.isPaused = false;
                    if (this.onProgressCallback) this.onProgressCallback(1);
                    if (this.onCompleteCallback) this.onCompleteCallback();
                };

                this.audioElement.oncanplay = () => {
                    log('SPEECH: Audio can start playing');
                };
                
                this.audioElement.oncanplaythrough = () => {
                    log('SPEECH: Audio can play through without stopping');
                };
                
                this.audioElement.onplay = () => {
                    log('SPEECH: Audio play event fired');
                };
                
                this.audioElement.onplaying = () => {
                    log('SPEECH: Audio is now playing');
                };
                
                this.audioElement.onerror = (e) => {
                    clearTimeout(audioTimeout);
                    logError(`Audio element error, falling back to timer`, e);
                    this.isPlaying = false;
                    this.isPaused = false;
                    
                    // Estimate speech duration based on text length (more realistic timing)
                    const estimatedDuration = Math.max(3000, Math.min(text.length * 80, 15000));
                    log(`SPEECH: Using fallback timer for ${estimatedDuration}ms`);
                    
                    // Simulate progress updates during fallback
                    if (this.onProgressCallback) {
                        const progressInterval = setInterval(() => {
                            const elapsed = Date.now() - startTime;
                            const progress = Math.min(elapsed / estimatedDuration, 1);
                            this.onProgressCallback(progress);
                            
                            if (progress >= 1) {
                                clearInterval(progressInterval);
                            }
                        }, 100);
                        
                        // Clean up interval when done
                        setTimeout(() => clearInterval(progressInterval), estimatedDuration + 100);
                    }
                    
                    // Call onComplete after the estimated duration
                    if (this.onCompleteCallback) {
                        setTimeout(() => {
                            if (this.onCompleteCallback) {
                                log('SPEECH: Fallback timer completed');
                                this.onCompleteCallback();
                            }
                        }, estimatedDuration);
                    }
                };

            } catch (error) {
                logError(`Speech Error: ${error}`);
                this.isPlaying = false;
                this.isPaused = false;
                // Call onComplete after a delay as fallback
                if (this.onCompleteCallback) {
                    setTimeout(() => {
                        if (this.onCompleteCallback) {
                            log('SPEECH: Using fallback timer due to API error');
                            this.onCompleteCallback();
                        }
                    }, Math.max(2000, text.length * 50)); // Estimate speech duration
                }
            }
        }
        pause() { 
            if (this.isPlaying && !this.isPaused) { this.audioElement.pause(); this.isPaused = true; log('Speech paused'); } }
        resume() { 
            if (this.isPaused && this.isPlaying) { this.audioElement.play().catch(e => logError(`Resume error: ${e}`)); this.isPaused = false; log('Speech resumed'); } }
        stop() { 
            log('SPEECH: Stopping audio playback');
            try {
                this.audioElement.pause(); 
            } catch (e) {
                log('SPEECH: Error pausing audio:', e);
            }
            this.isPlaying = false; 
            this.isPaused = false; 
            if (this.audioElement.src) { 
                try {
                    this.audioElement.currentTime = 0; 
                    URL.revokeObjectURL(this.audioElement.src); 
                    this.audioElement.src = ''; 
                } catch (e) {
                    log('SPEECH: Error cleaning up audio source:', e);
                }
            } 
            // Clear all event handlers to prevent issues
            this.audioElement.onloadeddata = null;
            this.audioElement.ontimeupdate = null;
            this.audioElement.onended = null;
            this.audioElement.onerror = null;
            this.audioElement.oncanplay = null;
            this.audioElement.oncanplaythrough = null;
            this.audioElement.onplay = null;
            this.audioElement.onplaying = null;
            log('Speech stopped and cleaned up'); 
        }
        base64ToBlob(base64) { 
            const byteCharacters = atob(base64); const byteArrays = []; for (let offset = 0; offset < byteCharacters.length; offset += 512) { const slice = byteCharacters.slice(offset, offset + 512); const byteNumbers = new Array(slice.length); for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i); byteArrays.push(new Uint8Array(byteNumbers)); } return new Blob(byteArrays, { type: 'audio/mpeg' }); }
    }

    class LearningPipeline {
        constructor() { this.gemini = new GeminiOrchestrator(); this.videoSourcer = new VideoSourcer(); this.speechEngine = new SpeechEngine(); this.youtubePlayer = null;      this.concludingNarrationText = null; }

        async start(topic) {
            log("FLOW: Step 1 - Generate lesson plan");
            showLoading("Generating comprehensive lesson plan...");
            const rawPlan = await this.gemini.generateLessonPlan(topic);
            hideLoading();
            currentLessonPlan = rawPlan;
            if (currentLessonPlan && currentLessonPlan.Apprentice) {
                currentLessonPlan.topic = topic;
                displayLevelSelection();
            } else {
                displayError("Failed to generate a valid lesson plan. Please try a different topic.");
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
            
            // Completely remove all potential spacing elements
            document.getElementById('progress-spacer').classList.add('hidden');
            ui.inputSection.classList.add('hidden');
            ui.loadingIndicator.classList.add('hidden');
            
            // Force compact header layout
            document.querySelector('header').style.marginBottom = '0.5rem';
            document.querySelector('header').style.paddingBottom = '0.25rem';
            
            this.processNextLearningPoint();
        }

        async processNextLearningPoint() {
            currentSegmentIndex++;
            const learningPoints = currentLessonPlan[currentLearningPath];
            if (currentSegmentIndex >= learningPoints.length) {
                this.showLessonSummary();
                return;
            }
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
                const narrationText = await this.gemini.generateNarration(learningPoint, previousPoint);
                if (!narrationText) {
                    log("NARRATION: No text generated, skipping to next step");
                    onComplete();
                    return;
                }
                
                displayTextContent(narrationText);
                
                // Create a promise that resolves only when speech completes
                await new Promise((resolve) => {
                    let speechCompleted = false;
                    
                    // Set up a timeout as safety net
                    const timeoutId = setTimeout(() => {
                        if (!speechCompleted) {
                            speechCompleted = true;
                            log("NARRATION: Timeout reached, forcing completion");
                            this.speechEngine.stop();
                            resolve();
                        }
                    }, 15000); // 15 second timeout
                    
                    this.speechEngine.play(narrationText, {
                        onProgress: (progress) => {
                            if (lessonState === 'narrating') {
                                animateTextProgress(narrationText, progress);
                            }
                        },
                        onComplete: () => {
                            if (!speechCompleted && lessonState === 'narrating') {
                                speechCompleted = true;
                                clearTimeout(timeoutId);
                                log("NARRATION: Speech completed successfully");
                                resolve();
                            }
                        }
                    });
                });
                
                // Only proceed if still in narrating state
                if (lessonState === 'narrating') {
                    onComplete();
                }
            } catch (error) {
                logError("NARRATION: Error during playback", error);
                onComplete();
            }
        }

        async playConcludingNarration(learningPoint) {
            log("FLOW: Play concluding narration");
            updateStatus('narrating');
            updatePlayPauseIcon();
            ui.nextSegmentButton.disabled = true;
            
            try {
                const narrationText = await this.gemini.generateConcludingNarration(learningPoint);
                if (!narrationText) {
                    log("CONCLUDING NARRATION: No text generated, skipping to next step");
                    return;
                }
                
                // Ensure text display is visible and force display the content
                showTextDisplay();
                displayTextContent(narrationText);
                log("CONCLUDING NARRATION: Text content displayed on teleprompter");
                
                // Create a promise that resolves only when speech completes
                await new Promise((resolve) => {
                    let speechCompleted = false;
                    
                    // Set up a timeout as safety net
                    const timeoutId = setTimeout(() => {
                        if (!speechCompleted) {
                            speechCompleted = true;
                            log("CONCLUDING NARRATION: Timeout reached, forcing completion");
                            this.speechEngine.stop();
                            resolve();
                        }
                    }, 20000); // Increased timeout for concluding narration
                    
                    this.speechEngine.play(narrationText, {
                        onProgress: (progress) => {
                            if (lessonState === 'narrating') {
                                animateTextProgress(narrationText, progress);
                                log(`CONCLUDING NARRATION: Progress ${(progress * 100).toFixed(1)}%`);
                            }
                        },
                        onComplete: () => {
                            if (!speechCompleted && lessonState === 'narrating') {
                                speechCompleted = true;
                                clearTimeout(timeoutId);
                                log("CONCLUDING NARRATION: Speech completed successfully");
                                resolve();
                            }
                        }
                    });
                });
                
                // Only proceed if still in narrating state
                if (lessonState === 'narrating') {
                    log("CONCLUDING NARRATION: Completed successfully");
                }
            } catch (error) {
                logError("CONCLUDING NARRATION: Error during playback", error);
            }
        }

        async searchVideos(learningPoint) {
            log("FLOW: Step 2 - Search educational videos");
            updateStatus('searching_videos');
            displayStatusMessage('🔎 Finding educational content...', `Searching for: "${learningPoint}"`);
            try {
                const searchQueries = await this.gemini.generateSearchQueries(learningPoint);
                if (!searchQueries || !Array.isArray(searchQueries) || searchQueries.length === 0) {
                    throw new Error("Failed to generate search queries.");
                }
                log(`Generated search queries:`, searchQueries);
                let allVideos = [];
                for (const query of searchQueries.slice(0, 2)) {
                    displayStatusMessage('🔎 Searching educational videos...', `Query: "${query}"`);
                    const results = await this.videoSourcer.searchYouTube(query);
                    allVideos.push(...results);
                    if (allVideos.length >= 15) break; // Get more videos for filtering
                }
                log(`Total videos found: ${allVideos.length}`);
                if (allVideos.length === 0) {
                    await this.createFallbackContent(learningPoint);
                    return;
                }
                
                // Step 2.5: Filter videos for relevance
                displayStatusMessage('🎯 Filtering relevant content...', `Checking relevance to: "${learningPoint}"`);
                const uniqueVideos = [...new Map(allVideos.map(v => [v.youtubeId, v])).values()]
                    .sort((a, b) => b.educationalScore - a.educationalScore);
                
                const relevantVideos = [];
                const mainTopic = currentLessonPlan.topic || learningPoint;
                
                // Check up to 12 top videos for relevance (increased for better selection)
                for (const video of uniqueVideos.slice(0, 12)) {
                    const relevanceCheck = await this.gemini.checkVideoRelevance(video.title, learningPoint, mainTopic);
                    if (relevanceCheck.relevant) {
                        // Apply confidence-based scoring
                        const confidenceBoost = (relevanceCheck.confidence || 5) / 2;
                        video.educationalScore += confidenceBoost;
                        video.relevanceConfidence = relevanceCheck.confidence || 5;
                        relevantVideos.push(video);
                        log(`RELEVANT VIDEO: "${video.title}" (Confidence: ${relevanceCheck.confidence || 'N/A'}) - ${relevanceCheck.reason}`);
                    } else {
                        log(`FILTERED OUT: "${video.title}" - ${relevanceCheck.reason}`);
                    }
                    
                    // Stop when we have enough HIGH-CONFIDENCE relevant videos
                    if (relevantVideos.length >= 6) break;
                }
                
                // Further filter by confidence if we have multiple options
                if (relevantVideos.length > 3) {
                    relevantVideos.sort((a, b) => {
                        const confidenceDiff = (b.relevanceConfidence || 5) - (a.relevanceConfidence || 5);
                        if (Math.abs(confidenceDiff) > 2) return confidenceDiff;
                        return b.educationalScore - a.educationalScore;
                    });
                    relevantVideos = relevantVideos.slice(0, 4); // Keep only top 4 most relevant
                }
                
                log(`Relevant videos after filtering: ${relevantVideos.length}`);
                
                // If no relevant videos found, fall back to original top videos with warning
                if (relevantVideos.length === 0) {
                    log("WARNING: No relevant videos found, using top search results as fallback");
                    currentVideoChoices = uniqueVideos.slice(0, 3);
                } else {
                    currentVideoChoices = relevantVideos.sort((a, b) => b.educationalScore - a.educationalScore);
                }
                
                if (currentVideoChoices.length === 0) {
                    await this.createFallbackContent(learningPoint);
                    return;
                }
                
                log(`FLOW: Found ${currentVideoChoices.length} relevant videos for "${learningPoint}"`);
                this.autoSelectBestVideo(learningPoint);
            } catch (error) {
                logError('Video search failed:', error);
                await this.createFallbackContent(learningPoint);
            }
        }

        async autoSelectBestVideo(learningPoint) {
            log("FLOW: Step 4 - Auto-selecting best video with final validation");
            updateStatus('choosing_video');
            
            // Get the top candidate
            let bestVideo = currentVideoChoices[0];
            
            // Double-check the selected video with an even stricter prompt
            const finalCheck = await this.gemini.checkVideoRelevance(bestVideo.title, learningPoint, currentLessonPlan.topic);
            
            // If the best video fails the final check, try the next one
            if (!finalCheck.relevant && currentVideoChoices.length > 1) {
                log(`FINAL CHECK: Best video "${bestVideo.title}" failed final relevance check. Trying next option.`);
                bestVideo = currentVideoChoices[1];
                const secondCheck = await this.gemini.checkVideoRelevance(bestVideo.title, learningPoint, currentLessonPlan.topic);
                if (!secondCheck.relevant && currentVideoChoices.length > 2) {
                    bestVideo = currentVideoChoices[2];
                    log(`FINAL CHECK: Trying third option: "${bestVideo.title}"`);
                }
            }
            
            log(`FLOW: Final selected video: ${bestVideo.title} (ID: ${bestVideo.youtubeId})`);
            displayStatusMessage('✅ Video selected!', `"${bestVideo.title}"`);
            setTimeout(() => this.generateSegments(bestVideo), 1500);
        }

        async createFallbackContent(learningPoint) {
            log("FLOW: Step 4B - Creating fallback content");
            updateStatus('generating_segments');
            displayStatusMessage('🤖 Creating custom content...', 'No suitable videos found. Generating text explanation...');
            const explanation = await this.gemini.generateDetailedExplanation(learningPoint);
            if (explanation) {
                displayStatusMessage('📚 Learning segment', `Topic: "${learningPoint}"`);
                displayTextContent(explanation);
                await this.speechEngine.play(explanation, {
                    onProgress: (progress) => animateTextProgress(explanation, progress),
                    onComplete: () => { if (lessonState === 'generating_segments') this.showQuiz(); }
                });
            } else {
                displayStatusMessage('⏭️ Skipping segment', 'Could not generate content. Moving on...');
                setTimeout(() => this.processNextLearningPoint(), 2000);
            }
        }

        async generateSegments(video) {
            log("FLOW: Step 7 - Generate segments");
            updateStatus('generating_segments');
            displayStatusMessage('✂️ Finding best segments...', `Analyzing: "${video.title}"`);
            try {
                const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
                const youtubeUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;
                currentSegments = await this.gemini.findVideoSegments(video.title, youtubeUrl, learningPoint);
                if (!currentSegments || currentSegments.length === 0) {
                    currentSegments = [{ startTime: 30, endTime: 180, reason: "Default educational segment" }];
                }
                log(`Generated ${currentSegments.length} segments:`, currentSegments);
                currentSegmentPlayIndex = 0;
                this.playSegments(video);
            } catch (error) {
                logError('Failed to generate segments:', error);
                currentSegments = [{ startTime: 30, endTime: 180, reason: "Fallback segment due to error" }];
                this.playSegments(video);
            }
        }

        playSegments(video) {
            log("FLOW: Step 8 - Play segments");
            updateStatus('playing_video');
            updatePlayPauseIcon();
            this.createYouTubePlayer(video);
        }

        createYouTubePlayer(videoInfo) {
            if (this.youtubePlayer) { try { this.youtubePlayer.destroy(); } catch (e) {} this.youtubePlayer = null; }

            // Hide text display and show video player area
            hideTextDisplay();
            ui.skipVideoButton.style.display = 'block';

            log(`Creating player for video: ${videoInfo.youtubeId}`);
            if (!videoInfo || !videoInfo.youtubeId || videoInfo.youtubeId.length !== 11) {
                logError('Invalid video info provided to player:', videoInfo);
                this.handleVideoError();
                return;
            }
            if (!currentSegments || currentSegments.length === 0) {
                currentSegments = [{ startTime: 30, endTime: 180, reason: "Default segment" }];
            }
            currentSegmentPlayIndex = 0;
            this.currentVideoInfo = videoInfo;
            this.playCurrentSegment();
        }

        playCurrentSegment() {
            if (currentSegmentPlayIndex >= currentSegments.length) {
                log('FLOW: All segments complete');
                this.handleVideoEnd();
                return;
            }
            const segment = currentSegments[currentSegmentPlayIndex];
            log(`Playing segment ${currentSegmentPlayIndex + 1}/${currentSegments.length}: ${segment.startTime}s - ${segment.endTime}s`);

            if (this.youtubePlayer) { try { this.youtubePlayer.destroy(); } catch (e) {} }
            if (this.segmentTimer) clearInterval(this.segmentTimer);

            const playerDivId = 'youtube-player-' + Date.now();
            ui.youtubePlayerContainer.innerHTML = `<div id="${playerDivId}" class="w-full h-full"></div>`;

            let startTime = Math.max(0, segment.startTime || 30);
            this.currentSegmentEndTime = segment.endTime || (startTime + 120);

            const playerTimeout = setTimeout(() => { logError('Video loading timeout'); this.tryNextSegmentOrQuiz(); }, 12000);

            try {
                this.youtubePlayer = new YT.Player(playerDivId, {
                    height: '100%', width: '100%', videoId: this.currentVideoInfo.youtubeId,
                    playerVars: { autoplay: 1, controls: 1, rel: 0, start: startTime, modestbranding: 1, iv_load_policy: 3, enablejsapi: 1, origin: window.location.origin, fs: 0 },
                    events: {
                        'onReady': (event) => {
                            clearTimeout(playerTimeout);
                            log('YouTube player ready.');
                            event.target.playVideo();
                            this.startSegmentTimer();
                        },
                        'onStateChange': (event) => {
                            if (event.data === YT.PlayerState.PLAYING) { clearTimeout(playerTimeout); updateStatus('playing_video'); }
                            if (event.data === YT.PlayerState.PAUSED) updateStatus('paused');
                            if (event.data === YT.PlayerState.ENDED) this.endCurrentSegment();
                        },
                        'onError': (event) => {
                            clearTimeout(playerTimeout);
                            logError(`Youtube player error: ${event.data}`);
                            this.tryNextSegmentOrQuiz();
                        }
                    }
                });
            } catch (error) {
                clearTimeout(playerTimeout);
                logError('Failed to create YouTube player:', error);
                this.tryNextSegmentOrQuiz();
            }
        }

        startSegmentTimer() {
            if (this.segmentTimer) clearInterval(this.segmentTimer);
            this.segmentTimer = setInterval(() => {
                if (this.youtubePlayer && typeof this.youtubePlayer.getCurrentTime === 'function') {
                    const currentTime = this.youtubePlayer.getCurrentTime();
                    if (currentTime >= this.currentSegmentEndTime) {
                        log(`Segment timer ended segment.`);
                        this.endCurrentSegment();
                    }
                }
            }, 1000);
        }

        endCurrentSegment() {
            if (this.segmentTimer) clearInterval(this.segmentTimer);
            this.segmentTimer = null;
            log('Ending current segment');
            currentSegmentPlayIndex++;
            setTimeout(() => this.playCurrentSegment(), 500);
        }

        tryNextSegmentOrQuiz() {
            if (this.segmentTimer) clearInterval(this.segmentTimer);
            currentSegmentPlayIndex++;
            if (currentSegmentPlayIndex >= currentSegments.length) {
                this.handleVideoEnd();
            } else {
                log('Trying next segment after error/timeout');
                setTimeout(() => this.playCurrentSegment(), 1000);
            }
        }

        async handleVideoEnd() {
            log('Video playbook finished');
            ui.skipVideoButton.style.display = 'none';
            
            // Cleanup video player first
            if (this.youtubePlayer) { try { this.youtubePlayer.destroy(); } catch(e){} this.youtubePlayer = null; }
            ui.youtubePlayerContainer.innerHTML = '';
            
            // Force show text display for concluding narration
            showTextDisplay();
            
            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            
            // Show the teleprompter with concluding narration
            log('FLOW: Starting concluding narration sequence for:', learningPoint);
            console.log('DEBUG: Pre-narration state check:', {
                learningPoint,
                lessonState,
                speechEngineState: {
                    isPlaying: this.speechEngine.isPlaying,
                    isPaused: this.speechEngine.isPaused
                }
            });
            
            // Show initial text while generating narration
            displayStatusMessage('🎯 Wrapping up...', `Summarizing: "${learningPoint}"`);
            
            // Wait for concluding narration to complete before showing quiz
            await this.playConcludingNarration(learningPoint);
            
            console.log('DEBUG: Post-narration state check:', {
                lessonState,
                speechEngineState: {
                    isPlaying: this.speechEngine.isPlaying,
                    isPaused: this.speechEngine.isPaused
                }
            });
            
            this.showQuiz();
        }

        handleVideoError() {
            logError('Handling video error. Creating fallback content.');
            ui.skipVideoButton.style.display = 'none';
            // Show text display for fallback content
            showTextDisplay();
            if (this.youtubePlayer) { try { this.youtubePlayer.destroy(); } catch(e){} }
            ui.youtubePlayerContainer.innerHTML = '';
            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            displayStatusMessage('🎥 Video unavailable', 'Creating educational content instead...');
            setTimeout(async () => { await this.createFallbackContent(learningPoint); }, 1000);
        }

        async showQuiz() {
            log("FLOW: Step 9 - Show quiz");
            updateStatus('quiz');
            ui.lessonControls.style.display = 'none';

            // Hide text display for quiz
            hideTextDisplay();

            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            const quiz = await this.gemini.generateQuiz(learningPoint);

            if (quiz && quiz.question) {
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
                        <div class="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6 border border-white/20">
                            <p class="text-xl lg:text-2xl leading-relaxed">${quiz.question}</p>
                        </div>
                        <div class="space-y-4 mb-6">
                            ${quiz.options.map((option, index) => `<button class="quiz-option w-full text-left p-4 bg-blue-600 hover:bg-blue-700 rounded-xl transition-all" data-index="${index}"><span>${String.fromCharCode(65 + index)})</span> <span class="ml-3">${option}</span></button>`).join('')}
                        </div>
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
            log("FLOW: Step 10 - Show lesson summary");
            updateStatus('summary');
            ui.lessonControls.style.display = 'none';
            // Hide text display for summary
            hideTextDisplay();

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
                    <button id="finish-lesson-button" class="bg-purple-600 hover:bg-purple-700 px-10 py-4 rounded-xl font-semibold text-lg transition-transform transform hover:scale-105">Finish Lesson & Start Over</button>
                </div>`;

            document.getElementById('finish-lesson-button').addEventListener('click', resetUIState);
        }
    }

    // =================================================================================
    // --- NEW TEXT DISPLAY SYSTEM ---
    // =================================================================================

    function showTextDisplay() {
        if (!ui.canvas) return;
        
        // Make canvas visible and interactive
        ui.canvas.style.display = 'block';
        ui.canvas.style.opacity = '1';
        ui.canvas.style.pointerEvents = 'auto';
        ui.canvas.style.zIndex = '25';
        
        // Hide YouTube player completely during text display
        ui.youtubePlayerContainer.style.display = 'none';
        ui.youtubePlayerContainer.innerHTML = '';
        
        log('TEXT DISPLAY: Canvas is now visible');
    }

    function hideTextDisplay() {
        if (!ui.canvas) return;
        
        // Hide canvas
        ui.canvas.style.opacity = '0';
        ui.canvas.style.pointerEvents = 'none';
        ui.canvas.style.zIndex = '20';
        
        // Show YouTube player area
        ui.youtubePlayerContainer.style.display = 'block';
        
        log('TEXT DISPLAY: Canvas is now hidden');
    }

    function displayTextContent(text) {
        if (!ui.canvas || !text) {
            log('TEXT DISPLAY: Missing canvas or text');
            return;
        }
        
        // Ensure text display is visible
        showTextDisplay();
        
        // Force canvas to proper size
        const containerRect = ui.canvas.parentElement.getBoundingClientRect();
        ui.canvas.width = containerRect.width;
        ui.canvas.height = containerRect.height;
        
        const ctx = ui.canvas.getContext('2d');
        
        // Clear entire canvas
        ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
        
        // Create dark background with gradient
        const bgGradient = ctx.createLinearGradient(0, 0, 0, ui.canvas.height);
        bgGradient.addColorStop(0, '#1e293b');
        bgGradient.addColorStop(0.5, '#0f172a');
        bgGradient.addColorStop(1, '#1e1b4b');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
        
        // Configure text rendering with enhanced mobile optimization
        const isMobile = ui.canvas.width <= 768;
        const isVerySmall = ui.canvas.width <= 400;
        const baseSize = Math.min(ui.canvas.width, ui.canvas.height);
        
        let fontSize, lineHeight, maxWidth, padding;
        if (isVerySmall) {
            // Very small screen optimization
            fontSize = Math.max(16, Math.min(baseSize / 25, 24));
            lineHeight = fontSize * 1.3;
            maxWidth = ui.canvas.width * 0.95;
            padding = ui.canvas.width * 0.025;
        } else if (isMobile) {
            // Mobile-optimized text sizing
            fontSize = Math.max(18, Math.min(baseSize / 22, 28));
            lineHeight = fontSize * 1.35;
            maxWidth = ui.canvas.width * 0.94;
            padding = ui.canvas.width * 0.03;
        } else {
            // Desktop sizing
            fontSize = Math.max(28, Math.min(baseSize / 18, 52));
            lineHeight = fontSize * 1.6;
            maxWidth = ui.canvas.width * 0.88;
            padding = ui.canvas.width * 0.06;
        }
        
        ctx.font = `600 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // White text with optimized shadow for mobile
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = isMobile ? 3 : 8;
        ctx.shadowOffsetX = isMobile ? 1 : 3;
        ctx.shadowOffsetY = isMobile ? 1 : 3;
        
        // Enhanced word wrapping for mobile
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = words[i];
                
                // Handle very long words on mobile
                if (isMobile && ctx.measureText(currentLine).width > maxWidth) {
                    // Break very long words
                    const chars = currentLine.split('');
                    let breakLine = '';
                    for (let j = 0; j < chars.length; j++) {
                        const testChar = breakLine + chars[j];
                        if (ctx.measureText(testChar + '-').width > maxWidth && breakLine) {
                            lines.push(breakLine + '-');
                            breakLine = chars[j];
                        } else {
                            breakLine = testChar;
                        }
                    }
                    currentLine = breakLine;
                }
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) {
            lines.push(currentLine);
        }
        
        // Calculate vertical positioning with better mobile spacing
        const totalTextHeight = lines.length * lineHeight;
        const availableHeight = ui.canvas.height - (padding * 2);
        const startY = Math.max(
            padding + (lineHeight / 2),
            (ui.canvas.height / 2) - (totalTextHeight / 2) + (lineHeight / 2)
        );
        
        // Draw each line with mobile optimization
        lines.forEach((line, index) => {
            const lineY = startY + (index * lineHeight);
            // Only draw lines that are visible
            if (lineY >= 0 && lineY <= ui.canvas.height) {
                ctx.fillText(line, ui.canvas.width / 2, lineY);
            }
        });
        
        // Reset shadow settings
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        log(`TEXT DISPLAY: Rendered "${text.substring(0, 50)}..." for ${isVerySmall ? 'very small' : isMobile ? 'mobile' : 'desktop'}`);
    }

    function animateTextProgress(fullText, progress) {
        if (!ui.canvas || !fullText) return;
        
        // Ensure text display is visible
        showTextDisplay();
        
        // Force canvas to proper size
        const containerRect = ui.canvas.parentElement.getBoundingClientRect();
        ui.canvas.width = containerRect.width;
        ui.canvas.height = containerRect.height;
        
        const ctx = ui.canvas.getContext('2d');
        
        // Clear and setup background
        ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
        
        const bgGradient = ctx.createLinearGradient(0, 0, 0, ui.canvas.height);
        bgGradient.addColorStop(0, '#1e293b');
        bgGradient.addColorStop(0.5, '#0f172a');
        bgGradient.addColorStop(1, '#1e1b4b');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
        
        // Configure text with mobile optimization
        const isMobile = ui.canvas.width <= 768;
        const baseSize = Math.min(ui.canvas.width, ui.canvas.height);
        
        let fontSize, lineHeight, maxWidth, padding;
        if (isMobile) {
            fontSize = Math.max(18, Math.min(baseSize / 20, 32));
            lineHeight = fontSize * 1.4;
            maxWidth = ui.canvas.width * 0.92;
            padding = ui.canvas.width * 0.04;
        } else {
            fontSize = Math.max(28, Math.min(baseSize / 18, 52));
            lineHeight = fontSize * 1.6;
            maxWidth = ui.canvas.width * 0.88;
            padding = ui.canvas.width * 0.06;
        }
        
        ctx.font = `600 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = isMobile ? 4 : 8;
        ctx.shadowOffsetX = isMobile ? 1 : 3;
        ctx.shadowOffsetY = isMobile ? 1 : 3;
        
        // Split into lines
        const words = fullText.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (let i = 0; i < words.length; i++) {
            const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = words[i];
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) {
            lines.push(currentLine);
        }
        
        // Calculate positioning with mobile-optimized scroll effect
        const totalTextHeight = lines.length * lineHeight;
        const availableHeight = ui.canvas.height - (padding * 2);
        const startY = Math.max(
            padding + (lineHeight / 2),
            (ui.canvas.height / 2) - (totalTextHeight / 2) + (lineHeight / 2)
        );
        
        // Apply scroll based on progress with mobile optimization
        const scrollDistance = Math.max(0, totalTextHeight - availableHeight + lineHeight * (isMobile ? 2 : 3));
        const currentScroll = progress * scrollDistance;
        
        // Draw lines with highlighting and fade effects
        lines.forEach((line, index) => {
            const lineY = startY + (index * lineHeight) - currentScroll;
            
            // Only render visible lines
            if (lineY > -lineHeight && lineY < ui.canvas.height + lineHeight) {
                // Calculate opacity based on position
                let opacity = 1;
                const fadeZone = lineHeight * (isMobile ? 1 : 1.5);
                
                if (lineY < fadeZone + padding) {
                    opacity = Math.max(0.2, (lineY - padding) / fadeZone);
                } else if (lineY > ui.canvas.height - fadeZone - padding) {
                    opacity = Math.max(0.2, (ui.canvas.height - lineY - padding) / fadeZone);
                }
                
                // Highlight current reading position
                const lineProgress = Math.max(0, Math.min(1, (progress * lines.length) - index));
                if (lineProgress > 0.8) {
                    // Currently reading
                    ctx.fillStyle = `rgba(34, 197, 94, ${opacity})`;
                } else if (lineProgress > 0) {
                    // Partially read
                    ctx.fillStyle = `rgba(59, 130, 246, ${opacity})`;
                } else {
                    // Not yet read
                    ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.8})`;
                }
                
                ctx.fillText(line, ui.canvas.width / 2, lineY);
            }
        });
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        log(`TEXT ANIMATION: Progress ${(progress * 100).toFixed(1)}% (${isMobile ? 'mobile' : 'desktop'})`);
    }

    function displayStatusMessage(mainText, subText = '') {
        showTextDisplay();
        
        if (!ui.canvas) return;
        
        // Force proper canvas sizing
        const containerRect = ui.canvas.parentElement.getBoundingClientRect();
        ui.canvas.width = containerRect.width;
        ui.canvas.height = containerRect.height;
        
        const ctx = ui.canvas.getContext('2d');
        ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
        
        // Dark background with blue gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, ui.canvas.height);
        gradient.addColorStop(0, '#1e3a8a');
        gradient.addColorStop(0.5, '#0f172a');
        gradient.addColorStop(1, '#7c3aed');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
        
        // Enhanced mobile text styling
        const isMobile = ui.canvas.width <= 768;
        const isVerySmall = ui.canvas.width <= 400;
        const baseSize = Math.min(ui.canvas.width, ui.canvas.height);
        
        let fontSize, maxWidth, spacing;
        if (isVerySmall) {
            fontSize = Math.max(20, Math.min(baseSize / 20, 32));
            maxWidth = ui.canvas.width * 0.95;
            spacing = 25;
        } else if (isMobile) {
            fontSize = Math.max(24, Math.min(baseSize / 18, 40));
            maxWidth = ui.canvas.width * 0.92;
            spacing = 30;
        } else {
            fontSize = Math.max(32, Math.min(baseSize / 16, 56));
            maxWidth = ui.canvas.width * 0.85;
            spacing = 40;
        }
        
        ctx.font = `bold ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = isMobile ? 4 : 6;
        ctx.shadowOffsetX = isMobile ? 1 : 2;
        ctx.shadowOffsetY = isMobile ? 1 : 2;

        // Handle word wrapping for main text on mobile
        if (isMobile && ctx.measureText(mainText).width > maxWidth) {
            const words = mainText.split(' ');
            const lines = [];
            let currentLine = '';
            
            for (let i = 0; i < words.length; i++) {
                const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
                if (ctx.measureText(testLine).width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = words[i];
                } else {
                    currentLine = testLine;
                }
            }
            if (currentLine) lines.push(currentLine);
            
            // Draw wrapped main text
            const lineHeight = fontSize * 1.2;
            const totalHeight = lines.length * lineHeight;
            const startY = (ui.canvas.height / 2) - (totalHeight / 2) + (lineHeight / 2) - (subText ? spacing/2 : 0);
            
            lines.forEach((line, index) => {
                ctx.fillText(line, ui.canvas.width / 2, startY + (index * lineHeight));
            });
        } else {
            // Single line main text
            ctx.fillText(mainText, ui.canvas.width / 2, ui.canvas.height / 2 - (subText ? spacing/2 : 0));
        }

        // Sub text with mobile optimization
        if (subText) { 
            const subFontSize = Math.max(isMobile ? 14 : 20, fontSize * (isMobile ? 0.55 : 0.6)); 
            ctx.font = `${subFontSize}px Inter, sans-serif`; 
            ctx.fillStyle = 'rgba(200, 200, 200, 0.9)'; 
            
            // Handle word wrapping for sub text on mobile
            if (isMobile && ctx.measureText(subText).width > maxWidth) {
                const words = subText.split(' ');
                const lines = [];
                let currentLine = '';
                
                for (let i = 0; i < words.length; i++) {
                    const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
                    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = words[i];
                    } else {
                        currentLine = testLine;
                    }
                }
                if (currentLine) lines.push(currentLine);
                
                // Draw wrapped sub text
                const lineHeight = subFontSize * 1.2;
                const startY = ui.canvas.height / 2 + spacing/2;
                
                lines.forEach((line, index) => {
                    ctx.fillText(line, ui.canvas.width / 2, startY + (index * lineHeight));
                });
            } else {
                ctx.fillText(subText, ui.canvas.width / 2, ui.canvas.height / 2 + spacing);
            }
        }
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        log(`STATUS MESSAGE: "${mainText}"`);
    }

    // =================================================================================
    // --- UTILITY & UI FUNCTIONS ---
    // =================================================================================

    const learningPipeline = new LearningPipeline();

    function updateStatus(state) { lessonState = state; log(`STATE: ${state}`); }

    function initializeUI() {
        ui.curateButton.addEventListener('click', handleCurateClick);
        ui.playPauseButton.addEventListener('click', playPauseLesson);
        ui.nextSegmentButton.addEventListener('click', () => { if (!ui.nextSegmentButton.disabled) { ui.nextSegmentButton.disabled = true; learningPipeline.processNextLearningPoint(); } });
        ui.skipVideoButton.addEventListener('click', () => { if (lessonState === 'playing_video' || lessonState === 'paused') { if (learningPipeline.segmentTimer) clearInterval(learningPipeline.segmentTimer); learningPipeline.handleVideoEnd(); } });
        // The official YT API script will call this function globally
        window.onYouTubeIframeAPIReady = () => {
            log("YouTube IFrame API is ready.");
        };
    }

    function playPauseLesson() {
        log(`Play/Pause clicked - State: ${lessonState}`);
        switch (lessonState) {
            case 'narrating': learningPipeline.speechEngine.pause(); updateStatus("paused"); break;
            case 'playing_video': learningPipeline.youtubePlayer?.pauseVideo(); updateStatus("paused"); break;
            case 'paused':
                if (learningPipeline.speechEngine.isPaused) { learningPipeline.speechEngine.resume(); updateStatus("narrating"); } 
                else if (learningPipeline.youtubePlayer) { learningPipeline.youtubePlayer.playVideo(); updateStatus("playing_video"); }
                break;
        }
        updatePlayPauseIcon();
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
        resetUIState(false); // Don't reset to initial view yet
        ui.curateButton.disabled = true;
        ui.headerDescription.classList.add('hidden');
        ui.headerFeatures.classList.add('hidden');
        // Add fallback class for browsers without :has() support
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
        document.getElementById('progress-spacer').classList.add('hidden');
        ui.inputSection.classList.remove('hidden');
        ui.curateButton.disabled = false;

        if (fullReset) {
            ui.headerDescription.classList.remove('hidden');
            ui.headerFeatures.classList.remove('hidden');
            // Remove fallback class
            document.querySelector('header').classList.remove('content-hidden');
        }

        currentLessonPlan = null;
        currentLearningPath = null;
        currentSegmentIndex = -1;
        updateStatus('idle');
    }

    function displayError(message) { logError(message); ui.errorMessage.textContent = message; ui.errorDisplay.classList.remove('hidden'); setTimeout(() => ui.errorDisplay.classList.add('hidden'), 5000); }

    // Initialize
    initializeUI();
    if (localStorage.getItem('lastTopic')) {
        ui.topicInput.value = localStorage.getItem('lastTopic');
    }
});
