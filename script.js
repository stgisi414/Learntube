document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // --- CORE STATE & UI REFERENCES ---
    // =================================================================================
    let currentLessonPlan = null;
    let currentLearningPath = null;
    let currentSegmentIndex = -1;
    let lessonState = 'idle'; // 'idle', 'narrating', 'choosing_video', 'fetching_transcript', 'finding_segments', 'playing_video', 'paused', 'ending'

    const ui = {
        topicInput: document.getElementById('topic-input'),
        curateButton: document.getElementById('curate-button'),
        inputSection: document.getElementById('input-section'),
        loadingIndicator: document.getElementById('loading-indicator'),
        loadingMessage: document.getElementById('loading-message'),
        levelSelection: document.getElementById('level-selection'),
        levelButtonsContainer: document.getElementById('level-buttons-container'),
        learningCanvasContainer: document.getElementById('learning-canvas-container'),
        canvas: document.getElementById('lessonCanvas'),
        playPauseButton: document.getElementById('play-pause-button'),
        playIcon: document.getElementById('play-icon'),
        pauseIcon: document.getElementById('pause-icon'),
        nextSegmentButton: document.getElementById('next-segment-button'),
        skipVideoButton: document.getElementById('skip-video-button'),
        currentTopicDisplay: document.getElementById('current-topic-display'),
        segmentProgress: document.getElementById('segment-progress'),
        errorDisplay: document.getElementById('error-display'),
        errorMessage: document.getElementById('error-message'),
    };
    const canvasCtx = ui.canvas.getContext('2d');

    // =================================================================================
    // --- API & CONFIGURATION ---
    // =================================================================================
    const GEMINI_API_KEY = "AIzaSyAo4mWr5x3UPEACzFC3_6W0bd1DG8dCudA";
    const YOUTUBE_API_KEY = "AIzaSyDbxmMIxsnVWW16iHrVrq1kNe9KTTSpNH4";
    const CSE_ID = 'b53121b78d1c64563';
    const SUPADATA_API_KEY = "sd_1d4e0e4e3d5aecda115fc39d1d47a33b";
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
        async executeSingleRequest(prompt, options = {}) { const defaultConfig = { temperature: 0.7, maxOutputTokens: 2048, ...options }; const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: defaultConfig }) }); if (!response.ok) { throw new Error(`Gemini API failed: ${response.status} ${response.statusText}`); } const data = await response.json(); const content = data.candidates?.[0]?.content?.parts?.[0]?.text; if (!content) { throw new Error('No content in Gemini response'); } return content.trim(); }
        parseJSONResponse(response) { if(!response) return null; try { let cleanedResponse = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, ''); const jsonMatch = cleanedResponse.match(/(\{[\s\S]*\}|\[[\s\S]*\])/); if (jsonMatch) { return JSON.parse(jsonMatch[0]); } logError(`No valid JSON found in response:`, response); return null; } catch (error) { logError(`Failed to parse JSON:`, error, `Raw response: "${response}"`); return null; } }
        
        // --- FIX: The following methods are now correctly part of the GeminiOrchestrator class ---
        async generateLessonPlan(topic) {
            log("GEMINI: Generating lesson plan...");
            const prompt = `Create a comprehensive, 4-level learning curriculum for "${topic}". Each level (Apprentice, Journeyman, Senior, Master) must have exactly 5 specific, searchable learning points. Return ONLY valid JSON.`;
            const response = await this.makeRequest(prompt);
            return this.parseJSONResponse(response);
        }

        async generateSearchQueries(learningPoint, topic) {
            log(`GEMINI: Generating search queries for "${learningPoint}"`);
            const prompt = `Generate 5 highly-specific, educational YouTube search queries for "${learningPoint}" within the broader topic of "${topic}". Focus on "how-to", "tutorial", "explained", "documentary", and "academic lecture". Avoid generic or irrelevant terms. Return ONLY a JSON array.`;
            const response = await this.makeRequest(prompt, { temperature: 0.6 });
            return this.parseJSONResponse(response);
        }

        async generateNarration(learningPoint, previousPoint, videoTitle) {
            log(`GEMINI: Generating narration for "${learningPoint}"`);
            let prompt;
            if (previousPoint) {
                prompt = `Previous topic: "${previousPoint}". Current topic: "${learningPoint}". Video title: "${videoTitle}". Create a concise, engaging 2-sentence narration (50-80 words) to bridge these topics and introduce the video. Return ONLY the narration text.`;
            } else {
                prompt = `This is the start of a lesson on "${learningPoint}". Video title: "${videoTitle}". Create a concise, engaging 2-sentence opening narration (50-80 words) to welcome the learner and introduce the video. Return ONLY the narration text.`;
            }
            return await this.makeRequest(prompt, { temperature: 0.8 });
        }

        async findVideoSegments(videoTitle, transcript, learningPoint) {
            log(`SEGMENTER: Analyzing transcript for "${learningPoint}"`);
            if (!transcript) {
                log("SEGMENTER WARN: No transcript provided. Returning a single 3-minute fallback segment.");
                return [{ startTime: 0, endTime: 180, reason: "Full video playback (no transcript available)." }];
            }
            const prompt = `You are a precise video editor. Analyze this transcript for a video titled "${videoTitle}" to find the best segments that teach about: "${learningPoint}".\n\nTranscript (first 15,000 chars):\n"""\n${transcript.substring(0, 15000)}\n"""\n\nRules:\n1. Find all distinct, relevant segments based on the transcript.\n2. Each segment MUST be 20-90 seconds long.\n3. The TOTAL duration of all segments MUST be between 45 and 240 seconds.\n4. Prioritize parts where the speaker clearly explains the learning point.\n\nReturn ONLY a valid JSON array of objects like [{"startTime": 120, "endTime": 165, "reason": "Explains core definition."}], or an empty array if no good segments are found.`;
            const response = await this.makeRequest(prompt, { temperature: 0.2, maxOutputTokens: 1024 });
            const segments = this.parseJSONResponse(response);
            if (Array.isArray(segments) && segments.length > 0) {
                log(`SEGMENTER: Found ${segments.length} high-quality segments.`);
                return segments;
            } else {
                log("SEGMENTER WARN: AI could not find specific segments. Creating a fallback.");
                return [{ startTime: 0, endTime: 180, reason: "Full video fallback." }];
            }
        }
    }

    class VideoSourcer {
        constructor() {}
        async getTranscript(videoId) {
            log(`TRANSCRIPT API: Fetching for videoId: ${videoId}`);
            const transcriptUrl = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`;
            try {
                const response = await fetch(transcriptUrl, { headers: { 'x-api-key': SUPADATA_API_KEY } });
                if (!response.ok) { logError(`SupaData API failed: ${response.status}`); return null; }
                const data = await response.json();
                if (data && Array.isArray(data) && data.length > 0) {
                    const transcript = data.map(line => line.text).join(' ');
                    log(`TRANSCRIPT API: Success, transcript length: ${transcript.length}`);
                    return transcript;
                }
                log("TRANSCRIPT API WARN: No transcript data returned.");
                return null;
            } catch (error) { logError('Error fetching transcript:', error); return null; }
        }
        async searchYouTube(query) {
            log(`SEARCH API: Searching YouTube Data API for: "${query}"`);
            const Youtube_API_URL = 'https://www.googleapis.com/youtube/v3/search';

            // Note: The YOUTUBE_API_KEY from the top of the file is used here.
            const searchParams = new URLSearchParams({
                part: 'snippet',
                q: query,
                key: YOUTUBE_API_KEY,
                type: 'video',
                videoCaption: 'closedCaption', // CRITICAL FIX: Only find videos with captions.
                maxResults: 5,
                order: 'relevance'
            });

            try {
                const response = await fetch(`${Youtube_API_URL}?${searchParams}`);
                if (!response.ok) {
                    const errorData = await response.json();
                    // Provide a more detailed error message from the API itself.
                    throw new Error(`YouTube Data API failed: ${response.status} - ${errorData.error.message}`);
                }
                const data = await response.json();

                if (!data.items) return [];

                // Transform the v3 search results into the format the app expects.
                return data.items.map(item => {
                    if (item.id && item.id.videoId) {
                        return {
                            youtubeId: item.id.videoId,
                            title: item.snippet.title,
                            description: item.snippet.description,
                            thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || ''
                        };
                    }
                    return null;
                }).filter(Boolean);

            } catch (error) {
                logError("Youtube Failed:", error);
                // Propagate the error to the UI so the user isn't left wondering.
                handleVideoError(error); 
                return [];
            }
        }
    }

    class SpeechEngine {
        constructor() { this.apiKey = "AIzaSyA43RRVypjAAXwYdpKrojWVmdRAGyLKwr8"; this.apiUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize'; this.audioElement = new Audio(); this.onCompleteCallback = null; this.onProgressCallback = null; }
        async play(text, { onProgress = null, onComplete = null } = {}) { this.stop(); if (!text) { if (onComplete) onComplete(); return; } this.onProgressCallback = onProgress; this.onCompleteCallback = onComplete; try { const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, { method: 'POST', body: JSON.stringify({ input: { text }, voice: { languageCode: 'en-US', name: 'en-US-Standard-C' }, audioConfig: { audioEncoding: 'MP3' } }) }); if (!response.ok) { const d = await response.json(); throw new Error(d.error.message); } const data = await response.json(); const audioBlob = this.base64ToBlob(data.audioContent, 'audio/mpeg'); this.audioElement.src = URL.createObjectURL(audioBlob); this.audioElement.play(); this.audioElement.ontimeupdate = () => { if (this.onProgressCallback && this.audioElement.duration) { this.onProgressCallback(this.audioElement.currentTime / this.audioElement.duration); } }; this.audioElement.onended = () => { if (this.onProgressCallback) this.onProgressCallback(1); if (this.onCompleteCallback) this.onCompleteCallback(); }; } catch (error) { log(`SpeechService Error: ${error}`); if (this.onCompleteCallback) this.onCompleteCallback(); } }
        pause() { this.audioElement.pause(); }
        resume() { this.audioElement.play(); }
        stop() { this.audioElement.pause(); if (this.audioElement.src) this.audioElement.currentTime = 0; }
        base64ToBlob(base64) { const byteCharacters = atob(base64); const byteArrays = []; for (let offset = 0; offset < byteCharacters.length; offset += 512) { const slice = byteCharacters.slice(offset, offset + 512); const byteNumbers = new Array(slice.length); for (let i = 0; i < slice.length; i++) { byteNumbers[i] = slice.charCodeAt(i); } byteArrays.push(new Uint8Array(byteNumbers)); } return new Blob(byteArrays, { type: 'audio/mpeg' }); }
    }

    class LearningPipeline {
        constructor() {
            this.gemini = new GeminiOrchestrator();
            this.videoSourcer = new VideoSourcer();
            this.speechEngine = new SpeechEngine();
            this.youtubePlayer = null;
            this.currentVideoChoices = []; // <-- ADD THIS LINE
        }

        async start(topic) {
            log("PIPELINE: Starting lesson plan generation...");
            showLoading("Generating comprehensive lesson plan...");
            const rawPlan = await this.gemini.generateLessonPlan(topic);
            hideLoading();

            // --- ADAPTER / TRANSFORMER FUNCTIONS ---

            /**
             * Adapter for the original, simple format, e.g., { "Apprentice": [...] }.
             * Recursively searches for the lesson plan object.
             * @param {object} obj The object to search.
             * @returns {object|null} The parsed lesson plan or null.
             */
            const findSimpleLessonPlan = (obj) => {
                if (!obj || typeof obj !== 'object') return null;
                const apprenticeKey = Object.keys(obj).find(k => k.toLowerCase() === 'apprentice');
                if (apprenticeKey && Array.isArray(obj[apprenticeKey])) {
                    if (obj.Journeyman || obj.Senior || obj.Master) return obj;
                }
                for (const key of Object.keys(obj)) {
                    const potentialPlan = findSimpleLessonPlan(obj[key]);
                    if (potentialPlan) return potentialPlan;
                }
                return null;
            };

            /**
             * Adapter for the new, complex format, e.g., { curriculum: { levels: [...] } }.
             * Transforms the complex structure into the simple format our app needs.
             * @param {object} plan The raw plan from the AI.
             * @returns {object|null} The transformed lesson plan or null.
             */
            const transformComplexLessonPlan = (plan) => {
                try {
                    if (plan && plan.curriculum && Array.isArray(plan.curriculum.levels)) {
                        const transformed = {};
                        plan.curriculum.levels.forEach(levelData => {
                            if (levelData.level && Array.isArray(levelData.learningPoints)) {
                                transformed[levelData.level] = levelData.learningPoints.map(lp => lp.point).filter(Boolean);
                            }
                        });
                        // A valid transformation must have produced an "Apprentice" level.
                        return transformed.Apprentice ? transformed : null;
                    }
                    return null;
                } catch (e) {
                    logError("Error during complex plan transformation", e);
                    return null;
                }
            };

            // --- PARSING STRATEGY ---
            // First, try the adapter for the new complex format. If it fails, fall back to the simple one.
            currentLessonPlan = transformComplexLessonPlan(rawPlan) || findSimpleLessonPlan(rawPlan);

            if (currentLessonPlan) {
                log("Successfully parsed lesson plan using one of the available adapters.", currentLessonPlan);
                currentLessonPlan.topic = topic;
                displayLevelSelection();
            } else {
                displayError("The AI returned a lesson plan in an unexpected format that could not be parsed.");
                const rawResponseForDebugging = JSON.stringify(rawPlan, null, 2);
                logError("Could not parse the lesson plan with any known adapter. Full raw AI response below:", rawResponseForDebugging);
                ui.curateButton.disabled = false;
            }
        }

        startLevel(level) {
            log(`PIPELINE: Starting level "${level}"`);
            currentLearningPath = level;
            currentSegmentIndex = -1;
            ui.levelSelection.classList.add('hidden');
            ui.learningCanvasContainer.classList.remove('hidden');
            processNextSegment();
        }

        async executeSegment(learningPoint, previousPoint) {
            updateStatus(`narrating`);
            ui.nextSegmentButton.disabled = true;

            const narrationText = await this.gemini.generateNarration(learningPoint, previousPoint, `a video about ${learningPoint}`);
            await this.speechEngine.play(narrationText, {
                onProgress: (progress) => updateTeleprompter(narrationText, progress),
                onComplete: () => {
                    if (lessonState === 'narrating') {
                        this.showVideoChoices(learningPoint);
                    }
                }
            });
        }

        async showVideoChoices(learningPoint) {
            updateStatus(`choosing_video`);
            updateCanvasVisuals(`🔎 Searching for a video about:`, `"${learningPoint}"`);

            const searchQueries = await this.gemini.generateSearchQueries(learningPoint, currentLessonPlan.topic);
            const potentialVideos = [];
            if (searchQueries) {
                for (const query of searchQueries) {
                    const results = await this.videoSourcer.searchYouTube(query);
                    potentialVideos.push(...results);
                    if (potentialVideos.length >= 5) break;
                }
            }

            this.currentVideoChoices = potentialVideos; // <-- ADD THIS LINE

            if (this.currentVideoChoices.length === 0) {
                handleVideoError(new Error("No videos found after searching all queries."));
                return;
            }
            displayVideoChoices(this.currentVideoChoices.slice(0, 5), learningPoint);
        }
        
        async handleVideoSelection(video) {
            updateStatus("validating_video");
            updateCanvasVisuals(`Verifying video has captions...`, `"${video.title}"`);

            // Validate the video for captions using a temporary player
            const hasCaptions = await new Promise((resolve) => {
                const tempPlayerId = 'temp-validation-player';
                let tempContainer = document.getElementById(tempPlayerId);
                if (!tempContainer) {
                    tempContainer = document.createElement('div');
                    tempContainer.id = tempPlayerId;
                    tempContainer.style.position = 'absolute';
                    tempContainer.style.left = '-9999px'; // Hide it off-screen
                    document.body.appendChild(tempContainer);
                }

                const validationPlayer = new YT.Player(tempPlayerId, {
                    videoId: video.youtubeId,
                    events: {
                        'onReady': () => {
                            let captionsAvailable = false;
                            try {
                                // Check the internal config as you specified.
                                if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.caption_tracks) {
                                    captionsAvailable = true;
                                }
                            } catch (e) { /* ignore error */ }
                            log(`VALIDATOR: Caption check for "${video.title}": ${captionsAvailable}`);
                            validationPlayer.destroy();
                            resolve(captionsAvailable);
                        },
                        'onError': () => {
                            logError(`VALIDATOR: Player error during caption check for ${video.youtubeId}.`);
                            validationPlayer.destroy();
                            resolve(false);
                        }
                    }
                });
                 // Add a timeout to prevent the app from getting stuck
                setTimeout(() => {
                    try { validationPlayer.destroy(); } catch(e){}
                    resolve(false);
                }, 8000);
            });

            // If the video does NOT have captions, remove it from the list and show the choices again.
            if (!hasCaptions) {
                logError(`Video rejected: "${video.title}" does not have captions.`);
                displayError(`Video "${video.title}" has no captions. Please select another.`);

                this.currentVideoChoices = this.currentVideoChoices.filter(v => v.youtubeId !== video.youtubeId);

                if (this.currentVideoChoices.length > 0) {
                    const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
                    displayVideoChoices(this.currentVideoChoices, learningPoint);
                } else {
                    handleVideoError(new Error("No other videos with captions were found."));
                }
                return; 
            }

            // If the video DOES have captions, proceed with the original logic.
            updateStatus("fetching_transcript");
            document.getElementById('youtube-player-container').innerHTML = '';
            updateCanvasVisuals('Fetching transcript...', `Please wait while we analyze "${video.title}"`);

            const transcript = await this.videoSourcer.getTranscript(video.youtubeId);

            if (!transcript) {
                 handleVideoError(new Error("Transcript fetch failed, though captions were detected."));
                 return;
            }

            updateStatus("finding_segments");
            updateCanvasVisuals('Finding best segments...', `Using the transcript to find key moments.`);

            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            const segments = await this.gemini.findVideoSegments(video.title, transcript, learningPoint);

            this.createYouTubePlayer({ ...video, segments });
        }

        createYouTubePlayer(videoInfo) {
            if (this.youtubePlayer) { this.youtubePlayer.destroy(); }
            
            ui.skipVideoButton.style.display = 'block';

            let segmentQueue = videoInfo.segments || [];
            if (!Array.isArray(segmentQueue) || segmentQueue.length === 0) {
                log("PLAYER WARN: Segment queue is empty or invalid. Creating a fallback.");
                segmentQueue = [{ startTime: 0, endTime: 180, reason: "Fallback: Full 3-minute segment" }];
            }
            let currentSegmentIdx = 0;

            const playNextSegmentInQueue = () => {
                if (currentSegmentIdx >= segmentQueue.length) {
                    log('PLAYER: Finished all video segments.');
                    handleVideoEnd();
                    return;
                }

                const segment = segmentQueue[currentSegmentIdx];
                if (typeof segment.startTime !== 'number' || typeof segment.endTime !== 'number') {
                    logError("Invalid segment found, skipping.", segment);
                    currentSegmentIdx++;
                    playNextSegmentInQueue();
                    return;
                }
                
                log(`PLAYER: Playing segment ${currentSegmentIdx + 1}/${segmentQueue.length}: ${segment.startTime}s to ${segment.endTime}s`);
                
                if (this.youtubePlayer) { this.youtubePlayer.destroy(); }
                
                this.youtubePlayer = new YT.Player('youtube-player-container', {
                    height: '100%', width: '100%', videoId: videoInfo.youtubeId,
                    playerVars: { autoplay: 1, controls: 1, rel: 0, start: segment.startTime, end: segment.endTime, modestbranding: 1, origin: window.location.origin },
                    events: {
                        'onReady': (event) => {
                            log(`PLAYER: Ready for segment ${currentSegmentIdx + 1}.`);
                            event.target.playVideo();
                        },
                        'onStateChange': (event) => {
                            if (event.data === YT.PlayerState.PLAYING) {
                                updateStatus('playing_video');
                                updatePlayPauseIcon();
                                ui.canvas.style.opacity = '0';
                            }
                            if (event.data === YT.PlayerState.ENDED) {
                                currentSegmentIdx++;
                                playNextSegmentInQueue();
                            }
                        },
                        'onError': (e) => { handleVideoError(new Error(`YouTube Player Error: ${e.data}`)); }
                    }
                });
            };
            playNextSegmentInQueue();
        }
    }

    // =================================================================================
    // --- GLOBAL SCOPE FUNCTIONS & EVENT HANDLERS ---
    // =================================================================================

    const learningPipeline = new LearningPipeline();

    function updateStatus(text) {
        lessonState = text;
        log(`STATE CHANGE: ${lessonState}`);
    }

    function handleVideoError(error) {
        if (lessonState === 'error') return;
        logError("Video Error Triggered:", error.message);
        updateStatus('error');
        if (learningPipeline.youtubePlayer) { learningPipeline.youtubePlayer.destroy(); learningPipeline.youtubePlayer = null; }
        const playerContainer = document.getElementById('youtube-player-container');
        if (playerContainer) { playerContainer.innerHTML = ''; }
        ui.canvas.style.opacity = '1';
        ui.skipVideoButton.style.display = 'none';
        displayErrorOnCanvas("Video Error", "There was a problem. Advancing...");
        setTimeout(() => processNextSegment(true), 3000);
    }

    function handleVideoEnd() {
        if (lessonState === 'ending' || lessonState === 'error') return;
        log("Video playback ended successfully.");
        updateStatus('ending');
        if (learningPipeline.youtubePlayer) { learningPipeline.youtubePlayer.destroy(); learningPipeline.youtubePlayer = null; }
        const playerContainer = document.getElementById('youtube-player-container');
        if (playerContainer) { playerContainer.innerHTML = ''; }
        ui.canvas.style.opacity = '1';
        ui.skipVideoButton.style.display = 'none';
        updateCanvasVisuals("Segment Complete!", "Click 'Next Segment' to continue.");
        ui.nextSegmentButton.disabled = false;
    }
    
    function initializeUI() {
        ui.curateButton.addEventListener('click', handleCurateClick);
        ui.playPauseButton.addEventListener('click', playPauseLesson);
        ui.nextSegmentButton.addEventListener('click', () => { if (!ui.nextSegmentButton.disabled) processNextSegment(true); });
        ui.skipVideoButton.addEventListener('click', () => { if (lessonState === 'playing_video' || lessonState === 'paused') handleVideoEnd(); });
    }

    function playPauseLesson() {
        log(`UI: playPauseLesson called in state: ${lessonState}`);
        switch (lessonState) {
            case 'narrating': learningPipeline.speechEngine.pause(); updateStatus("narration_paused"); break;
            case 'narration_paused': learningPipeline.speechEngine.resume(); updateStatus("narrating"); break;
            case 'playing_video': if (learningPipeline.youtubePlayer) learningPipeline.youtubePlayer.pauseVideo(); updateStatus("paused"); break;
            case 'paused': if (learningPipeline.youtubePlayer) learningPipeline.youtubePlayer.playVideo(); updateStatus("playing_video"); break;
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
        resetUIState();
        ui.curateButton.disabled = true;
        await learningPipeline.start(topic);
    }

    function displayLevelSelection() {
        ui.inputSection.classList.add('hidden');
        ui.levelButtonsContainer.innerHTML = '';
        const levels = Object.keys(currentLessonPlan).filter(k => k !== 'topic');
        
        if (levels.length === 0) {
            logError("No levels found in the processed lesson plan!", currentLessonPlan);
            displayError("The generated lesson plan had no valid levels.");
            resetUIState();
            return;
        }

        levels.forEach(level => {
            const button = document.createElement('button');
            button.className = 'w-full p-6 rounded-xl transition-all transform hover:scale-105 shadow-lg bg-blue-600 hover:bg-blue-700 text-white';
            
            const segmentCount = Array.isArray(currentLessonPlan[level]) ? currentLessonPlan[level].length : 'N/A';
            if (segmentCount === 'N/A') {
                logError(`Lesson plan for level "${level}" is not an array!`, currentLessonPlan[level]);
            }
            
            button.innerHTML = `<div class="text-2xl font-bold">${level}</div><div class="text-sm opacity-75">${segmentCount} segments</div>`;
            button.onclick = () => learningPipeline.startLevel(level);
            ui.levelButtonsContainer.appendChild(button);
        });
        ui.levelSelection.classList.remove('hidden');
    }

    async function processNextSegment(forceNext = false) {
        if (lessonState === 'narrating' && !forceNext) return;
        
        updateStatus("processing_next_segment");
        ui.nextSegmentButton.disabled = true;
        learningPipeline.speechEngine.stop();

        currentSegmentIndex++;
        const learningPoints = currentLessonPlan[currentLearningPath];
        if (currentSegmentIndex >= learningPoints.length) {
            updateStatus("lesson_complete");
            updateCanvasVisuals("🎉 Lesson Complete!", "Congratulations! You've finished this learning path.");
            return;
        }
        
        const learningPoint = learningPoints[currentSegmentIndex];
        const previousPoint = currentSegmentIndex > 0 ? learningPoints[currentSegmentIndex - 1] : null;
        updateSegmentProgress();
        ui.currentTopicDisplay.textContent = learningPoint;
        
        await learningPipeline.executeSegment(learningPoint, previousPoint);
    }
    
    function displayVideoChoices(videos, learningPoint) {
        updateStatus("choosing_video");
        const playerContainer = document.getElementById('youtube-player-container');
        playerContainer.innerHTML = `<div class="p-8 text-white overflow-y-auto h-full"><h2 class="text-2xl font-bold mb-4">Choose a video for: "${learningPoint}"</h2><div id="video-choices-list"></div></div>`;
        const list = document.getElementById('video-choices-list');
        videos.forEach(video => {
            const div = document.createElement('div');
            div.className = 'flex items-center p-3 mb-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10';
            div.innerHTML = `<img src="${video.thumbnail}" class="w-32 h-20 object-cover rounded mr-4" alt="${video.title}"><span class="font-medium">${video.title}</span>`;
            div.onclick = () => learningPipeline.handleVideoSelection(video);
            list.appendChild(div);
        });
    }
    
    function updateSegmentProgress() {
        const learningPoints = currentLessonPlan[currentLearningPath];
        if (!learningPoints) return;
        const total = learningPoints.length;
        const current = currentSegmentIndex + 1;
        ui.segmentProgress.style.width = `${(current / total) * 100}%`;
        const progressText = document.getElementById('segment-progress-text');
        if (progressText) progressText.textContent = `${current}/${total}`;
    }

    function updateCanvasVisuals(mainText, subText = '') {
        ui.canvas.width = ui.canvas.clientWidth;
        ui.canvas.height = ui.canvas.clientHeight;
        const gradient = canvasCtx.createLinearGradient(0, 0, ui.canvas.width, ui.canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
        canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'middle';
        const maxWidth = ui.canvas.width * 0.85;
        let fontSize = Math.max(20, Math.min(ui.canvas.width / 25, 32));
        canvasCtx.font = `bold ${fontSize}px Inter, sans-serif`;
        const lines = wrapText(mainText, maxWidth, canvasCtx);
        let startY = ui.canvas.height / 2 - ((lines.length - 1) * (fontSize + 8)) / 2;
        lines.forEach((line, index) => { canvasCtx.fillText(line, ui.canvas.width / 2, startY + (index * (fontSize + 8))); });
        if (subText) { let subFontSize = Math.max(14, Math.min(ui.canvas.width / 40, 18)); canvasCtx.font = `${subFontSize}px Inter, sans-serif`; canvasCtx.fillStyle = 'rgba(200, 200, 200, 0.8)'; const subLines = wrapText(subText, maxWidth, canvasCtx); subLines.forEach((line, index) => { canvasCtx.fillText(line, ui.canvas.width / 2, startY + (lines.length * (fontSize + 8)) + (index * (subFontSize + 6))); }); }
    }

    function updateTeleprompter(fullText, progress) {
        if (!ui.canvas) return;
        const ctx = ui.canvas.getContext('2d');
        ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
        const gradient = ctx.createLinearGradient(0, 0, ui.canvas.width, ui.canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
        const maxWidth = ui.canvas.width * 0.9;
        const fontSize = Math.max(20, Math.min(ui.canvas.width / 25, 28));
        const lineHeight = fontSize + 12;
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        const lines = wrapText(fullText, maxWidth, ctx);
        const totalContentHeight = (lines.length - 1) * lineHeight;
        const totalScrollDistance = totalContentHeight > (ui.canvas.height / 2) ? totalContentHeight - (ui.canvas.height / 2) : 0;
        const yOffset = (ui.canvas.height / 2) - (totalScrollDistance * progress);
        ctx.save();
        ctx.translate(ui.canvas.width / 2, yOffset);
        lines.forEach((line, index) => { ctx.fillText(line, 0, index * lineHeight); });
        ctx.restore();
    }

    function wrapText(text, maxWidth, ctx) {
        const words = text.split(' ');
        let line = '';
        let lines = [];
        for (let i = 0; i < words.length; i++) {
            const testLine = line + words[i] + ' ';
            if (ctx.measureText(testLine).width > maxWidth && i > 0) {
                lines.push(line.trim());
                line = words[i] + ' ';
            } else {
                line = testLine;
            }
        }
        lines.push(line.trim());
        return lines;
    }

    function showLoading(message) { ui.inputSection.classList.add('hidden'); ui.levelSelection.classList.add('hidden'); ui.loadingMessage.textContent = message; ui.loadingIndicator.classList.remove('hidden'); }
    function hideLoading() { ui.loadingIndicator.classList.add('hidden'); }
    function resetUIState() { ui.levelSelection.classList.add('hidden'); ui.learningCanvasContainer.classList.add('hidden'); ui.inputSection.classList.remove('hidden'); ui.curateButton.disabled = false; currentLessonPlan = null; currentLearningPath = null; currentSegmentIndex = -1; lessonState = 'idle'; if(learningPipeline && learningPipeline.speechEngine) { learningPipeline.speechEngine.stop();} }
    function displayError(message) { logError(message); ui.errorMessage.textContent = message; ui.errorDisplay.classList.remove('hidden'); setTimeout(() => ui.errorDisplay.classList.add('hidden'), 5000); }
    function displayErrorOnCanvas(title, message) { updateCanvasVisuals(`⚠️ ${title}`, message); }

    // --- INITIALIZE --- //
    initializeUI();
    window.onYouTubeIframeAPIReady = () => log("YouTube Iframe API is ready and waiting.");
});