
document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // --- CORE STATE & UI REFERENCES ---
    // =================================================================================
    let currentLessonPlan = null;
    let currentLearningPath = null;
    let currentSegmentIndex = -1;
    let lessonState = 'idle'; // 'idle', 'narrating', 'choosing_video', 'checking_transcript', 'loading_transcript', 'generating_segments', 'playing_video', 'paused', 'quiz', 'complete'
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
    const CSE_ID = '534de8daaf2cb449d';
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
        
        async generateLessonPlan(topic) {
            log("GEMINI: Generating lesson plan...");
            const prompt = `Create a comprehensive, 4-level learning curriculum for "${topic}". Each level (Apprentice, Journeyman, Senior, Master) must have exactly 5 specific, searchable learning points. Return ONLY valid JSON.`;
            const response = await this.makeRequest(prompt);
            return this.parseJSONResponse(response);
        }

        async generateSearchQueries(learningPoint, topic) {
            log(`GEMINI: Generating search queries for "${learningPoint}"`);
            const prompt = `Generate 3 simple, effective YouTube search queries for "${learningPoint}". Each query should be 2-4 words maximum. Focus on the core concept only. Examples: "ACA explained", "financial crisis", "foreign policy". Return ONLY a JSON array of short strings.`;
            const response = await this.makeRequest(prompt, { temperature: 0.3 });
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

        async generateDetailedExplanation(learningPoint) {
            log(`GEMINI: Generating detailed explanation for "${learningPoint}"`);
            const prompt = `Create a comprehensive, educational explanation about "${learningPoint}" that would typically take 2-3 minutes to read aloud. Structure it as an engaging lesson that covers: 1) What it is, 2) Why it's important, 3) Key concepts, 4) Real-world examples. Write in a clear, teaching style suitable for someone learning this topic. Return ONLY the explanation text (150-250 words).`;
            const response = await this.makeRequest(prompt, { temperature: 0.8, maxOutputTokens: 1024 });
            return response;
        }

        async generateQuiz(learningPoint, transcript) {
            log(`GEMINI: Generating quiz for "${learningPoint}"`);
            const prompt = `Based on the learning point "${learningPoint}" and this transcript content, create a single multiple-choice quiz question. Return ONLY valid JSON with format: {"question": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}`;
            const response = await this.makeRequest(prompt, { temperature: 0.7 });
            return this.parseJSONResponse(response);
        }
    }

    class VideoSourcer {
        constructor() {}

        async searchYouTube(query) {
            log(`SEARCH: Searching for educational content: "${query}"`);
            
            // For Filmot.com, use simpler, direct YouTube search queries
            const filmotQueries = [
                query,  // Direct query first
                `${query} explained`,
                `${query} tutorial`,
                `how to ${query}`,
                `${query} guide`
            ];

            let allResults = [];
            
            for (const searchQuery of filmotQueries) {
                const searchParams = new URLSearchParams({
                    key: YOUTUBE_API_KEY,
                    cx: CSE_ID,
                    q: searchQuery,
                    num: 10  // Request more results per query
                });

                try {
                    log(`SEARCH: Trying query: "${searchQuery}"`);
                    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${searchParams}`);
                    
                    log(`SEARCH: Response status: ${response.status}`);
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        log(`SEARCH: API Error: ${response.status} - ${errorText}`);
                        continue;
                    }
                    
                    const data = await response.json();
                    log(`SEARCH: Response data:`, data);
                    
                    if (!data.items || data.items.length === 0) {
                        log(`SEARCH: No items found for "${searchQuery}"`);
                        continue;
                    }

                    log(`SEARCH: Found ${data.items.length} raw results for "${searchQuery}"`);

                    const results = data.items.map(item => {
                        log(`SEARCH: Processing item:`, item);
                        
                        // Filmot.com might structure URLs differently
                        let videoId = null;
                        
                        // Try multiple URL patterns
                        if (item.link) {
                            try {
                                const url = new URL(item.link);
                                videoId = url.searchParams.get('v') || 
                                         url.pathname.split('/').pop() ||
                                         (item.link.match(/[?&]v=([^&]+)/) || [])[1];
                            } catch (e) {
                                // If URL parsing fails, try regex
                                const match = item.link.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
                                videoId = match ? match[1] : null;
                            }
                        }
                        
                        if (videoId) {
                            // Score videos based on educational indicators
                            let score = 0;
                            const title = (item.title || '').toLowerCase();
                            const description = (item.snippet || '').toLowerCase();
                            
                            // Boost educational keywords
                            if (title.includes('tutorial') || title.includes('how to') || title.includes('explained')) score += 3;
                            if (title.includes('course') || title.includes('lesson') || title.includes('learn')) score += 2;
                            if (title.includes('university') || title.includes('lecture') || title.includes('professor')) score += 2;
                            if (description.includes('educational') || description.includes('teaching')) score += 1;
                            
                            // Penalize non-educational content
                            if (title.includes('reaction') || title.includes('funny') || title.includes('prank')) score -= 2;
                            if (title.includes('compilation') || title.includes('fails') || title.includes('meme')) score -= 2;

                            const result = {
                                youtubeId: videoId,
                                title: item.title || 'Untitled',
                                description: item.snippet || '',
                                thumbnail: item.pagemap?.cse_thumbnail?.[0]?.src || '',
                                educationalScore: score
                            };
                            
                            log(`SEARCH: Created result:`, result);
                            return result;
                        } else {
                            log(`SEARCH: Could not extract video ID from:`, item.link);
                        }
                        return null;
                    }).filter(Boolean);

                    log(`SEARCH: Processed ${results.length} valid results`);
                    allResults.push(...results);
                    
                    // Stop early if we have enough good results
                    if (allResults.length >= 15) break;
                    
                } catch (error) {
                    log(`SEARCH: Query failed for "${searchQuery}":`, error);
                    continue;
                }
            }

            // Sort by educational score and remove duplicates
            const uniqueResults = allResults
                .filter((video, index, self) => self.findIndex(v => v.youtubeId === video.youtubeId) === index)
                .sort((a, b) => b.educationalScore - a.educationalScore)
                .slice(0, 15);

            log(`SEARCH: Found ${uniqueResults.length} educational videos total`);
            return uniqueResults;
        }

        async checkTranscriptAvailable(videoId) {
            log(`TRANSCRIPT CHECK: Checking availability for ${videoId}`);
            try {
                const response = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`, {
                    headers: { 'x-api-key': SUPADATA_API_KEY }
                });
                
                if (response.status === 429) {
                    log(`TRANSCRIPT CHECK: Rate limited for ${videoId}, skipping`);
                    return false;
                }
                
                if (response.ok) {
                    const data = await response.json();
                    return Array.isArray(data) && data.length > 0;
                }
                return false;
            } catch (error) {
                logError('Transcript check failed:', error);
                return false;
            }
        }

        async getTranscript(videoId) {
            log(`TRANSCRIPT: Fetching for ${videoId}`);
            try {
                const response = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`, {
                    headers: { 'x-api-key': SUPADATA_API_KEY }
                });
                
                if (!response.ok) throw new Error(`Transcript API failed: ${response.status}`);
                
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    return data.map(line => line.text).join(' ');
                }
                return null;
            } catch (error) {
                logError('Transcript fetch failed:', error);
                return null;
            }
        }
    }

    class SpeechEngine {
        constructor() { 
            this.apiKey = "AIzaSyA43RRVypjAAXwYdpKrojWVmdRAGyLKwr8"; 
            this.apiUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize'; 
            this.audioElement = new Audio(); 
            this.onCompleteCallback = null; 
            this.onProgressCallback = null; 
        }
        
        async play(text, { onProgress = null, onComplete = null } = {}) { 
            this.stop(); 
            if (!text) { 
                if (onComplete) onComplete(); 
                return; 
            } 
            this.onProgressCallback = onProgress; 
            this.onCompleteCallback = onComplete; 
            try { 
                const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, { 
                    method: 'POST', 
                    body: JSON.stringify({ 
                        input: { text }, 
                        voice: { languageCode: 'en-US', name: 'en-US-Standard-C' }, 
                        audioConfig: { audioEncoding: 'MP3' } 
                    }) 
                }); 
                if (!response.ok) { 
                    const d = await response.json(); 
                    throw new Error(d.error.message); 
                } 
                const data = await response.json(); 
                const audioBlob = this.base64ToBlob(data.audioContent, 'audio/mpeg'); 
                this.audioElement.src = URL.createObjectURL(audioBlob); 
                this.audioElement.play(); 
                this.audioElement.ontimeupdate = () => { 
                    if (this.onProgressCallback && this.audioElement.duration) { 
                        this.onProgressCallback(this.audioElement.currentTime / this.audioElement.duration); 
                    } 
                }; 
                this.audioElement.onended = () => { 
                    if (this.onProgressCallback) this.onProgressCallback(1); 
                    if (this.onCompleteCallback) this.onCompleteCallback(); 
                }; 
            } catch (error) { 
                log(`Speech Error: ${error}`); 
                if (this.onCompleteCallback) this.onCompleteCallback(); 
            } 
        }
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
        }

        // STEP 1: Generate lesson plan
        async start(topic) {
            log("FLOW: Step 1 - Generate lesson plan");
            showLoading("Generating comprehensive lesson plan...");
            const rawPlan = await this.gemini.generateLessonPlan(topic);
            hideLoading();

            currentLessonPlan = this.parseLessonPlan(rawPlan);
            if (currentLessonPlan) {
                currentLessonPlan.topic = topic;
                displayLevelSelection();
            } else {
                displayError("Failed to generate lesson plan");
                ui.curateButton.disabled = false;
            }
        }

        parseLessonPlan(rawPlan) {
            if (!rawPlan) return null;
            
            // Handle simple format
            const findSimplePlan = (obj) => {
                if (!obj || typeof obj !== 'object') return null;
                const apprenticeKey = Object.keys(obj).find(k => k.toLowerCase() === 'apprentice');
                if (apprenticeKey && Array.isArray(obj[apprenticeKey])) {
                    return obj;
                }
                for (const key of Object.keys(obj)) {
                    const result = findSimplePlan(obj[key]);
                    if (result) return result;
                }
                return null;
            };

            // Handle complex format
            const transformComplexPlan = (plan) => {
                try {
                    if (plan?.curriculum?.levels) {
                        const transformed = {};
                        plan.curriculum.levels.forEach(levelData => {
                            if (levelData.level && Array.isArray(levelData.learningPoints)) {
                                transformed[levelData.level] = levelData.learningPoints.map(lp => lp.point).filter(Boolean);
                            }
                        });
                        return transformed.Apprentice ? transformed : null;
                    }
                    return null;
                } catch (e) {
                    return null;
                }
            };

            return transformComplexPlan(rawPlan) || findSimplePlan(rawPlan);
        }

        startLevel(level) {
            log("FLOW: Starting level", level);
            currentLearningPath = level;
            currentSegmentIndex = -1;
            ui.levelSelection.classList.add('hidden');
            ui.learningCanvasContainer.classList.remove('hidden');
            this.processNextLearningPoint();
        }

        async processNextLearningPoint() {
            currentSegmentIndex++;
            const learningPoints = currentLessonPlan[currentLearningPath];
            
            if (currentSegmentIndex >= learningPoints.length) {
                this.showFinalQuiz();
                return;
            }

            const learningPoint = learningPoints[currentSegmentIndex];
            const previousPoint = currentSegmentIndex > 0 ? learningPoints[currentSegmentIndex - 1] : null;
            
            updateSegmentProgress();
            ui.currentTopicDisplay.textContent = learningPoint;
            
            // FLOW: play narration -> search videos -> choose video -> check transcript -> load transcript -> generate segments -> play segments -> repeat
            await this.playNarration(learningPoint, previousPoint);
        }

        // STEP 3: Play narration
        async playNarration(learningPoint, previousPoint) {
            log("FLOW: Step 3 - Play narration");
            updateStatus('narrating');
            ui.nextSegmentButton.disabled = true;

            const narrationText = await this.gemini.generateNarration(learningPoint, previousPoint, `a video about ${learningPoint}`);
            
            await this.speechEngine.play(narrationText, {
                onProgress: (progress) => updateTeleprompter(narrationText, progress),
                onComplete: () => {
                    if (lessonState === 'narrating') {
                        this.searchVideos(learningPoint);
                    }
                }
            });
        }

        // STEP 2: Search videos and pre-filter for transcripts
        async searchVideos(learningPoint) {
            log("FLOW: Step 2 - Search educational videos with transcripts");
            updateStatus('searching_videos');
            updateCanvasVisuals('🔎 Finding educational content...', `Searching for: "${learningPoint}"`);

            const searchQueries = await this.gemini.generateSearchQueries(learningPoint, currentLessonPlan.topic);
            let allVideos = [];
            
            if (searchQueries) {
                for (const query of searchQueries) {
                    updateCanvasVisuals('🔎 Searching educational videos...', `Query: "${query}"`);
                    const results = await this.videoSourcer.searchYouTube(query);
                    allVideos.push(...results);
                    if (allVideos.length >= 15) break;
                }
            }

            if (allVideos.length === 0) {
                updateCanvasVisuals('🚫 No videos found', 'Moving to next segment...');
                setTimeout(() => this.processNextLearningPoint(), 3000);
                return;
            }

            // Remove duplicates and get top educational videos
            const uniqueVideos = allVideos
                .filter((video, index, self) => self.findIndex(v => v.youtubeId === video.youtubeId) === index)
                .sort((a, b) => (b.educationalScore || 0) - (a.educationalScore || 0))
                .slice(0, 10);

            updateCanvasVisuals('📝 Checking for transcripts...', 'Finding videos with captions...');
            
            // Check transcripts sequentially to avoid rate limiting
            const transcriptChecks = [];
            for (const video of uniqueVideos) {
                try {
                    const hasTranscript = await this.videoSourcer.checkTranscriptAvailable(video.youtubeId);
                    transcriptChecks.push({ status: 'fulfilled', value: { ...video, hasTranscript } });
                    // Add small delay between requests to respect rate limits
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error) {
                    transcriptChecks.push({ status: 'rejected', reason: error });
                }
            }

            // Filter to only videos with transcripts
            currentVideoChoices = transcriptChecks
                .filter(result => result.status === 'fulfilled' && result.value.hasTranscript)
                .map(result => result.value)
                .slice(0, 5);

            if (currentVideoChoices.length === 0) {
                updateCanvasVisuals('😔 No transcripts available', 'All videos lack captions. Using fallback content...');
                // Use fallback: create a simple explanation segment
                await this.createFallbackContent(learningPoint);
                return;
            }

            log(`FLOW: Found ${currentVideoChoices.length} videos with transcripts`);
            this.autoSelectBestVideo(learningPoint);
        }

        // STEP 4: Auto-select best video (no more manual choice)
        autoSelectBestVideo(learningPoint) {
            log("FLOW: Step 4 - Auto-selecting best educational video");
            updateStatus('choosing_video');
            
            // Sort by educational score and automatically pick the best one
            const bestVideo = currentVideoChoices[0];
            updateCanvasVisuals('✅ Video selected!', `"${bestVideo.title}"`);
            
            // Automatically proceed with the best video
            setTimeout(() => this.handleVideoSelection(bestVideo), 1500);
        }

        // STEP 4B: Fallback content when no transcripts available
        async createFallbackContent(learningPoint) {
            log("FLOW: Step 4B - Creating fallback educational content");
            updateStatus('generating_segments');
            updateCanvasVisuals('🤖 Creating custom content...', 'Generating explanation without video...');

            // Generate a comprehensive explanation
            const explanation = await this.gemini.generateDetailedExplanation(learningPoint);
            
            if (explanation) {
                // Play the explanation as narration
                updateCanvasVisuals('📚 Learning segment', `Topic: "${learningPoint}"`);
                await this.speechEngine.play(explanation, {
                    onProgress: (progress) => updateTeleprompter(explanation, progress),
                    onComplete: () => {
                        if (lessonState === 'generating_segments') {
                            this.showQuiz();
                        }
                    }
                });
            } else {
                updateCanvasVisuals('⏭️ Skipping segment', 'Moving to next topic...');
                setTimeout(() => this.processNextLearningPoint(), 2000);
            }
        }

        // STEP 5: Check video for transcript (without YouTube Data API)
        async handleVideoSelection(video) {
            log("FLOW: Step 5 - Check transcript availability");
            updateStatus('checking_transcript');
            updateCanvasVisuals('🔍 Checking transcript availability...', `"${video.title}"`);

            const hasTranscript = await this.videoSourcer.checkTranscriptAvailable(video.youtubeId);
            
            if (!hasTranscript) {
                log("FLOW: No transcript available, removing video and trying again");
                currentVideoChoices = currentVideoChoices.filter(v => v.youtubeId !== video.youtubeId);
                
                if (currentVideoChoices.length > 0) {
                    const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
                    displayVideoChoices(currentVideoChoices.slice(0, 5), learningPoint);
                } else {
                    displayError("No videos with transcripts found. Skipping to next segment.");
                    setTimeout(() => this.processNextLearningPoint(), 3000);
                }
                return;
            }

            this.loadTranscript(video);
        }

        // STEP 6: Load transcript with Supabase
        async loadTranscript(video) {
            log("FLOW: Step 6 - Load transcript");
            updateStatus('loading_transcript');
            updateCanvasVisuals('📄 Loading transcript...', `"${video.title}"`);

            currentTranscript = await this.videoSourcer.getTranscript(video.youtubeId);
            
            if (!currentTranscript) {
                displayError("Failed to load transcript. Trying another video.");
                currentVideoChoices = currentVideoChoices.filter(v => v.youtubeId !== video.youtubeId);
                
                if (currentVideoChoices.length > 0) {
                    const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
                    displayVideoChoices(currentVideoChoices.slice(0, 5), learningPoint);
                } else {
                    setTimeout(() => this.processNextLearningPoint(), 3000);
                }
                return;
            }

            this.generateSegments(video);
        }

        // STEP 7: Generate segments from transcript
        async generateSegments(video) {
            log("FLOW: Step 7 - Generate segments");
            updateStatus('generating_segments');
            updateCanvasVisuals('✂️ Finding best segments...', 'Analyzing transcript content...');

            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            currentSegments = await this.gemini.findVideoSegments(video.title, currentTranscript, learningPoint);
            currentSegmentPlayIndex = 0;

            this.playSegments(video);
        }

        // STEP 8: Play segments
        playSegments(video) {
            log("FLOW: Step 8 - Play segments");
            updateStatus('playing_video');
            this.createYouTubePlayer(video);
        }

        createYouTubePlayer(videoInfo) {
            if (this.youtubePlayer) { this.youtubePlayer.destroy(); }
            
            ui.skipVideoButton.style.display = 'block';

            const playNextSegment = () => {
                if (currentSegmentPlayIndex >= currentSegments.length) {
                    log('FLOW: All segments complete, showing quiz');
                    this.showQuiz();
                    return;
                }

                const segment = currentSegments[currentSegmentPlayIndex];
                log(`Playing segment ${currentSegmentPlayIndex + 1}/${currentSegments.length}`);
                
                if (this.youtubePlayer) { this.youtubePlayer.destroy(); }
                
                this.youtubePlayer = new YT.Player('youtube-player-container', {
                    height: '100%', width: '100%', videoId: videoInfo.youtubeId,
                    playerVars: { autoplay: 1, controls: 1, rel: 0, start: segment.startTime, end: segment.endTime, modestbranding: 1, origin: window.location.origin },
                    events: {
                        'onReady': (event) => {
                            event.target.playVideo();
                            ui.canvas.style.opacity = '0';
                        },
                        'onStateChange': (event) => {
                            if (event.data === YT.PlayerState.ENDED) {
                                currentSegmentPlayIndex++;
                                playNextSegment();
                            }
                        },
                        'onError': () => { 
                            displayError("Video playback error. Moving to next segment.");
                            currentSegmentPlayIndex++;
                            playNextSegment();
                        }
                    }
                });
            };
            
            playNextSegment();
        }

        // STEP 9: Quiz
        async showQuiz() {
            log("FLOW: Step 9 - Show quiz");
            updateStatus('quiz');
            ui.skipVideoButton.style.display = 'none';
            ui.canvas.style.opacity = '1';
            
            if (this.youtubePlayer) { 
                this.youtubePlayer.destroy(); 
                this.youtubePlayer = null;
            }
            
            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            const quiz = await this.gemini.generateQuiz(learningPoint, currentTranscript);
            
            if (quiz) {
                this.displayQuiz(quiz);
            } else {
                updateCanvasVisuals("Quiz generation failed", "Moving to next segment...");
                setTimeout(() => this.processNextLearningPoint(), 2000);
            }
        }

        displayQuiz(quiz) {
            const playerContainer = document.getElementById('youtube-player-container');
            playerContainer.innerHTML = `
                <div class="p-8 text-white h-full flex flex-col justify-center">
                    <h2 class="text-2xl font-bold mb-6">Quick Quiz!</h2>
                    <p class="text-lg mb-6">${quiz.question}</p>
                    <div class="space-y-3 mb-6">
                        ${quiz.options.map((option, index) => `
                            <button class="quiz-option w-full text-left p-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors" data-index="${index}">
                                ${String.fromCharCode(65 + index)}) ${option}
                            </button>
                        `).join('')}
                    </div>
                    <div id="quiz-result" class="hidden">
                        <p id="quiz-explanation" class="text-sm text-gray-300"></p>
                        <button id="continue-button" class="mt-4 bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg">
                            Continue to Next Segment
                        </button>
                    </div>
                </div>
            `;

            // Add quiz event listeners
            const options = playerContainer.querySelectorAll('.quiz-option');
            options.forEach(option => {
                option.addEventListener('click', () => {
                    const selectedIndex = parseInt(option.dataset.index);
                    const isCorrect = selectedIndex === quiz.correct;
                    
                    options.forEach(opt => opt.disabled = true);
                    option.classList.add(isCorrect ? 'bg-green-600' : 'bg-red-600');
                    options[quiz.correct].classList.add('bg-green-600');
                    
                    const resultDiv = document.getElementById('quiz-result');
                    const explanationP = document.getElementById('quiz-explanation');
                    explanationP.textContent = quiz.explanation;
                    resultDiv.classList.remove('hidden');
                    
                    document.getElementById('continue-button').addEventListener('click', () => {
                        this.processNextLearningPoint();
                    });
                });
            });
        }

        // STEP 10: Finish (final quiz for whole level)
        async showFinalQuiz() {
            log("FLOW: Step 10 - Show final quiz");
            updateStatus('complete');
            updateCanvasVisuals("🎉 Level Complete!", "Congratulations! You've finished this learning path.");
            ui.nextSegmentButton.disabled = true;
        }
    }

    // =================================================================================
    // --- UTILITY FUNCTIONS ---
    // =================================================================================

    const learningPipeline = new LearningPipeline();

    function updateStatus(state) {
        lessonState = state;
        log(`STATE: ${lessonState}`);
    }

    function initializeUI() {
        ui.curateButton.addEventListener('click', handleCurateClick);
        ui.playPauseButton.addEventListener('click', playPauseLesson);
        ui.nextSegmentButton.addEventListener('click', () => { 
            if (!ui.nextSegmentButton.disabled) learningPipeline.processNextLearningPoint(); 
        });
        ui.skipVideoButton.addEventListener('click', () => { 
            if (lessonState === 'playing_video') learningPipeline.showQuiz(); 
        });
    }

    function playPauseLesson() {
        switch (lessonState) {
            case 'narrating': 
                learningPipeline.speechEngine.pause(); 
                updateStatus("narration_paused"); 
                break;
            case 'narration_paused': 
                learningPipeline.speechEngine.resume(); 
                updateStatus("narrating"); 
                break;
            case 'playing_video': 
                if (learningPipeline.youtubePlayer) learningPipeline.youtubePlayer.pauseVideo(); 
                updateStatus("paused"); 
                break;
            case 'paused': 
                if (learningPipeline.youtubePlayer) learningPipeline.youtubePlayer.playVideo(); 
                updateStatus("playing_video"); 
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
        resetUIState();
        ui.curateButton.disabled = true;
        await learningPipeline.start(topic);
    }

    function displayLevelSelection() {
        ui.inputSection.classList.add('hidden');
        ui.levelButtonsContainer.innerHTML = '';
        const levels = Object.keys(currentLessonPlan).filter(k => k !== 'topic');
        
        levels.forEach(level => {
            const button = document.createElement('button');
            button.className = 'w-full p-6 rounded-xl transition-all transform hover:scale-105 shadow-lg bg-blue-600 hover:bg-blue-700 text-white';
            
            const segmentCount = Array.isArray(currentLessonPlan[level]) ? currentLessonPlan[level].length : 'N/A';
            button.innerHTML = `<div class="text-2xl font-bold">${level}</div><div class="text-sm opacity-75">${segmentCount} segments</div>`;
            button.onclick = () => learningPipeline.startLevel(level);
            ui.levelButtonsContainer.appendChild(button);
        });
        ui.levelSelection.classList.remove('hidden');
    }
    
    // Video choice display removed - now auto-selecting best educational videos
    
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
        if (subText) { 
            let subFontSize = Math.max(14, Math.min(ui.canvas.width / 40, 18)); 
            canvasCtx.font = `${subFontSize}px Inter, sans-serif`; 
            canvasCtx.fillStyle = 'rgba(200, 200, 200, 0.8)'; 
            const subLines = wrapText(subText, maxWidth, canvasCtx); 
            subLines.forEach((line, index) => { 
                canvasCtx.fillText(line, ui.canvas.width / 2, startY + (lines.length * (fontSize + 8)) + (index * (subFontSize + 6))); 
            }); 
        }
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

    function showLoading(message) { 
        ui.inputSection.classList.add('hidden'); 
        ui.levelSelection.classList.add('hidden'); 
        ui.loadingMessage.textContent = message; 
        ui.loadingIndicator.classList.remove('hidden'); 
    }
    
    function hideLoading() { ui.loadingIndicator.classList.add('hidden'); }
    
    function resetUIState() { 
        ui.levelSelection.classList.add('hidden'); 
        ui.learningCanvasContainer.classList.add('hidden'); 
        ui.inputSection.classList.remove('hidden'); 
        ui.curateButton.disabled = false; 
        currentLessonPlan = null; 
        currentLearningPath = null; 
        currentSegmentIndex = -1; 
        lessonState = 'idle'; 
        if (learningPipeline?.speechEngine) { 
            learningPipeline.speechEngine.stop();
        } 
    }
    
    function displayError(message) { 
        logError(message); 
        ui.errorMessage.textContent = message; 
        ui.errorDisplay.classList.remove('hidden'); 
        setTimeout(() => ui.errorDisplay.classList.add('hidden'), 5000); 
    }

    // Initialize
    initializeUI();
    window.onYouTubeIframeAPIReady = () => log("YouTube API ready");
});
