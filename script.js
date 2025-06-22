
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
    const TRANSCRIPT_API_URL = "https://transcript-scraper-stefdgisi.replit.app";
    const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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
            const defaultConfig = { 
                temperature: 0.7, 
                maxOutputTokens: 2048, 
                ...options 
            }; 
            
            const requestBody = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: defaultConfig,
                safetySettings: [
                    {
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_NONE"
                    },
                    {
                        category: "HARM_CATEGORY_HATE_SPEECH", 
                        threshold: "BLOCK_NONE"
                    },
                    {
                        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        threshold: "BLOCK_NONE"
                    },
                    {
                        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                        threshold: "BLOCK_NONE"
                    }
                ]
            };
            
            const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(requestBody)
            }); 
            
            if (!response.ok) { 
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Gemini API failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`); 
            } 
            
            const data = await response.json(); 
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text; 
            
            if (!content) { 
                log('Gemini response data:', data);
                throw new Error('No content in Gemini response - content may have been blocked by safety filters'); 
            } 
            
            return content.trim(); 
        }
        parseJSONResponse(response) { if(!response) return null; try { let cleanedResponse = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, ''); const jsonMatch = cleanedResponse.match(/(\{[\s\S]*\}|\[[\s\S]*\])/); if (jsonMatch) { return JSON.parse(jsonMatch[0]); } logError(`No valid JSON found in response:`, response); return null; } catch (error) { logError(`Failed to parse JSON:`, error, `Raw response: "${response}"`); return null; } }
        
        async generateLessonPlan(topic) {
            log("GEMINI: Generating lesson plan...");
            const prompt = `Create a simple learning plan for "${topic}". Make exactly 4 levels: Apprentice, Journeyman, Senior, Master. Each level needs exactly 3 learning points (not 5). Keep topics simple and educational.

Example format:
{
  "Apprentice": ["Basic concept 1", "Basic concept 2", "Basic concept 3"],
  "Journeyman": ["Intermediate topic 1", "Intermediate topic 2", "Intermediate topic 3"],
  "Senior": ["Advanced topic 1", "Advanced topic 2", "Advanced topic 3"],
  "Master": ["Expert topic 1", "Expert topic 2", "Expert topic 3"]
}

Topic: "${topic}"

Return ONLY the JSON, no other text.`;
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
                prompt = `Write a simple 1-2 sentence introduction. Previous topic was "${previousPoint}". Now we're learning about "${learningPoint}". Keep it simple and educational. Just return the text, nothing else.`;
            } else {
                prompt = `Write a simple welcome message for learning about "${learningPoint}". Just 1-2 sentences. Keep it friendly and educational. Just return the text, nothing else.`;
            }
            return await this.makeRequest(prompt, { temperature: 0.5 });
        }

        async findVideoSegments(videoTitle, youtubeUrl, learningPoint) {
            log(`SEGMENTER: Analyzing YouTube video for "${learningPoint}"`);
            log(`SEGMENTER: Video URL: ${youtubeUrl}`);
            
            // Try video understanding first, fallback to URL-based analysis
            const videoId = this.extractVideoId(youtubeUrl);
            if (videoId) {
                const videoSegments = await this.analyzeVideoWithGemini(videoId, learningPoint);
                if (videoSegments && videoSegments.length > 0) {
                    return videoSegments;
                }
            }
            
            // Fallback to URL-based analysis
            try {
                const prompt = `You are an expert video analyst. I need you to analyze this YouTube video and identify the most relevant segments for learning about: "${learningPoint}"

Video Details:
- Title: "${videoTitle}"
- YouTube URL: ${youtubeUrl}
- Learning Focus: "${learningPoint}"

Your task:
1. Based on the video title and URL context, predict where the most relevant content would be located
2. Educational videos typically follow patterns - intro (0-30s), main content (30s-80% of video), conclusion (final 20%)
3. For the learning point "${learningPoint}", identify 1-3 key segments where this topic would be most thoroughly explained

Requirements:
- Each segment MUST be 30-120 seconds long
- Total duration of all segments should be 60-240 seconds
- Focus on the most educational portions
- Avoid intro/outro fluff unless they contain crucial information

Return ONLY a valid JSON array of objects like:
[
  {"startTime": 45, "endTime": 135, "reason": "Main explanation of core concepts"},
  {"startTime": 180, "endTime": 240, "reason": "Practical examples and applications"}
]

If you cannot determine good segments from the context, return a single comprehensive segment:
[{"startTime": 30, "endTime": 210, "reason": "Core educational content"}]`;

                const response = await this.makeRequest(prompt, { temperature: 0.3, maxOutputTokens: 1024 });
                log(`SEGMENTER: Raw AI response:`, response);
                
                const segments = this.parseJSONResponse(response);
                log(`SEGMENTER: Parsed segments:`, segments);
                
                if (Array.isArray(segments) && segments.length > 0) {
                    // Validate segment format
                    const validSegments = segments.filter(seg => 
                        seg && typeof seg.startTime === 'number' && typeof seg.endTime === 'number' && 
                        seg.startTime < seg.endTime && seg.startTime >= 0
                    );
                    
                    if (validSegments.length > 0) {
                        log(`SEGMENTER: Found ${validSegments.length} valid segments.`);
                        return validSegments;
                    }
                }
                
                log("SEGMENTER WARN: AI response invalid or empty. Using fallback.");
                return this.createFallbackSegments();
                
            } catch (error) {
                logError("SEGMENTER ERROR:", error);
                return this.createFallbackSegments();
            }
        }

        extractVideoId(url) {
            const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
            return match ? match[1] : null;
        }

        async analyzeVideoWithGemini(videoId, learningPoint) {
            log(`VIDEO ANALYSIS: Analyzing video ${videoId} with Gemini 2.0 YouTube URL feature`);
            
            try {
                // Use Gemini 2.0's direct YouTube URL support
                const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
                const requestBody = {
                    contents: [{
                        parts: [
                            {
                                text: `Analyze this educational YouTube video and identify the most relevant segments for learning about "${learningPoint}". 

Watch the video carefully and find 1-3 key segments where this topic is explained most clearly. Each segment should be 30-120 seconds long.

Provide timestamps based on what you observe in the video content.

Return ONLY a JSON array with this format:
[
  {"startTime": 45, "endTime": 135, "reason": "Main explanation of core concepts"},
  {"startTime": 180, "endTime": 240, "reason": "Practical examples"}
]

Focus on educational content that directly relates to "${learningPoint}".`
                            },
                            {
                                file_data: {
                                    file_uri: youtubeUrl
                                }
                            }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 1024
                    }
                };

                log(`VIDEO ANALYSIS: Sending request to Gemini 2.0 for ${youtubeUrl}`);
                const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    log(`VIDEO ANALYSIS: Gemini 2.0 API failed: ${response.status} - ${errorText}`);
                    return null;
                }

                const data = await response.json();
                const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
                
                if (!content) {
                    log('VIDEO ANALYSIS: No content in Gemini 2.0 video analysis response');
                    log('VIDEO ANALYSIS: Response data:', data);
                    return null;
                }

                log(`VIDEO ANALYSIS: Gemini 2.0 response:`, content);
                const segments = this.parseJSONResponse(content);
                if (Array.isArray(segments) && segments.length > 0) {
                    log(`VIDEO ANALYSIS: Successfully analyzed video with Gemini 2.0, found ${segments.length} segments`);
                    return segments.filter(seg => 
                        seg && typeof seg.startTime === 'number' && typeof seg.endTime === 'number' && 
                        seg.startTime < seg.endTime && seg.startTime >= 0
                    );
                }

                log('VIDEO ANALYSIS: No valid segments parsed from Gemini 2.0 response');
                return null;
                
            } catch (error) {
                log(`VIDEO ANALYSIS: Error analyzing video with Gemini 2.0:`, error);
                return null;
            }
        }
        
        createFallbackSegments() {
            // Smart fallback based on typical educational video structure
            return [{ startTime: 30, endTime: 180, reason: "Main educational content (fallback)" }];
        }

        async findVideoSegmentsWithTranscript(videoTitle, youtubeUrl, learningPoint, transcript) {
            log(`TRANSCRIPT SEGMENTER: Analyzing transcript for "${learningPoint}"`);
            
            try {
                const prompt = `You are an expert video analyst with access to the full transcript. Analyze this educational video transcript and identify the most relevant segments for learning about: "${learningPoint}"

Video Details:
- Title: "${videoTitle}"
- YouTube URL: ${youtubeUrl}
- Learning Focus: "${learningPoint}"

TRANSCRIPT:
${transcript.substring(0, 4000)} ${transcript.length > 4000 ? '...[truncated]' : ''}

Your task:
1. Read through the transcript and identify where "${learningPoint}" is discussed
2. Find 1-3 key segments where this topic is explained most clearly
3. Estimate timestamps based on typical speech patterns (150-200 words per minute)
4. Focus on segments with substantive educational content

Requirements:
- Each segment MUST be 30-120 seconds long
- Total duration of all segments should be 60-240 seconds
- Base timing estimates on transcript content flow
- Avoid repetitive or tangential content

Return ONLY a valid JSON array of objects like:
[
  {"startTime": 45, "endTime": 135, "reason": "Core explanation of [specific concept]"},
  {"startTime": 180, "endTime": 240, "reason": "Practical examples and applications"}
]

If the transcript doesn't clearly cover "${learningPoint}", return a general educational segment:
[{"startTime": 60, "endTime": 180, "reason": "General educational content"}]`;

                const response = await this.makeRequest(prompt, { temperature: 0.2, maxOutputTokens: 1024 });
                log(`TRANSCRIPT SEGMENTER: Raw AI response:`, response);
                
                const segments = this.parseJSONResponse(response);
                log(`TRANSCRIPT SEGMENTER: Parsed segments:`, segments);
                
                if (Array.isArray(segments) && segments.length > 0) {
                    const validSegments = segments.filter(seg => 
                        seg && typeof seg.startTime === 'number' && typeof seg.endTime === 'number' && 
                        seg.startTime < seg.endTime && seg.startTime >= 0
                    );
                    
                    if (validSegments.length > 0) {
                        log(`TRANSCRIPT SEGMENTER: Found ${validSegments.length} valid segments.`);
                        return validSegments;
                    }
                }
                
                log("TRANSCRIPT SEGMENTER WARN: AI response invalid or empty. Using fallback.");
                return this.createFallbackSegments();
                
            } catch (error) {
                logError("TRANSCRIPT SEGMENTER ERROR:", error);
                return this.createFallbackSegments();
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
            const prompt = `Create a single multiple-choice quiz question about "${learningPoint}". Make it educational and test understanding of key concepts. Return ONLY valid JSON with format: {"question": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}`;
            const response = await this.makeRequest(prompt, { temperature: 0.7 });
            return this.parseJSONResponse(response);
        }
    }

    class VideoSourcer {
        constructor() {}

        async searchYouTube(query) {
            log(`SEARCH: Searching for educational content with captions: "${query}"`);
            
            try {
                // Use the transcript API to search for videos with captions
                const response = await fetch(`${TRANSCRIPT_API_URL}/captions-search?q=${encodeURIComponent(query)}&max_results=15&use_ai=true`);
                
                if (!response.ok) {
                    log(`SEARCH: Transcript API failed: ${response.status}`);
                    return this.fallbackSearch(query);
                }
                
                const data = await response.json();
                log(`SEARCH: Transcript API response:`, data);
                
                if (!data || !data.videos || data.videos.length === 0) {
                    log(`SEARCH: No videos found via transcript API`);
                    return this.fallbackSearch(query);
                }

                const results = data.videos.map(video => {
                    // Score videos based on educational indicators
                    let score = 0;
                    const title = (video.title || '').toLowerCase();
                    const description = (video.description || '').toLowerCase();
                    
                    // Boost educational keywords
                    if (title.includes('tutorial') || title.includes('how to') || title.includes('explained')) score += 3;
                    if (title.includes('course') || title.includes('lesson') || title.includes('learn')) score += 2;
                    if (title.includes('university') || title.includes('lecture') || title.includes('professor')) score += 2;
                    if (description.includes('educational') || description.includes('teaching')) score += 1;
                    
                    // Penalize non-educational content
                    if (title.includes('reaction') || title.includes('funny') || title.includes('prank')) score -= 2;
                    if (title.includes('compilation') || title.includes('fails') || title.includes('meme')) score -= 2;

                    // Boost videos that have captions (main advantage of this API)
                    if (video.has_captions) score += 5;

                    return {
                        youtubeId: video.video_id,
                        title: video.title || 'Untitled',
                        description: video.description || '',
                        thumbnail: video.thumbnail || '',
                        educationalScore: score,
                        hasTranscript: video.has_captions
                    };
                }).filter(video => video.hasTranscript) // Only return videos with captions
                  .sort((a, b) => b.educationalScore - a.educationalScore);

                log(`SEARCH: Found ${results.length} educational videos with captions`);
                return results;

            } catch (error) {
                log(`SEARCH: Transcript API error:`, error);
                return this.fallbackSearch(query);
            }
        }

        async fallbackSearch(query) {
            log(`SEARCH: Using fallback Custom Search for: "${query}"`);
            
            const searchQueries = [
                `${query} tutorial`,
                `${query} explained`,
                `how to ${query}`,
                `${query} course`
            ];

            let allResults = [];
            
            for (const searchQuery of searchQueries.slice(0, 2)) { // Limit to 2 queries for fallback
                const searchParams = new URLSearchParams({
                    key: YOUTUBE_API_KEY,
                    cx: CSE_ID,
                    q: searchQuery,
                    num: 5
                });

                try {
                    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${searchParams}`);
                    
                    if (!response.ok) continue;
                    
                    const data = await response.json();
                    
                    if (!data.items || data.items.length === 0) continue;

                    const results = data.items.map(item => {
                        let videoId = null;
                        
                        if (item.link) {
                            try {
                                const url = new URL(item.link);
                                videoId = url.searchParams.get('v') || 
                                         url.pathname.split('/').pop() ||
                                         (item.link.match(/[?&]v=([^&]+)/) || [])[1];
                            } catch (e) {
                                const match = item.link.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
                                videoId = match ? match[1] : null;
                            }
                        }
                        
                        if (videoId) {
                            return {
                                youtubeId: videoId,
                                title: item.title || 'Untitled',
                                description: item.snippet || '',
                                thumbnail: item.pagemap?.cse_thumbnail?.[0]?.src || '',
                                educationalScore: 1, // Low score for fallback
                                hasTranscript: false // Unknown, will check later
                            };
                        }
                        return null;
                    }).filter(Boolean);

                    allResults.push(...results);
                    
                } catch (error) {
                    log(`SEARCH: Fallback query failed for "${searchQuery}":`, error);
                    continue;
                }
            }

            const uniqueResults = allResults
                .filter((video, index, self) => self.findIndex(v => v.youtubeId === video.youtubeId) === index)
                .slice(0, 10);

            log(`SEARCH: Fallback found ${uniqueResults.length} videos`);
            return uniqueResults;
        }

        async checkTranscriptAvailable(videoId) {
            log(`TRANSCRIPT CHECK: Checking availability for ${videoId}`);
            try {
                const response = await fetch(`${TRANSCRIPT_API_URL}/captions-search?q=${encodeURIComponent(videoId)}&max_results=1`);
                
                if (response.status === 429) {
                    log(`TRANSCRIPT CHECK: Rate limited for ${videoId}, skipping`);
                    return false;
                }
                
                if (response.ok) {
                    const data = await response.json();
                    // Check if we found videos with captions
                    return data && data.videos && data.videos.length > 0 && 
                           data.videos.some(video => video.video_id === videoId && video.has_captions);
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
                const response = await fetch(`${TRANSCRIPT_API_URL}/transcript/${videoId}`);
                
                if (!response.ok) throw new Error(`Transcript API failed: ${response.status}`);
                
                const data = await response.json();
                if (data && data.transcript) {
                    // Handle both string and array formats
                    if (typeof data.transcript === 'string') {
                        return data.transcript;
                    } else if (Array.isArray(data.transcript)) {
                        return data.transcript.map(item => 
                            typeof item === 'string' ? item : (item.text || '')
                        ).join(' ');
                    }
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
            this.isPaused = false;
            this.isPlaying = false;
        }
        
        async play(text, { onProgress = null, onComplete = null } = {}) { 
            this.stop(); 
            if (!text) { 
                if (onComplete) onComplete(); 
                return; 
            } 
            this.onProgressCallback = onProgress; 
            this.onCompleteCallback = onComplete; 
            this.isPaused = false;
            this.isPlaying = true;
            
            try { 
                const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        input: { text }, 
                        voice: { languageCode: 'en-US', name: 'en-US-Standard-C' }, 
                        audioConfig: { audioEncoding: 'MP3' } 
                    }) 
                }); 
                if (!response.ok) { 
                    const d = await response.json(); 
                    throw new Error(d.error?.message || 'Speech API error'); 
                } 
                const data = await response.json(); 
                const audioBlob = this.base64ToBlob(data.audioContent, 'audio/mpeg'); 
                this.audioElement.src = URL.createObjectURL(audioBlob); 
                
                this.audioElement.onloadeddata = () => {
                    if (this.isPlaying && !this.isPaused) {
                        this.audioElement.play().catch(e => log(`Audio play error: ${e}`));
                    }
                };
                
                this.audioElement.ontimeupdate = () => { 
                    if (this.onProgressCallback && this.audioElement.duration) { 
                        this.onProgressCallback(this.audioElement.currentTime / this.audioElement.duration); 
                    } 
                }; 
                this.audioElement.onended = () => { 
                    this.isPlaying = false;
                    this.isPaused = false;
                    if (this.onProgressCallback) this.onProgressCallback(1); 
                    if (this.onCompleteCallback) this.onCompleteCallback(); 
                }; 
                this.audioElement.onerror = (e) => {
                    log(`Audio element error: ${e}`);
                    this.isPlaying = false;
                    this.isPaused = false;
                    if (this.onCompleteCallback) this.onCompleteCallback();
                };
            } catch (error) { 
                log(`Speech Error: ${error}`); 
                this.isPlaying = false;
                this.isPaused = false;
                if (this.onCompleteCallback) this.onCompleteCallback(); 
            } 
        }
        
        pause() { 
            if (this.isPlaying && !this.isPaused) {
                this.audioElement.pause(); 
                this.isPaused = true;
                log('Speech paused');
            }
        }
        
        resume() { 
            if (this.isPaused && this.isPlaying) {
                this.audioElement.play().catch(e => log(`Resume error: ${e}`)); 
                this.isPaused = false;
                log('Speech resumed');
            }
        }
        
        stop() { 
            this.audioElement.pause(); 
            this.isPlaying = false;
            this.isPaused = false;
            if (this.audioElement.src) {
                this.audioElement.currentTime = 0; 
                URL.revokeObjectURL(this.audioElement.src);
                this.audioElement.src = '';
            }
            log('Speech stopped');
        }
        
        base64ToBlob(base64) { 
            const byteCharacters = atob(base64); 
            const byteArrays = []; 
            for (let offset = 0; offset < byteCharacters.length; offset += 512) { 
                const slice = byteCharacters.slice(offset, offset + 512); 
                const byteNumbers = new Array(slice.length); 
                for (let i = 0; i < slice.length; i++) { 
                    byteNumbers[i] = slice.charCodeAt(i); 
                } 
                byteArrays.push(new Uint8Array(byteNumbers)); 
            } 
            return new Blob(byteArrays, { type: 'audio/mpeg' }); 
        }
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
            updatePlayPauseIcon();
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
            log("FLOW: Step 2 - Search educational videos");
            updateStatus('searching_videos');
            updateCanvasVisuals('🔎 Finding educational content...', `Searching for: "${learningPoint}"`);

            try {
                const searchQueries = await this.gemini.generateSearchQueries(learningPoint, currentLessonPlan.topic);
                log(`Generated search queries:`, searchQueries);
                
                let allVideos = [];
                
                if (searchQueries && Array.isArray(searchQueries)) {
                    for (const query of searchQueries.slice(0, 3)) { // Limit to 3 queries
                        updateCanvasVisuals('🔎 Searching educational videos...', `Query: "${query}"`);
                        try {
                            const results = await this.videoSourcer.searchYouTube(query);
                            log(`Search results for "${query}":`, results.length);
                            allVideos.push(...results);
                            if (allVideos.length >= 15) break;
                        } catch (error) {
                            logError(`Search failed for query "${query}":`, error);
                        }
                    }
                } else {
                    // Fallback search with simple query
                    log('Using fallback search strategy');
                    const fallbackQuery = `${learningPoint} tutorial`;
                    const results = await this.videoSourcer.searchYouTube(fallbackQuery);
                    allVideos.push(...results);
                }

                log(`Total videos found: ${allVideos.length}`);

                if (allVideos.length === 0) {
                    updateCanvasVisuals('🚫 No videos found', 'Creating educational content...');
                    await this.createFallbackContent(learningPoint);
                    return;
                }

                // Remove duplicates and get top educational videos
                const uniqueVideos = allVideos
                    .filter((video, index, self) => self.findIndex(v => v.youtubeId === video.youtubeId) === index)
                    .sort((a, b) => (b.educationalScore || 0) - (a.educationalScore || 0))
                    .slice(0, 8);

                log(`Unique videos after filtering: ${uniqueVideos.length}`);

                // Skip transcript checking and use all videos
                currentVideoChoices = uniqueVideos.map(video => ({
                    ...video,
                    hasTranscript: true // Assume all videos can be used
                }));

                if (currentVideoChoices.length === 0) {
                    updateCanvasVisuals('😔 No suitable videos', 'Creating educational content...');
                    await this.createFallbackContent(learningPoint);
                    return;
                }

                log(`FLOW: Found ${currentVideoChoices.length} educational videos`);
                this.autoSelectBestVideo(learningPoint);
                
            } catch (error) {
                logError('Video search failed:', error);
                updateCanvasVisuals('❌ Search failed', 'Creating educational content...');
                await this.createFallbackContent(learningPoint);
            }
        }

        // STEP 4: Auto-select best video (no more manual choice)
        autoSelectBestVideo(learningPoint) {
            log("FLOW: Step 4 - Auto-selecting best educational video");
            updateStatus('choosing_video');
            
            if (!currentVideoChoices || currentVideoChoices.length === 0) {
                logError('No video choices available, falling back to content creation');
                this.createFallbackContent(learningPoint);
                return;
            }
            
            // Sort by educational score and automatically pick the best one
            const bestVideo = currentVideoChoices[0];
            log(`FLOW: Selected best video: ${bestVideo.title} (ID: ${bestVideo.youtubeId})`);
            updateCanvasVisuals('✅ Video selected!', `"${bestVideo.title}"`);
            
            // Automatically proceed with the best video
            log('FLOW: Will proceed to video selection in 1.5 seconds');
            setTimeout(() => {
                log('FLOW: Timeout completed, calling handleVideoSelection');
                this.handleVideoSelection(bestVideo);
            }, 1500);
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

        // STEP 5: Direct to segment generation using video URL context
        async handleVideoSelection(video) {
            log("FLOW: Step 5 - Proceeding with URL-based segment analysis");
            updateStatus('generating_segments');
            updateCanvasVisuals('🎯 Analyzing video for learning segments...', `"${video.title}"`);

            // Skip transcript loading entirely and use URL context
            await this.generateSegments(video);
        }

        // STEP 7: Generate segments from video URL
        async generateSegments(video) {
            log("FLOW: Step 7 - Generate segments");
            updateStatus('generating_segments');
            updateCanvasVisuals('✂️ Finding best segments...', 'Analyzing video content...');

            try {
                const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
                const youtubeUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;
                
                // Try to get transcript for better analysis
                updateCanvasVisuals('📝 Analyzing transcript...', 'Getting video content...');
                const transcript = await this.videoSourcer.getTranscript(video.youtubeId);
                
                if (transcript) {
                    log('Using transcript-based segment analysis');
                    currentSegments = await this.gemini.findVideoSegmentsWithTranscript(video.title, youtubeUrl, learningPoint, transcript);
                } else {
                    log('No transcript available, using URL-based analysis');
                    currentSegments = await this.gemini.findVideoSegments(video.title, youtubeUrl, learningPoint);
                }
                
                if (!currentSegments || currentSegments.length === 0) {
                    log('No segments generated, creating default segment');
                    currentSegments = [{ startTime: 30, endTime: 180, reason: "Default educational segment" }];
                }
                
                log(`Generated ${currentSegments.length} segments:`, currentSegments);
                currentSegmentPlayIndex = 0;

                updateCanvasVisuals('🎬 Starting video playback...', 'Loading player...');
                
                // Ensure we actually play the segments
                log('FLOW: About to call playSegments with video:', video.youtubeId);
                this.playSegments(video);
                
            } catch (error) {
                logError('Failed to generate segments:', error);
                // Fallback to default segment and still play video
                currentSegments = [{ startTime: 30, endTime: 180, reason: "Fallback segment due to error" }];
                currentSegmentPlayIndex = 0;
                log('FLOW: Error occurred, but still attempting to play video');
                this.playSegments(video);
            }
        }

        // STEP 8: Play segments
        playSegments(video) {
            log("FLOW: Step 8 - Play segments");
            updateStatus('playing_video');
            updatePlayPauseIcon();
            this.createYouTubePlayer(video);
        }

        createYouTubePlayer(videoInfo) {
            if (this.youtubePlayer) { 
                try {
                    this.youtubePlayer.destroy(); 
                } catch (e) {
                    log('Error destroying previous player:', e);
                }
                this.youtubePlayer = null;
            }
            
            ui.skipVideoButton.style.display = 'block';
            ui.canvas.style.opacity = '0';
            
            log(`Creating YouTube player for video: ${videoInfo.youtubeId}`);
            log(`Available segments: ${currentSegments.length}`);
            
            // Validate video info
            if (!videoInfo || !videoInfo.youtubeId || videoInfo.youtubeId.length < 10) {
                logError('Invalid video info:', videoInfo);
                this.handleVideoError();
                return;
            }
            
            if (!currentSegments || currentSegments.length === 0) {
                log('No segments available, creating default segment');
                currentSegments = [{ startTime: 30, endTime: 180, reason: "Default video segment" }];
            }
            
            currentSegmentPlayIndex = 0;
            
            // Check if YouTube API is loaded
            if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
                log('YouTube API not loaded, waiting...');
                setTimeout(() => this.createYouTubePlayer(videoInfo), 2000);
                return;
            }
            
            // Store video info and start playing
            this.currentVideoInfo = videoInfo;
            this.playCurrentSegment();
        }

        playCurrentSegment() {
            if (currentSegmentPlayIndex >= currentSegments.length) {
                log('FLOW: All segments complete, showing quiz');
                this.showQuiz();
                return;
            }

            const segment = currentSegments[currentSegmentPlayIndex];
            log(`Playing segment ${currentSegmentPlayIndex + 1}/${currentSegments.length}: ${segment.startTime}s - ${segment.endTime}s`);
            
            // Use stored video info
            const videoInfo = this.currentVideoInfo;
            if (!videoInfo || !videoInfo.youtubeId) {
                logError('No valid video info available, proceeding to quiz');
                this.showQuiz();
                return;
            }
            
            // Destroy existing player with timeout protection
            if (this.youtubePlayer) { 
                try {
                    this.youtubePlayer.destroy(); 
                } catch (e) {
                    log('Error destroying player:', e);
                }
                this.youtubePlayer = null;
            }
            
            // Get container and validate
            const container = document.getElementById('youtube-player-container');
            if (!container) {
                logError('YouTube player container not found, proceeding to quiz');
                this.showQuiz();
                return;
            }
            
            // Clear container and create new player div
            container.innerHTML = '';
            const playerDiv = document.createElement('div');
            playerDiv.id = 'youtube-player-' + Date.now();
            playerDiv.style.cssText = 'width: 100%; height: 100%; background: #000;';
            container.appendChild(playerDiv);
            
            // Validate and adjust segment times for better compatibility
            let startTime = Math.max(0, Math.floor(segment.startTime || 30));
            let endTime = Math.floor(segment.endTime || startTime + 120);
            
            // Ensure reasonable segment length (30s minimum, 300s maximum)
            if (endTime - startTime < 30) {
                endTime = startTime + 60;
            }
            if (endTime - startTime > 300) {
                endTime = startTime + 300;
            }
            
            log(`Creating player for video: ${videoInfo.youtubeId}`);
            log(`Adjusted segment times: ${startTime}s to ${endTime}s`);
            
            // Set timeout for video loading failure
            const videoTimeout = setTimeout(() => {
                logError('Video loading timeout, proceeding to next segment or quiz');
                this.handleVideoTimeout();
            }, 15000); // 15 second timeout
            
            // Create player with enhanced error handling
            try {
                this.youtubePlayer = new YT.Player(playerDiv.id, {
                    height: '100%', 
                    width: '100%', 
                    videoId: videoInfo.youtubeId,
                    playerVars: { 
                        autoplay: 1, 
                        controls: 1, 
                        rel: 0, 
                        start: startTime, 
                        end: endTime,
                        modestbranding: 1,
                        iv_load_policy: 3,
                        enablejsapi: 1,
                        origin: window.location.origin,
                        fs: 0,
                        cc_load_policy: 1,
                        playsinline: 1,
                        html5: 1
                    },
                    events: {
                        'onReady': (event) => {
                            clearTimeout(videoTimeout);
                            log('YouTube player ready, starting playback');
                            setTimeout(() => {
                                try {
                                    if (this.youtubePlayer && this.youtubePlayer.playVideo) {
                                        this.youtubePlayer.playVideo();
                                        updateStatus('playing_video');
                                        updatePlayPauseIcon();
                                    }
                                } catch (e) {
                                    logError('Error starting video:', e);
                                    this.tryNextSegmentOrQuiz();
                                }
                            }, 1000);
                        },
                        'onStateChange': (event) => {
                            log(`YouTube player state: ${event.data}`);
                            if (event.data === YT.PlayerState.ENDED) {
                                clearTimeout(videoTimeout);
                                log('Video segment ended, moving to next');
                                currentSegmentPlayIndex++;
                                setTimeout(() => this.playCurrentSegment(), 1500);
                            } else if (event.data === YT.PlayerState.PLAYING) {
                                clearTimeout(videoTimeout);
                                updateStatus('playing_video');
                                updatePlayPauseIcon();
                            } else if (event.data === YT.PlayerState.PAUSED) {
                                updateStatus('paused');
                                updatePlayPauseIcon();
                            } else if (event.data === YT.PlayerState.CUED) {
                                log('Video cued, attempting to play');
                                setTimeout(() => {
                                    if (this.youtubePlayer && this.youtubePlayer.playVideo) {
                                        this.youtubePlayer.playVideo();
                                    }
                                }, 500);
                            }
                        },
                        'onError': (event) => { 
                            clearTimeout(videoTimeout);
                            logError(`YouTube player error: ${event.data} (Video ID: ${videoInfo.youtubeId})`);
                            this.tryNextSegmentOrQuiz();
                        }
                    }
                });
            } catch (error) {
                clearTimeout(videoTimeout);
                logError('Failed to create YouTube player:', error);
                this.tryNextSegmentOrQuiz();
            }
        }
        
        handleVideoTimeout() {
            log('Video loading timeout reached');
            this.tryNextSegmentOrQuiz();
        }
        
        tryNextSegmentOrQuiz() {
            currentSegmentPlayIndex++;
            if (currentSegmentPlayIndex >= currentSegments.length) {
                log('No more segments available, showing quiz');
                this.showQuiz();
            } else {
                log('Trying next segment after error/timeout');
                setTimeout(() => this.playCurrentSegment(), 2000);
            }
        }
        
        handleVideoError() {
            logError('Handling video error - cleaning up and proceeding');
            ui.skipVideoButton.style.display = 'none';
            ui.canvas.style.opacity = '1';
            
            if (this.youtubePlayer) {
                try {
                    this.youtubePlayer.destroy();
                } catch (e) {
                    log('Error destroying failed player:', e);
                }
                this.youtubePlayer = null;
            }
            
            // Clear the player container
            const container = document.getElementById('youtube-player-container');
            if (container) {
                container.innerHTML = '';
            }
            
            // Try to proceed with educational content instead
            log('Video playback failed, creating educational content');
            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            updateCanvasVisuals('📚 Video unavailable', 'Creating educational content...');
            setTimeout(async () => {
                await this.createFallbackContent(learningPoint);
            }, 1500);
        }

        // STEP 9: Quiz
        async showQuiz() {
            log("FLOW: Step 9 - Show quiz");
            updateStatus('quiz');
            ui.skipVideoButton.style.display = 'none';
            ui.canvas.style.opacity = '1';
            ui.nextSegmentButton.disabled = false;
            updatePlayPauseIcon();
            
            if (this.youtubePlayer) { 
                this.youtubePlayer.destroy(); 
                this.youtubePlayer = null;
            }
            
            const learningPoint = currentLessonPlan[currentLearningPath][currentSegmentIndex];
            const quiz = await this.gemini.generateQuiz(learningPoint, null);
            
            if (quiz) {
                this.displayQuiz(quiz);
            } else {
                updateCanvasVisuals("Quiz completed", "Click 'Next Segment' to continue...");
                ui.nextSegmentButton.disabled = false;
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
        ui.nextSegmentButton.addEventListener('click', (e) => { 
            e.preventDefault();
            e.stopPropagation();
            log(`Next segment clicked - Disabled: ${ui.nextSegmentButton.disabled}, State: ${lessonState}`);
            if (!ui.nextSegmentButton.disabled) {
                ui.nextSegmentButton.disabled = true;
                learningPipeline.processNextLearningPoint(); 
            }
        });
        ui.skipVideoButton.addEventListener('click', (e) => { 
            e.preventDefault();
            e.stopPropagation();
            log(`Skip video clicked - State: ${lessonState}`);
            if (lessonState === 'playing_video') {
                if (learningPipeline.youtubePlayer) {
                    learningPipeline.youtubePlayer.destroy();
                    learningPipeline.youtubePlayer = null;
                }
                // Skip all remaining segments and go to quiz
                currentSegmentPlayIndex = currentSegments.length;
                learningPipeline.showQuiz(); 
            }
        });
    }

    function playPauseLesson() {
        log(`Play/Pause clicked - Current state: ${lessonState}`);
        
        switch (lessonState) {
            case 'narrating': 
                learningPipeline.speechEngine.pause(); 
                updateStatus("narration_paused"); 
                log('Narration paused');
                break;
            case 'narration_paused': 
                learningPipeline.speechEngine.resume(); 
                updateStatus("narrating"); 
                log('Narration resumed');
                break;
            case 'playing_video': 
                if (learningPipeline.youtubePlayer) {
                    learningPipeline.youtubePlayer.pauseVideo(); 
                    updateStatus("paused"); 
                    log('Video paused');
                }
                break;
            case 'paused': 
                if (learningPipeline.youtubePlayer) {
                    learningPipeline.youtubePlayer.playVideo(); 
                    updateStatus("playing_video"); 
                    log('Video resumed');
                }
                break;
            default:
                log(`Cannot play/pause in state: ${lessonState}`);
        }
        updatePlayPauseIcon();
    }

    function updatePlayPauseIcon() {
        const isPlaying = lessonState === 'playing_video' || lessonState === 'narrating';
        ui.playIcon.classList.toggle('hidden', isPlaying);
        ui.pauseIcon.classList.toggle('hidden', !isPlaying);
        log(`Icon updated - Playing: ${isPlaying}, State: ${lessonState}`);
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
    
    // Ensure YouTube API is properly loaded
    window.onYouTubeIframeAPIReady = () => {
        log("YouTube API ready");
        window.youtubeAPIReady = true;
    };
    
    // Fallback to load YouTube API if not already loaded
    if (!window.YT && !document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
});
