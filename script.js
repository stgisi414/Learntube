document.addEventListener('DOMContentLoaded', () => {
    // --- CORE VARIABLES --- //
    let currentLessonPlan = null;
    let currentLearningPath = null;
    let currentSegmentIndex = -1;
    let lessonState = 'idle'; // 'idle', 'narrating', 'narration_paused', 'playing_video', 'paused', 'ending'
    let currentUtterance = null;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let isScrolling = false;

    // --- HTML ELEMENT REFERENCES --- //
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
        video: document.getElementById('lessonVideo'),
        playPauseButton: document.getElementById('play-pause-button'),
        playIcon: document.getElementById('play-icon'),
        pauseIcon: document.getElementById('pause-icon'),
        nextSegmentButton: document.getElementById('next-segment-button'),
        skipVideoButton: document.getElementById('skip-video-button'),
        currentTopicDisplay: document.getElementById('current-topic-display'),
        videoVolume: document.getElementById('video-volume'),
        narrationVolume: document.getElementById('narration-volume'),
        progressBar: document.getElementById('progress-bar'),
        errorDisplay: document.getElementById('error-display'),
        errorMessage: document.getElementById('error-message'),
        segmentProgress: document.getElementById('segment-progress')
    };
    const canvasCtx = ui.canvas.getContext('2d');

    // --- API CONFIGURATION --- //
    const GEMINI_API_KEY = "AIzaSyAo4mWr5x3UPEACzFC3_6W0bd1DG8dCudA";
    const YOUTUBE_API_KEY = "AIzaSyBQLgFiUYdSNvpbyO_TgdzXmSvT9BFgal4";
    const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

    // --- CENTRALIZED GEMINI ORCHESTRATOR --- //
    class GeminiOrchestrator {
        constructor() {
            this.requestQueue = [];
            this.isProcessing = false;
            this.rateLimitDelay = 1000; // 1 second between requests
        }

        async makeRequest(prompt, options = {}) {
            return new Promise((resolve, reject) => {
                this.requestQueue.push({ prompt, options, resolve, reject });
                this.processQueue();
            });
        }

        async processQueue() {
            if (this.isProcessing || this.requestQueue.length === 0) return;

            this.isProcessing = true;
            const { prompt, options, resolve, reject } = this.requestQueue.shift();

            try {
                await new Promise(r => setTimeout(r, this.rateLimitDelay));
                const result = await this.executeSingleRequest(prompt, options);
                resolve(result);
            } catch (error) {
                reject(error);
            } finally {
                this.isProcessing = false;
                // Process next item in queue
                if (this.requestQueue.length > 0) {
                    setTimeout(() => this.processQueue(), 100);
                }
            }
        }

        async executeSingleRequest(prompt, options = {}) {
            const defaultConfig = {
                temperature: 0.7,
                maxOutputTokens: 2048,
                ...options
            };

            const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: defaultConfig
                })
            });

            if (!response.ok) {
                throw new Error(`Gemini API failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!content) {
                throw new Error('No content generated from Gemini API');
            }

            return content.trim();
        }

        // LESSON PLAN GENERATION
        async generateLessonPlan(topic) {
            const prompt = `Create a comprehensive learning curriculum for: "${topic}".

Generate exactly 4 difficulty levels with exactly 5 learning points each:
1. Apprentice (Beginner): Fundamentals, basic terminology, simple applications
2. Journeyman (Intermediate): Deeper analysis, practical applications, connections
3. Senior (Advanced): Complex theories, advanced applications, critical analysis
4. Master (Expert): Cutting-edge developments, philosophical implications, synthesis

Each learning point should be:
- Specific and focused on one concept
- Searchable on YouTube with educational content
- Appropriate for the difficulty level
- Progressive in complexity within each level

Return ONLY valid JSON in this exact format:
{
  "Apprentice": ["point1", "point2", "point3", "point4", "point5"],
  "Journeyman": ["point1", "point2", "point3", "point4", "point5"],
  "Senior": ["point1", "point2", "point3", "point4", "point5"]
}`;

            const response = await this.makeRequest(prompt);
            return this.parseJSONResponse(response);
        }

        // LESSON PLAN VALIDATION
        async validateLessonPlan(lessonPlan, topic) {
            const prompt = `Review this lesson plan for "${topic}" and ensure quality:

${JSON.stringify(lessonPlan, null, 2)}

Check for:
1. Logical progression within each level
2. Clear distinction between difficulty levels
3. Searchable learning points that would have educational YouTube videos
4. Comprehensive coverage of the topic
5. Appropriate complexity for each level

Rate each aspect 1-10 and provide specific improvements if any score is below 8.
If the lesson plan needs major revisions, suggest specific replacements.

Return ONLY valid JSON:
{
  "scores": {
    "progression": 8,
    "distinction": 9,
    "searchability": 7,
    "coverage": 8,
    "complexity": 9
  },
  "overallQuality": 8.2,
  "needsRevision": false,
  "improvements": ["specific suggestion 1", "specific suggestion 2"],
  "revisedPlan": null
}`;

            const response = await this.makeRequest(prompt);
            return this.parseJSONResponse(response);
        }

        // SEARCH QUERY GENERATION
        async generateSearchQueries(learningPoint, topic) {
            const prompt = `Generate 5 optimized YouTube search queries for finding educational videos about: "${learningPoint}" within the topic of "${topic}".

Focus on:
- Educational content with captions
- University lectures or academic content
- Tutorial and explanation videos
- Documentary-style content
- How-to guides

Return ONLY a JSON array: ["query1", "query2", "query3", "query4", "query5"]`;

            const response = await this.makeRequest(prompt, { temperature: 0.5, maxOutputTokens: 256 });
            return this.parseJSONResponse(response);
        }

        // NARRATION GENERATION
        async generateNarration(learningPoint, previousPoint, videoTitle, context = {}) {
            let prompt;

            if (previousPoint) {
                // Continuation narration - bridge from previous topic
                prompt = `Previous topic: "${previousPoint}". Current topic: "${learningPoint}".

Create a 2-3 sentence narration bridge for this learning segment:
1. Acknowledge the previous topic we just covered
2. Transition smoothly to current topic: "${learningPoint}"
3. Set expectations for the upcoming video: "${videoTitle}"
4. Be conversational and engaging
5. Keep it 50-80 words for text-to-speech

Return ONLY the narration text, no quotes or formatting.`;
            } else {
                // Opening narration - start of lesson
                prompt = `Starting a new lesson on: "${learningPoint}".

Create a 2-3 sentence opening narration for this learning segment:
1. Welcome the learner and introduce the topic: "${learningPoint}"
2. Explain what they'll learn in this first segment
3. Set expectations for the upcoming video: "${videoTitle}"
4. Be enthusiastic and engaging to start the lesson
5. Keep it 50-80 words for text-to-speech

Return ONLY the narration text, no quotes or formatting.`;
            }

            return await this.makeRequest(prompt, { temperature: 0.8, maxOutputTokens: 256 });
        }

        // QUIZ GENERATION
        async generateQuiz(completedTopics, level) {
            const prompt = `Create a quiz for the ${level} level covering these topics: ${completedTopics.join(', ')}.

Generate exactly 5 multiple choice questions with:
- 4 options each (A, B, C, D)
- Clear explanations for correct answers
- Difficulty appropriate for ${level} level

Return ONLY valid JSON:
{
  "questions": [
    {
      "question": "Question text?",
      "options": ["A) option", "B) option", "C) option", "D) option"],
      "correct": 0,
      "explanation": "Why this is correct..."
    }
  ]
}`;

            const response = await this.makeRequest(prompt);
            return this.parseJSONResponse(response);
        }

        // FEEDBACK GENERATION
        async generateFeedback(score, totalQuestions, level, incorrectTopics) {
            const prompt = `Generate personalized feedback for a learner who scored ${score}/${totalQuestions} on a ${level} level quiz.

Incorrect topics: ${incorrectTopics.join(', ') || 'None'}

Provide:
1. Encouraging tone
2. Specific areas for improvement
3. Study suggestions
4. Next steps recommendations

Return 2-3 sentences, 60-100 words total.`;

            return await this.makeRequest(prompt, { temperature: 0.7, maxOutputTokens: 256 });
        }

        // VIDEO SEGMENT FINDING
        async findVideoSegment(videoTitle, videoDescription, learningPoint) {
            const prompt = `Analyze this YouTube video to find the most relevant segment that specifically teaches about: "${learningPoint}".

Video Title: "${videoTitle}"
Video Description: "${videoDescription.substring(0, 800)}"

Look for:
1. Timestamps mentioned in the description
2. Chapter markers or sections
3. Keywords related to "${learningPoint}"
4. Educational content indicators

If the video is longer than 10 minutes, find a specific 60-90 second segment where "${learningPoint}" is actually explained.
If shorter than 10 minutes, you can use up to 3 minutes but focus on the most relevant part.

Avoid generic introductions - find where the actual learning content begins.

Return ONLY valid JSON:
{"startTime": 180, "endTime": 270, "reason": "This segment explains the core concept with examples"}`;

            const response = await this.makeRequest(prompt, { temperature: 0.3, maxOutputTokens: 256 });
            return this.parseJSONResponse(response);
        }

        parseJSONResponse(response) {
            try {
                // First try to parse the entire response as JSON
                try {
                    return JSON.parse(response);
                } catch (e) {
                    // Continue to extract JSON from markdown
                }

                // Extract JSON from markdown code blocks
                let jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[1].trim());
                }

                // Try to find JSON object
                jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }

                // Try to find JSON array
                jsonMatch = response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }

                throw new Error('No JSON found in response');
            } catch (error) {
                console.error('JSON parse error:', error, 'Response:', response);
                throw new Error('Invalid JSON in Gemini response');
            }
        }
    }

    // --- VIDEO SOURCING ENGINE --- //
    class VideoSourcer {
        constructor(geminiOrchestrator) {
            this.gemini = geminiOrchestrator;
            this.cache = new Map();
        }

        // Pre-source all videos for a lesson plan level
        async preSourceVideos(learningPoints, topic, level) {
            const videoMap = new Map();
            showLoading(`Finding educational videos for ${level} level...`);

            for (let i = 0; i < learningPoints.length; i++) {
                const point = learningPoints[i];
                updateLoadingMessage(`Finding video ${i + 1}/${learningPoints.length}: ${point}`);

                try {
                    const video = await this.findAndValidateVideo(point, topic, level);
                    videoMap.set(point, video);
                } catch (error) {
                    console.warn(`Failed to source video for: ${point}`, error);
                    videoMap.set(point, this.createFallbackVideo(point));
                }
            }

            return videoMap;
        }

        async findAndValidateVideo(learningPoint, topic, level) {
            const cacheKey = `${topic}:${learningPoint}:${level}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            try {
                // Generate optimized search queries using Gemini
                const searchQueries = await this.gemini.generateSearchQueries(learningPoint, topic);

                for (const query of searchQueries) {
                    try {
                        const video = await this.searchYouTube(query);
                        if (video) {
                            // Validate video relevance
                            const isRelevant = await this.validateVideoRelevance(video, learningPoint, topic);
                            if (isRelevant) {
                                // Find the specific segment
                                try {
                                    const segment = await this.gemini.findVideoSegment(video.title, video.description, learningPoint);
                                    if (segment && segment.startTime !== undefined && segment.endTime !== undefined) {
                                        video.startTime = segment.startTime;
                                        video.endTime = segment.endTime;
                                        video.duration = segment.endTime - segment.startTime;
                                    } else {
                                        // Use default segment if AI segment finding fails
                                        video.startTime = 0;
                                        video.endTime = Math.min(video.duration || 60, 30);
                                        video.duration = video.endTime - video.startTime;
                                    }
                                } catch (segmentError) {
                                    console.warn(`Segment finding failed for: ${video.title}`, segmentError);
                                    video.startTime = 0;
                                    video.endTime = Math.min(video.duration || 60, 30);
                                    video.duration = video.endTime - video.startTime;
                                }
                                this.cache.set(cacheKey, video);
                                return video;
                            }
                        }
                    } catch (error) {
                        console.warn(`Search failed for: ${query}`, error);
                        continue;
                    }
                }

                // Fallback if no videos found
                return this.createFallbackVideo(learningPoint);
            } catch (error) {
                console.error('Video sourcing failed:', error);
                return this.createFallbackVideo(learningPoint);
            }
        }

        async validateVideoRelevance(video, learningPoint, topic) {
            if (!video.title || !video.description) return false;

            try {
                const prompt = `Does this YouTube video match the learning objective?

Learning Point: "${learningPoint}"
Topic: "${topic}"

Video Title: "${video.title}"
Video Description: "${video.description.substring(0, 500)}"

Rate relevance 1-10 and explain if this video would help someone learn about "${learningPoint}" in the context of "${topic}".

Return ONLY valid JSON:
{
  "relevanceScore": 8,
  "isRelevant": true,
  "reasoning": "This video directly explains the concept with clear examples"
}`;

                const response = await this.gemini.makeRequest(prompt, { temperature: 0.3, maxOutputTokens: 256 });
                const validation = this.gemini.parseJSONResponse(response);

                return validation.relevanceScore >= 7 && validation.isRelevant;
            } catch (error) {
                console.warn('Video validation failed:', error);
                // Default to true for fallback
                return true;
            }
        }

        async findVideo(learningPoint, topic) {
            return await this.findAndValidateVideo(learningPoint, topic, 'general');
        }

        async searchYouTube(query) {
            const searchParams = new URLSearchParams({
                part: 'snippet',
                q: query,
                type: 'video',
                maxResults: '10',
                order: 'relevance',
                videoCategoryId: '27', // Education category
                videoCaption: 'closedCaption',
                key: YOUTUBE_API_KEY
            });

            // Try multiple approaches for referrer handling
            const requestOptions = {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Referer': window.location.origin + '/',
                    'Origin': window.location.origin
                },
                referrerPolicy: "strict-origin-when-cross-origin"
            };

            // Add domain-specific headers if deployed
            const currentDomain = window.location.hostname;
            if (currentDomain.includes('replit.app') || currentDomain.includes('learntube.cc')) {
                requestOptions.headers['Referer'] = window.location.origin + '/';
                requestOptions.headers['Origin'] = window.location.origin;
                requestOptions.referrerPolicy = "strict-origin-when-cross-origin";
            }

            const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`, requestOptions);

            if (!response.ok) {
                throw new Error(`YouTube API failed: ${response.status}`);
            }

            const data = await response.json();
            const items = data.items || [];

            if (items.length === 0) return null;

            // Score and select best video with captions
            const scoredVideos = items.map(item => ({
                ...item,
                score: this.scoreVideo(item)
            })).sort((a, b) => b.score - a.score);

            // Try to get video details and captions for the best candidates
            for (const video of scoredVideos.slice(0, 3)) {
                try {
                    const videoDetails = await this.getVideoWithCaptions(video.id.videoId);
                    if (videoDetails) {
                        return videoDetails;
                    }
                } catch (error) {
                    console.warn(`Failed to get captions for video ${video.id.videoId}:`, error);
                    continue;
                }
            }

            // Fallback to best scored video without caption verification
            const bestVideo = scoredVideos[0];
            return {
                youtubeId: bestVideo.id.videoId,
                title: bestVideo.snippet.title,
                description: bestVideo.snippet.description,
                url: null, // We'll use iframe instead
                duration: 60,
                captionSnippet: null
            };
        }

        async getVideoWithCaptions(videoId) {
            try {
                // Get video details first
                const requestOptions = {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'omit',
                    headers: {
                        'Accept': 'application/json'
                    },
                    referrerPolicy: "strict-origin-when-cross-origin"
                };

                const currentDomain = window.location.hostname;
                if (currentDomain.includes('replit.app') || currentDomain.includes('learntube.cc')) {
                    requestOptions.headers['Referer'] = window.location.href;
                    requestOptions.headers['Origin'] = window.location.origin;
                }

                const videoResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`, requestOptions);
                if (!videoResponse.ok) return null;

                const videoData = await videoResponse.json();
                const video = videoData.items?.[0];
                if (!video) return null;

                // Parse video duration
                const duration = this.parseDuration(video.contentDetails.duration);

                // Get available captions
                const captionsRequestOptions = {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'omit',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    referrerPolicy: "no-referrer-when-downgrade"
                };

                if (currentDomain.includes('replit.app') || currentDomain.includes('learntube.cc')) {
                    captionsRequestOptions.headers['Referer'] = window.location.origin + '/';
                    captionsRequestOptions.headers['Origin'] = window.location.origin;
                    captionsRequestOptions.referrerPolicy = "strict-origin-when-cross-origin";
                }

                const captionsResponse = await fetch(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}&key=${YOUTUBE_API_KEY}`, captionsRequestOptions);
                if (!captionsResponse.ok) {
                    // Return video without captions
                    return {
                        youtubeId: videoId,
                        title: video.snippet.title,
                        description: video.snippet.description,
                        url: null, // We'll use iframe instead
                        duration: Math.min(duration, 120),
                        captionSnippet: null
                    };
                }

                const captionsData = await captionsResponse.json();
                const captions = captionsData.items || [];

                // Find English captions
                const englishCaption = captions.find(cap => 
                    cap.snippet.language === 'en' || 
                    cap.snippet.language === 'en-US'
                );

                if (englishCaption) {
                    // For now, we'll use the video with a reasonable time segment
                    // In a full implementation, you'd download and parse the caption file
                    const segmentDuration = Math.min(duration, 90);

                    return {
                        youtubeId: videoId,
                        title: video.snippet.title,
                        description: video.snippet.description,
                        url: null, // We'll use iframe instead
                        duration: segmentDuration,
                        captionSnippet: `Educational content from: ${video.snippet.title}`,
                        hasCaptions: true
                    };
                }

                return null;
            } catch (error) {
                console.error('Error getting video with captions:', error);
                return null;
            }
        }

        parseDuration(duration) {
            // Parse ISO 8601 duration (PT1M30S format)
            const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (!matches) return 60;

            const hours = parseInt(matches[1] || 0);
            const minutes = parseInt(matches[2] || 0);
            const seconds = parseInt(matches[3] || 0);

            return hours * 3600 + minutes * 60 + seconds;
        }

        scoreVideo(item) {
            let score = 0;
            const title = item.snippet.title.toLowerCase();
            const description = item.snippet.description.toLowerCase();

            // Educational keywords
            const eduKeywords = ['tutorial', 'explained', 'lesson', 'learn', 'education', 'course', 'lecture'];
            eduKeywords.forEach(keyword => {
                if (title.includes(keyword)) score += 15;
                if (description.includes(keyword)) score += 5;
            });

            // Quality indicators
            const qualityKeywords = ['university', 'professor', 'academic', 'khan academy', 'crash course'];
            qualityKeywords.forEach(keyword => {
                if (title.includes(keyword) || description.includes(keyword)) score += 20;
            });

            return score;
        }

        createFallbackVideo(learningPoint) {
            return {
                youtubeId: null,
                title: `Educational Content: ${learningPoint}`,
                description: `Visual learning content for ${learningPoint}`,
                url: null,
                duration: 20,
                isFallback: true
            };
        }
    }

    // --- TEXT-TO-SPEECH ENGINE --- //
    class SpeechEngine {
        constructor() {
            this.isReady = false;
            this.voices = [];
            this.preferredVoice = null;
            this.currentUtterance = null;
            this.onBoundary = null;
            this.speechSynthAvailable = this.checkSpeechSynthesis();
            this.initializeVoices();
        }

        checkSpeechSynthesis() {
            try {
                return typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis !== null;
            } catch (error) {
                console.warn('Speech synthesis not available:', error);
                return false;
            }
        }

        initializeVoices() {
            if (!this.speechSynthAvailable) {
                console.warn('Speech synthesis not available in this environment');
                this.isReady = false;
                return;
            }

            try {
                const loadVoices = () => {
                    this.voices = window.speechSynthesis.getVoices();
                    this.preferredVoice = this.selectBestVoice();
                    this.isReady = true;
                };

                loadVoices();
                if (window.speechSynthesis.onvoiceschanged !== undefined) {
                    window.speechSynthesis.onvoiceschanged = loadVoices;
                }
            } catch (error) {
                console.warn('Failed to initialize voices:', error);
                this.isReady = false;
            }
        }

        selectBestVoice() {
            const voices = this.voices.filter(v => v.lang.startsWith('en'));
            return voices.find(v => v.name.toLowerCase().includes('google')) ||
                   voices.find(v => v.name.toLowerCase().includes('natural')) ||
                   voices.find(v => v.lang === 'en-US') ||
                   voices[0];
        }

        speak(text, volume = 1.0, onBoundaryCallback) {
            return new Promise((resolve, reject) => {
                let timerInterval = null;
                let speechStartTime = Date.now();
                let lastCharIndex = 0;

                // Calculate estimated speech duration (average 180 words per minute)
                const words = text.split(' ').length;
                const estimatedDuration = (words / 180) * 60 * 1000; // in milliseconds

                // Timer-based fallback that simulates speech progression
                const startTimerFallback = () => {
                    console.log('Starting timer-based teleprompter fallback');
                    const updateInterval = 100; // Update every 100ms
                    const totalChars = text.length;

                    timerInterval = setInterval(() => {
                        const elapsed = Date.now() - speechStartTime;
                        const progress = Math.min(elapsed / estimatedDuration, 1);
                        const currentCharIndex = Math.floor(progress * totalChars);

                        if (onBoundaryCallback && currentCharIndex > lastCharIndex) {
                            onBoundaryCallback({ charIndex: currentCharIndex });
                            lastCharIndex = currentCharIndex;
                        }

                        if (progress >= 1) {
                            clearInterval(timerInterval);
                            resolve();
                        }
                    }, updateInterval);
                };

                // Try speech synthesis first
                if (this.speechSynthAvailable) {
                    try {
                        if (window.speechSynthesis.speaking) {
                            window.speechSynthesis.cancel();
                        }

                        const utterance = new SpeechSynthesisUtterance(text);
                        this.currentUtterance = utterance;
                        this.onBoundary = onBoundaryCallback;
                        let speechSuccessful = false;

                        utterance.volume = volume;
                        utterance.rate = 1.0;
                        utterance.pitch = 1.0;
                        if (this.preferredVoice) {
                            utterance.voice = this.preferredVoice;
                        }

                        utterance.onstart = () => {
                            speechSuccessful = true;
                            console.log('Speech synthesis started successfully');
                        };

                        utterance.onboundary = (event) => {
                            try {
                                if (onBoundaryCallback && event.charIndex !== undefined) {
                                    onBoundaryCallback(event);
                                }
                            } catch (error) {
                                console.warn('Boundary callback error:', error);
                            }
                        };

                        utterance.onend = () => {
                            if (timerInterval) clearInterval(timerInterval);
                            resolve();
                        };

                        utterance.onerror = (error) => {
                            console.warn('Speech synthesis error:', error);
                            if (timerInterval) clearInterval(timerInterval);
                            if (!speechSuccessful) {
                                // Speech failed to start, use timer fallback
                                startTimerFallback();
                            } else {
                                resolve();
                            }
                        };

                        window.speechSynthesis.speak(utterance);

                        // Start timer fallback as backup in case boundary events don't fire
                        setTimeout(() => {
                            if (!speechSuccessful || !this.speechSynthAvailable) {
                                console.log('Speech synthesis may have failed, starting timer fallback');
                                startTimerFallback();
                            }
                        }, 500);

                    } catch (error) {
                        console.warn('Speech synthesis failed:', error);
                        startTimerFallback();
                    }
                } else {
                    // No speech synthesis available, use timer fallback
                    console.warn('Speech synthesis not available, using timer-based teleprompter');
                    startTimerFallback();
                }
            });
        }

        pause() {
            if (!this.speechSynthAvailable) return;
            try {
                if (window.speechSynthesis.speaking) {
                    window.speechSynthesis.pause();
                }
            } catch (error) {
                console.warn('Failed to pause speech:', error);
            }
        }

        resume() {
            if (!this.speechSynthAvailable) return;
            try {
                if (window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                }
            } catch (error) {
                console.warn('Failed to resume speech:', error);
            }
        }

        stop() {
            this.currentUtterance = null;
            if (!this.speechSynthAvailable) return;
            try {
                window.speechSynthesis.cancel();
            } catch (error) {
                console.warn('Failed to stop speech:', error);
            }
        }
    }

    // --- QUIZ ENGINE --- //
    class QuizEngine {
        constructor(geminiOrchestrator) {
            this.gemini = geminiOrchestrator;
            this.currentQuiz = null;
            this.userAnswers = [];
            this.score = 0;
        }

        async generateQuiz(completedTopics, level) {
            try {
                this.currentQuiz = await this.gemini.generateQuiz(completedTopics, level);
                this.userAnswers = [];
                this.score = 0;
                return this.currentQuiz;
            } catch (error) {
                console.error('Quiz generation failed:', error);
                return this.createFallbackQuiz(completedTopics, level);
            }
        }

        submitAnswer(questionIndex, answerIndex) {
            this.userAnswers[questionIndex] = answerIndex;
            if (answerIndex === this.currentQuiz.questions[questionIndex].correct) {
                this.score++;
            }
        }

        async generateFeedback(level, completedTopics) {
            const incorrectTopics = this.getIncorrectTopics(completedTopics);
            return await this.gemini.generateFeedback(
                this.score,
                this.currentQuiz.questions.length,
                level,
                incorrectTopics
            );
        }

        getIncorrectTopics(completedTopics) {
            const incorrect = [];
            this.userAnswers.forEach((answer, index) => {
                if (answer !== this.currentQuiz.questions[index].correct) {
                    incorrect.push(completedTopics[index % completedTopics.length]);
                }
            });
            return incorrect;
        }

        createFallbackQuiz(topics, level) {
            return {
                questions: [
                    {
                        question: `What is the main concept behind ${topics[0]}?`,
                        options: ['A) Concept A', 'B) Concept B', 'C) Concept C', 'D) Concept D'],
                        correct: 0,
                        explanation: 'This covers the fundamental principles.'
                    }
                ]
            };
        }
    }

    // --- MAIN LEARNING PIPELINE --- //
    class LearningPipeline {
        constructor() {
            this.gemini = new GeminiOrchestrator();
            this.videoSourcer = new VideoSourcer(this.gemini);
            this.speechEngine = new SpeechEngine();
            this.quizEngine = new QuizEngine(this.gemini);
            this.currentTopic = '';
            this.completedSegments = [];
            this.videoMaps = new Map(); // Store pre-sourced videos by level
            this.youtubePlayer = null; // Hold the player instance
        }

        async generateLessonPlan(topic) {
            this.currentTopic = topic;
            showLoading("Generating comprehensive lesson plan...");

            try {
                // Step 1: Generate initial lesson plan
                let lessonPlan = await this.gemini.generateLessonPlan(topic);

                // Step 2: Validate the lesson plan
                updateLoadingMessage("Validating lesson plan quality...");
                const validation = await this.gemini.validateLessonPlan(lessonPlan, topic);

                // Step 3: Use revised plan if needed
                if (validation.needsRevision && validation.revisedPlan) {
                    lessonPlan = validation.revisedPlan;
                    console.log('Using revised lesson plan');
                }

                // Step 4: Log quality assessment
                console.log('Lesson plan validation:', validation);

                return lessonPlan;
            } catch (error) {
                console.error('Lesson plan generation failed:', error);
                return this.createFallbackLessonPlan(topic);
            }
        }

        async prepareLevel(level, learningPoints) {
            try {
                // Pre-source and validate all videos for this level
                const videoMap = await this.videoSourcer.preSourceVideos(learningPoints, this.currentTopic, level);
                this.videoMaps.set(level, videoMap);
                console.log(`Pre-sourced ${videoMap.size} videos for ${level} level`);
                return true;
            } catch (error) {
                console.error(`Failed to prepare ${level} level:`, error);
                return false;
            }
        }

        async processSegment(learningPoint, previousPoint = null, level) {
            showLoadingMessageOnCanvas(`Preparing: "${learningPoint}"`);

            try {
                // Get pre-sourced video for this learning point
                const videoMap = this.videoMaps.get(level);
                const videoInfo = videoMap ? videoMap.get(learningPoint) : null;

                if (!videoInfo) {
                    throw new Error('No pre-sourced video found');
                }

                // Generate narration with video context
                const narrationText = await this.gemini.generateNarration(
                    learningPoint, 
                    previousPoint, 
                    videoInfo.title
                );

                console.log('Segment ready:', { learningPoint, videoInfo, narrationText });

                // Execute narration and video sequence
                await this.executeSegment(narrationText, videoInfo);
                this.completedSegments.push(learningPoint);

            } catch (error) {
                console.error('Segment processing failed:', error);
                // Execute fallback segment
                await this.executeSegment(
                    `Let's explore ${learningPoint}. This is an important concept in our lesson.`,
                    this.videoSourcer.createFallbackVideo(learningPoint)
                );
            }
        }

        async executeSegment(narrationText, videoInfo) {
            // Phase 1: Narration
            lessonState = 'narrating';

            // Hide skip video button during narration
            if (ui.skipVideoButton) {
                ui.skipVideoButton.style.display = 'none';
            }

            updateCanvasVisuals(narrationText, 'Listen to the introduction...');

            try {
                const volume = parseFloat(ui.narrationVolume.value);
                // Pass the teleprompter update function as a callback
                await this.speechEngine.speak(narrationText, volume, (event) => {
                    updateTeleprompter(narrationText, event.charIndex);
                });
            } catch (error) {
                console.warn('Speech synthesis failed:', error);
            }

            // Phase 2: Video/Visual Content
            if (lessonState === 'narrating') {
                await this.playVideoContent(videoInfo);            }
        }

        async playVideoContent(videoInfo) {
            lessonState = 'playing_video';
            ui.nextSegmentButton.disabled = true; // Disable until segment ends
            updatePlayPauseIcon();

            // Show skip video button during video playbook
            if (ui.skipVideoButton) {
                ui.skipVideoButton.style.display = 'block';
            }

            if (videoInfo.isFallback || !videoInfo.youtubeId) {
                updateCanvasVisuals(
                    `🎬 ${videoInfo.title}`,
                    "Take a moment to reflect. Click 'Next Segment' when ready."
                );
                setTimeout(() => handleVideoEnd(), 15000);
                ui.nextSegmentButton.disabled = false;
            } else {
                this.createYouTubePlayer(videoInfo);
            }
        }

        createYouTubePlayer(videoInfo) {
            // Remove old player if it exists
            if (this.youtubePlayer) {
                this.youtubePlayer.destroy();
            }
            const playerContainer = document.getElementById('youtube-player-container');
            if (playerContainer) {
                playerContainer.innerHTML = '';
            }

            ui.canvas.style.opacity = '0.3';

            this.youtubePlayer = new YT.Player('youtube-player-container', {
                height: '100%',
                width: '100%',
                videoId: videoInfo.youtubeId,
                playerVars: {
                    autoplay: 1,
                    controls: 1,
                    rel: 0,
                    start: videoInfo.startTime || 0,
                    end: videoInfo.endTime || videoInfo.duration || 30,
                    modestbranding: 1
                },
                events: {
                    'onReady': (event) => {
                        event.target.playVideo();
                        // Calculate segment duration with intelligent limits
                        const startTime = videoInfo.startTime || 0;
                        const endTime = videoInfo.endTime || Math.min(videoInfo.duration || 60, startTime + 90); // Max 90 seconds
                        const segmentDuration = Math.min((endTime - startTime), 180) * 1000; // Max 3 minutes total

                        console.log(`Playing video segment: ${startTime}s to ${endTime}s (${segmentDuration/1000}s duration)`);

                        setTimeout(() => {
                            if (lessonState === 'playing_video') {
                                console.log('Auto-advancing to next segment after timer');
                                handleVideoEnd();
                            }
                        }, segmentDuration + 1000); // 1s buffer
                    },
                    'onStateChange': (event) => {
                        if (event.data === YT.PlayerState.ENDED) {
                            handleVideoEnd();
                        }
                    },
                    'onError': (error) => {
                        console.error('YouTube Player Error:', error);
                        handleVideoError(new Error('YouTube Player failed'));
                    }
                }
            });
        }

        async generateFinalQuiz(level) {
            if (this.completedSegments.length === 0) return null;

            showLoadingMessageOnCanvas("Generating personalized quiz...");

            try {
                return await this.quizEngine.generateQuiz(this.completedSegments, level);
            } catch (error) {
                console.error('Quiz generation failed:', error);
                return null;
            }
        }

        createFallbackLessonPlan(topic) {
            return {
                "Apprentice": [
                    `What is ${topic}? - Core Definition and Overview`,
                    `Key Components and Basic Structure of ${topic}`,
                    `Simple Real-World Examples of ${topic}`,
                    `Common Misconceptions About ${topic}`,
                    `Why ${topic} Matters - Basic Applications`
                ],
                "Journeyman": [
                    `Historical Development and Evolution of ${topic}`,
                    `Intermediate Principles and Mechanisms`,
                    `Practical Applications in Different Fields`,
                    `Relationships Between ${topic} and Related Concepts`,
                    `Problem-Solving Using ${topic} Concepts`
                ],
                "Senior": [
                    `Advanced Theoretical Frameworks in ${topic}`,
                    `Complex Case Studies and Edge Cases`,
                    `Current Research and Recent Developments`,
                    `Critical Analysis of Different Approaches to ${topic}`,
                    `Technical Implementation and Advanced Applications`
                ],
                "Master": [
                    `Interdisciplinary Connections: ${topic} Across Fields`,
                    `Philosophical and Ethical Implications of ${topic}`,
                    `Developing Novel Hypotheses and Research Questions`,
                    `Teaching ${topic} to Other Experts`,
                    `Future Directions and Unsolved Problems in ${topic}`
                ]
            };
        }
    }

    // --- INITIALIZE PIPELINE --- //
    const learningPipeline = new LearningPipeline();

    // --- UTILITY FUNCTIONS (defined early to avoid reference errors) --- //
    // Handle video errors
    function handleVideoError(error) {
        console.error('Video error:', error);

        // Prevent multiple error calls
        if (lessonState === 'error') return;
        lessonState = 'error';

        // Clean up YouTube player
        if (learningPipeline.youtubePlayer) {
            learningPipeline.youtubePlayer.destroy();
            learningPipeline.youtubePlayer = null;
        }

        // Reset video display and show error on canvas
        ui.canvas.style.opacity = '1';
        ui.video.style.opacity = '0';
        ui.video.style.pointerEvents = 'none';
        ui.video.src = '';

        // Clear player container
        const playerContainer = document.getElementById('youtube-player-container');
        if (playerContainer) {
            playerContainer.innerHTML = '';
        }

        // Remove any existing error timeouts
        clearTimeout(window.videoErrorTimeout);

        displayErrorOnCanvas("Video Error", "There was an error playing the video. Continuing to next segment...");
        window.videoErrorTimeout = setTimeout(() => {
            if (lessonState === 'error') {
                processNextSegment(true);
            }
        }, 3000);
    }

    function handleVideoEnd() {
        // Prevent multiple calls
        if (lessonState === 'ending' || lessonState === 'error') return;
        lessonState = 'ending';

        // Clear any existing timeouts
        clearTimeout(window.videoErrorTimeout);

        // Hide skip video button
        if (ui.skipVideoButton) {
            ui.skipVideoButton.style.display = 'none';
        }

        // Clean up YouTube player
        if (learningPipeline.youtubePlayer) {
            learningPipeline.youtubePlayer.destroy();
            learningPipeline.youtubePlayer = null;
        }

        // Reset video display
        ui.canvas.style.opacity = '1';
        ui.video.style.opacity = '0';
        ui.video.style.pointerEvents = 'none';
        ui.video.src = '';

        // Clear player container
        const playerContainer = document.getElementById('youtube-player-container');
        if (playerContainer) {
            playerContainer.innerHTML = '';
        }

        updateCanvasVisuals("Segment Complete! 🎉", "Great job! Preparing the next learning segment...");
        ui.nextSegmentButton.disabled = false; // Ensure the button is enabled
        setTimeout(() => processNextSegment(), 2000);
    }

    function updateProgressBar() {
        if (!ui.video.duration || ui.video.duration === Infinity) return;
        const progress = (ui.video.currentTime / ui.video.duration) * 100;
        ui.progressBar.style.width = `${Math.min(progress, 100)}%`;
    }

    // --- UI EVENT HANDLERS --- //
    function initializeUI() {
        ui.curateButton.addEventListener('click', handleCurateClick);
        ui.topicInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleCurateClick();
        });
        ui.topicInput.addEventListener('input', validateInput);
        ui.playPauseButton.addEventListener('click', playPauseLesson);
        ui.nextSegmentButton.addEventListener('click', () => processNextSegment(true));

        ui.videoVolume.addEventListener('input', (e) => ui.video.volume = parseFloat(e.target.value));
        ui.narrationVolume.addEventListener('input', (e) => { 
            Storage.save('narrationVolume', e.target.value);
        });
        ui.video.addEventListener('timeupdate', updateProgressBar);
        ui.video.addEventListener('ended', handleVideoEnd);
        ui.video.addEventListener('error', (e) => handleVideoError(e));

        document.addEventListener('keydown', handleKeyboardShortcuts);
        loadPreviousSession();

         // Load saved settings
         const savedVideoVolume = Storage.load('videoVolume');
         const savedNarrationVolume = Storage.load('narrationVolume');
         if (savedVideoVolume !== null) ui.videoVolume.value = savedVideoVolume;
         if (savedNarrationVolume !== null) ui.narrationVolume.value = savedNarrationVolume;

         // Initialize skip video button (avoid duplicate listeners)
         if (ui.skipVideoButton && !ui.skipVideoButton.hasAttribute('data-initialized')) {
             ui.skipVideoButton.setAttribute('data-initialized', 'true');
             ui.skipVideoButton.addEventListener('click', () => {
                 console.log('Skip video button clicked');
                 handleVideoEnd(); // Skip to next segment immediately
             });
         }
    }

    function validateInput() {
        const topic = ui.topicInput.value.trim();
        const isValid = topic.length >= 3 && topic.length <= 100;
        ui.curateButton.disabled = !isValid;
    }

    function handleKeyboardShortcuts(e) {
        if (e.target.tagName === 'INPUT') return;

        switch(e.code) {
            case 'Space':
                e.preventDefault();
                if (lessonState === 'playing_video' || lessonState === 'paused') {
                    playPauseLesson();
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (!ui.nextSegmentButton.disabled) {
                    processNextSegment(true);
                }
                break;
            case 'Escape':
                e.preventDefault();
                if (lessonState !== 'idle') {
                    resetToInput();
                }
                break;
        }
    }

    function loadPreviousSession() {
        try {
            const savedTopic = localStorage.getItem('lastTopic');
            if (savedTopic) {
                ui.topicInput.value = savedTopic;
                validateInput();
            }
        } catch (e) {
            console.warn('Failed to load previous session:', e);
        }
    }

    // --- LESSON FLOW MANAGEMENT --- //
    async function handleCurateClick() {
        const topic = ui.topicInput.value.trim();
        if (!topic || topic.length < 3) {
            displayError("Please enter a topic with at least 3 characters.");
            return;
        }

        try {
            localStorage.setItem('lastTopic', topic);
        } catch (e) {
            console.warn('Failed to save topic:', e);
        }

        resetUI();
        ui.curateButton.disabled = true;

        try {
            currentLessonPlan = await learningPipeline.generateLessonPlan(topic);
            hideLoading();
            displayLevelSelection();
        } catch (error) {
            console.error("Failed to generate lesson plan:", error);
            hideLoading();
            displayError("Could not generate the lesson plan. Please try again.");
            ui.curateButton.disabled = false;
        }
    }

    function displayLevelSelection() {
        ui.levelButtonsContainer.innerHTML = '';
        const levels = Object.keys(currentLessonPlan);
        const levelData = [
            { name: 'Apprentice', color: 'blue', description: 'Perfect for beginners' },
            { name: 'Journeyman', color: 'green', description: 'Building intermediate skills' },
            { name: 'Senior', color: 'yellow', description: 'Advanced understanding' },
            { name: 'Master', color: 'red', description: 'Expert-level mastery' }
        ];

        levels.forEach((level, index) => {
            const levelInfo = levelData.find(l => l.name === level) || levelData[index];
            const container = document.createElement('div');
            container.className = 'text-center';

            const button = document.createElement('button');
            button.innerHTML = `
                <div class="text-2xl font-bold mb-2">${level}</div>
                <div class="text-sm opacity-75">${levelInfo.description}</div>
                <div class="text-xs mt-2">${currentLessonPlan[level].length} segments</div>
            `;
            button.className = `w-full p-6 rounded-xl transition-all transform hover:scale-105 shadow-lg bg-${levelInfo.color}-600 hover:bg-${levelInfo.color}-700`;
            button.onclick = () => startLesson(level);

            container.appendChild(button);
            ui.levelButtonsContainer.appendChild(container);
        });

        ui.inputSection.classList.add('hidden');
        ui.levelSelection.classList.remove('hidden');
    }

    async function startLesson(level) {
        console.log('Starting lesson at level:', level);
        currentLearningPath = level;
        currentSegmentIndex = -1;
        learningPipeline.completedSegments = [];

        // Hide level selection but keep canvas hidden until videos are ready
        ui.levelSelection.classList.add('hidden');

        // Show loading indicator while preparing videos
        showLoading(`Preparing ${level} level videos...`);

        try {
            // Prepare all videos for this level before showing canvas
            const learningPoints = currentLessonPlan[level];
            updateLoadingMessage('Finding and validating educational videos...');

            const prepared = await learningPipeline.prepareLevel(level, learningPoints);

            if (!prepared) {
                throw new Error('Failed to prepare lesson content');
            }

            // Only show canvas after videos are prepared
            hideLoading();
            ui.learningCanvasContainer.classList.remove('hidden');
            updateCanvasVisuals(`${level} Level Ready!`, 'All content prepared. Starting your lesson...');
            setTimeout(() => processNextSegment(), 2000);

        } catch (error) {
            console.error('Failed to start lesson:', error);
            hideLoading();
            displayError('Failed to prepare lesson content. Please try a different level or topic.');
            ui.levelSelection.classList.remove('hidden');
        }
    }

    async function processNextSegment(forceNext = false) {
        if (lessonState === 'narrating' && !forceNext) return;

        // Clear any existing timeouts
        clearTimeout(window.videoErrorTimeout);

        // Reset lesson state
        lessonState = 'idle';

        learningPipeline.speechEngine.stop();
        if (!ui.video.paused) ui.video.pause();

        // Remove any existing YouTube iframes
        const existingIframe = ui.learningCanvasContainer.querySelector('.youtube-iframe');
        if (existingIframe) {
            existingIframe.remove();
        }

        currentSegmentIndex++;
        const learningPoints = currentLessonPlan[currentLearningPath];

        if (currentSegmentIndex >= learningPoints.length) {
            await endLessonWithQuiz();
            return;
        }

        const learningPoint = learningPoints[currentSegmentIndex];
        const previousPoint = currentSegmentIndex > 0 ? learningPoints[currentSegmentIndex - 1] : null;

        updateSegmentProgress();
        ui.currentTopicDisplay.textContent = learningPoint;
        ui.nextSegmentButton.disabled = true;

        try {
            await learningPipeline.processSegment(learningPoint, previousPoint, currentLearningPath);
            retryCount = 0;
        } catch (error) {
            console.error("Error processing segment:", error);

            if (retryCount < MAX_RETRIES) {
                retryCount++;
                displayErrorOnCanvas(`Loading segment... (${retryCount}/${MAX_RETRIES})`, "Please wait...");
                setTimeout(() => processNextSegment(forceNext), 2000);
            } else {
                displayErrorOnCanvas("Continuing to next segment...", "Some content may be unavailable");
                setTimeout(() => processNextSegment(true), 3000);
            }
        }
    }

    async function endLessonWithQuiz() {
        lessonState = 'idle';
        updateCanvasVisuals("🎓 Lesson Complete!", "Preparing your personalized quiz...");

        try {
            const quiz = await learningPipeline.generateFinalQuiz(currentLearningPath);
            if (quiz && quiz.questions && quiz.questions.length > 0) {
                displayQuiz(quiz);
            } else {
                showLessonComplete();
            }
        } catch (error) {
            console.error('Quiz generation failed:', error);
            showLessonComplete();
        }
    }

    function displayQuiz(quiz) {
        // Create quiz UI dynamically
        const quizContainer = document.createElement('div');
        quizContainer.className = 'p-8 bg-gray-800/50 rounded-xl mx-4 my-4';
        quizContainer.innerHTML = `
            <h2 class="text-2xl font-bold mb-6 text-center">Knowledge Check</h2>
            <div id="quiz-questions"></div>
            <button id="submit-quiz" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl mt-6">
                Submit Quiz
            </button>
        `;

        const questionsContainer = quizContainer.querySelector('#quiz-questions');

        quiz.questions.forEach((q, qIndex) => {
            const questionDiv = document.createElement('div');
            questionDiv.className = 'mb-6 p-4 bg-gray-700/30 rounded-lg';
            questionDiv.innerHTML = `
                <p class="text-lg font-semibold mb-3">${qIndex + 1}. ${q.question}</p>
                ${q.options.map((option, oIndex) => `
                    <label class="block mb-2 cursor-pointer hover:bg-gray-600/30 p-2 rounded">
                        <input type="radio" name="question${qIndex}" value="${oIndex}" class="mr-2">
                        ${option}
                    </label>
                `).join('')}
            `;
            questionsContainer.appendChild(questionDiv);
        });

        // Clear canvas and add quiz
        ui.canvas.style.display = 'none';
        ui.learningCanvasContainer.appendChild(quizContainer);

        // Handle quiz submission
        quizContainer.querySelector('#submit-quiz').addEventListener('click', async () => {
            await handleQuizSubmission(quiz, quizContainer);
        });
    }

    async function handleQuizSubmission(quiz, quizContainer) {
        const formData = new FormData();
        let allAnswered = true;

        // Collect answers
        quiz.questions.forEach((q, qIndex) => {
            const selected = quizContainer.querySelector(`input[name="question${qIndex}"]:checked`);
            if (selected) {
                learningPipeline.quizEngine.submitAnswer(qIndex, parseInt(selected.value));
            } else {
                allAnswered = false;
            }
        });

        if (!allAnswered) {
            displayError("Please answer all questions before submitting.");
            return;
        }

        // Generate and display feedback
        try {
            const feedback = await learningPipeline.quizEngine.generateFeedback(
                currentLearningPath,
                learningPipeline.completedSegments
            );
            displayQuizResults(learningPipeline.quizEngine.score, quiz.questions.length, feedback, quizContainer);
        } catch (error) {
            console.error('Feedback generation failed:', error);
            displayQuizResults(learningPipeline.quizEngine.score, quiz.questions.length, "Great job completing the lesson!", quizContainer);
        }
    }

    function displayQuizResults(score, total, feedback, quizContainer) {
        const percentage = Math.round((score / total) * 100);
        quizContainer.innerHTML = `
            <div class="text-center">
                <h2 class="text-3xl font-bold mb-4">Quiz Results</h2>
                <div class="text-6xl font-bold mb-4 ${percentage >= 70 ? 'text-green-400' : 'text-yellow-400'}">
                    ${score}/${total}
                </div>
                <div class="text-xl mb-6">${percentage}% Correct</div>
                <div class="bg-gray-700/30 p-4 rounded-lg mb-6">
                    <p class="text-lg">${feedback}</p>
                </div>
                <button onclick="resetToInput()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl">
                    Start New Lesson
                </button>
            </div>
        `;
    }

    function showLessonComplete() {
        updateCanvasVisuals(
            "🎓 Lesson Complete!",
            "Congratulations! Press Escape to start a new lesson."
        );
        ui.nextSegmentButton.disabled = true;
    }

    // --- UTILITY FUNCTIONS --- //
    function updateSegmentProgress() {
        const total = currentLessonPlan[currentLearningPath].length;
        const current = currentSegmentIndex + 1;
        const progressPercent = (current / total) * 100;

        if (ui.segmentProgress) {
            ui.segmentProgress.style.width = `${progressPercent}%`;
            const progressText = document.getElementById('segment-progress-text');
            if (progressText) {
                progressText.textContent = `${current}/${total}`;
            }
        }
    }

    function showLoading(message) {
        ui.inputSection.classList.add('hidden');
        ui.loadingMessage.textContent = message;
        ui.loadingIndicator.classList.remove('hidden');
    }

    function updateLoadingMessage(message) {
        ui.loadingMessage.textContent = message;
    }

    function hideLoading() {
        ui.loadingIndicator.classList.add('hidden');
    }

    function resetUI() {
        ui.errorDisplay.classList.add('hidden');
        ui.levelSelection.classList.add('hidden');
        ui.learningCanvasContainer.classList.add('hidden');
        currentLessonPlan = null;
        currentLearningPath = null;
        currentSegmentIndex = -1;
        lessonState = 'idle';
        retryCount = 0;
        if (typeof window.speechSynthesis !== 'undefined') {
            window.speechSynthesis.cancel();
        }
    }

    function resetToInput() {
        resetUI();
        ui.inputSection.classList.remove('hidden');
        ui.curateButton.disabled = false;
        ui.canvas.style.display = 'block';
        ui.canvas.style.opacity = '1';
        ui.video.style.opacity = '0';
        ui.video.style.pointerEvents = 'none';
        ui.video.src = '';

        // Remove any quiz containers
        const quizContainers = ui.learningCanvasContainer.querySelectorAll('.bg-gray-800\\/50');
        quizContainers.forEach(container => container.remove());
    }
    window.resetToInput = resetToInput;

    function displayError(message) {
        ui.errorMessage.textContent = message;
        ui.errorDisplay.classList.remove('hidden');
        setTimeout(() => ui.errorDisplay.classList.add('hidden'), 5000);
    }

    function updateCanvasVisuals(mainText, subText = '') {
        ui.canvas.width = ui.canvas.clientWidth;
        ui.canvas.height = ui.canvas.clientHeight;

        const gradient = canvasCtx.createLinearGradient(0, 0, ui.canvas.width, ui.canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

        canvasCtx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        canvasCtx.beginPath();
        canvasCtx.arc(ui.canvas.width * 0.8, ui.canvas.height * 0.2, 100, 0, Math.PI * 2);
        canvasCtx.fill();

        canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'middle';

        const maxWidth = ui.canvas.width * 0.85;
        let fontSize = Math.max(20, Math.min(ui.canvas.width / 25, 32));
        canvasCtx.font = `bold ${fontSize}px Inter, sans-serif`;

        const lines = wrapText(mainText, maxWidth);

        let startY = ui.canvas.height / 2 - ((lines.length - 1) * (fontSize + 8)) / 2;

        if (isScrolling) {
            // This is a simplified scrolling implementation.
            // A more advanced version would tie this to the utterance's 'boundary' event.
            const scrollDuration = lines.length * 1000; // 1 second per line
            const startTime = Date.now();

            function scroll() {
                const elapsedTime = Date.now() - startTime;
                const scrollPercent = Math.min(elapsedTime / scrollDuration, 1);

                const scrollY = startY - (scrollPercent * (lines.length * (fontSize + 8) - ui.canvas.height / 2));

                // Redraw canvas
                canvasCtx.fillStyle = gradient;
                canvasCtx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
                canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                canvasCtx.textAlign = 'center';
                canvasCtx.textBaseline = 'middle';
                canvasCtx.font = `bold ${fontSize}px Inter, sans-serif`;

                lines.forEach((line, index) => {
                    canvasCtx.fillText(line, ui.canvas.width / 2, scrollY + (index * (fontSize + 8)));
                });

                if (scrollPercent < 1) {
                    requestAnimationFrame(scroll);
                }
            }
            requestAnimationFrame(scroll);

        } else {
             lines.forEach((line, index) => {
                canvasCtx.fillText(line, ui.canvas.width / 2, startY + (index * (fontSize + 8)));
            });
        }

        if (subText) {
            let subFontSize = Math.max(14, Math.min(ui.canvas.width / 40, 18));
            canvasCtx.font = `${subFontSize}px Inter, sans-serif`;
            canvasCtx.fillStyle = 'rgba(200, 200, 200, 0.8)';
            wrapText(subText, ui.canvas.width / 2, ui.canvas.height / 2 + 50, maxWidth, subFontSize + 6);
        }
    }

    function showLoadingMessageOnCanvas(message) {
        updateCanvasVisuals('Loading...', message);
    }

    function displayErrorOnCanvas(title, message) {
        updateCanvasVisuals(`⚠️ ${title}`, message);
    }

    function playPauseLesson() {
        if (lessonState === 'narrating') {
            learningPipeline.speechEngine.pause();
            lessonState = 'narration_paused';
        } else if (lessonState === 'narration_paused') {
            learningPipeline.speechEngine.resume();
            lessonState = 'narrating';
        } else if (lessonState === 'playing_video') {
            if (learningPipeline.youtubePlayer && typeof learningPipeline.youtubePlayer.pauseVideo === 'function') {
                learningPipeline.youtubePlayer.pauseVideo();
            }
            lessonState = 'paused';
        } else if (lessonState === 'paused') {
            if (learningPipeline.youtubePlayer && typeof learningPipeline.youtubePlayer.playVideo === 'function') {
                learningPipeline.youtubePlayer.playVideo();
            }
            lessonState = 'playing_video';
        }
        updatePlayPauseIcon();
    }

    function updatePlayPauseIcon() {
        const isPlaying = lessonState === 'playing_video' || lessonState === 'narrating';
        ui.playIcon.classList.toggle('hidden', isPlaying);
        ui.pauseIcon.classList.toggle('hidden', !isPlaying);
    }

    // SCROLLING TELEPROMPTER Function
    function updateTeleprompter(fullText, charIndex) {
        ui.canvas.width = ui.canvas.clientWidth;
        ui.canvas.height = ui.canvas.clientHeight;

        // Background gradient
        const gradient = canvasCtx.createLinearGradient(0, 0, ui.canvas.width, ui.canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

        // Responsive font sizing
        const maxWidth = ui.canvas.width * 0.9;
        let fontSize = Math.max(16, Math.min(ui.canvas.width / 20, 28));
        if (ui.canvas.width < 600) { // Mobile devices
            fontSize = Math.max(18, Math.min(ui.canvas.width / 18, 24));
        }

        canvasCtx.font = `${fontSize}px Inter, sans-serif`;
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'middle';

        const lineHeight = fontSize + 12;
        const centerX = ui.canvas.width / 2;
        const centerY = ui.canvas.height / 2;

        // Split text into words and create lines that fit within maxWidth
        const words = fullText.split(' ');
        const lines = [];
        let currentLine = '';
        let currentCharCount = 0;
        const lineCharCounts = [];

        for (let word of words) {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const testWidth = canvasCtx.measureText(testLine).width;

            if (testWidth > maxWidth && currentLine.length > 0) {
                lines.push(currentLine);
                lineCharCounts.push(currentCharCount);
                currentLine = word;
                currentCharCount += word.length + 1; // +1 for space
            } else {
                currentLine = testLine;
                if (currentLine !== word) currentCharCount += 1; // space
                currentCharCount += word.length;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
            lineCharCounts.push(currentCharCount);
        }

        // Find which line contains the current character
        let currentLineIndex = 0;
        let charsSoFar = 0;

        for (let i = 0; i < lineCharCounts.length; i++) {
            if (charIndex <= charsSoFar + lines[i].length + (i > 0 ? 1 : 0)) {
                currentLineIndex = i                break;
            }
            charsSoFar += lines[i].length + 1; // +1 for space between lines
        }

        // Calculate scroll offset to keep current line in view
        const totalLines = lines.length;
        const visibleLines = Math.floor(ui.canvas.height / lineHeight) - 1; // Leave space for progress
        const maxScroll = Math.max(0, totalLines - visibleLines);

        // Smooth scrolling: keep current line in the middle third of screen
        let scrollOffset = 0;
        if (totalLines > visibleLines) {
            const targetScroll = Math.max(0, currentLineIndex - Math.floor(visibleLines / 3));
            scrollOffset = Math.min(targetScroll, maxScroll);
        }

        // Calculate starting Y position
        const startY = centerY - (visibleLines * lineHeight / 2) + (scrollOffset * lineHeight);

        // Draw visible lines with proper coloring
        let lineCharOffset = 0;

        for (let i = 0; i < lines.length; i++) {
            const lineY = startY + (i - scrollOffset) * lineHeight;

            // Only draw lines that are visible on screen
            if (lineY > -lineHeight && lineY < ui.canvas.height + lineHeight) {
                const line = lines[i];
                const lineStartChar = lineCharOffset;
                const lineEndChar = lineCharOffset + line.length;

                // Determine line coloring based on progress
                let lineColor;
                if (charIndex > lineEndChar) {
                    // Entire line has been read
                    lineColor = 'rgba(34, 197, 94, 0.7)'; // Green (read)
                } else if (charIndex >= lineStartChar && charIndex <= lineEndChar) {
                    // Currently reading this line - make it prominent
                    lineColor = 'rgba(255, 255, 255, 1)'; // White (current)

                    // Add subtle highlight background for current line
                    canvasCtx.fillStyle = 'rgba(59, 130, 246, 0.1)';
                    canvasCtx.fillRect(0, lineY - lineHeight/2, ui.canvas.width, lineHeight);
                } else {
                    // Line hasn't been read yet
                    lineColor = 'rgba(255, 255, 255, 0.5)'; // Dim white (upcoming)
                }

                canvasCtx.fillStyle = lineColor;
                canvasCtx.fillText(line, centerX, lineY);
            }

            lineCharOffset += line.length + 1; // +1 for space
        }

        // Add progress bar at bottom
        const progress = Math.min((charIndex / fullText.length) * 100, 100);
        const progressBarWidth = ui.canvas.width * 0.8;
        const progressBarHeight = 4;
        const progressBarX = (ui.canvas.width - progressBarWidth) / 2;
        const progressBarY = ui.canvas.height - 40;

        // Progress bar background
        canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        canvasCtx.fillRect(progressBarX, progressBarY, progressBarWidth, progressBarHeight);

        // Progress bar fill
        canvasCtx.fillStyle = 'rgba(34, 197, 94, 0.8)';
        canvasCtx.fillRect(progressBarX, progressBarY, (progressBarWidth * progress) / 100, progressBarHeight);

        // Progress text
        canvasCtx.fillStyle = 'rgba(200, 200, 200, 0.9)';
        canvasCtx.font = `${Math.max(12, fontSize * 0.6)}px Inter, sans-serif`;
        canvasCtx.fillText(`🎤 ${Math.round(progress)}% • Reading aloud...`, centerX, progressBarY + 20);
    }



    function wrapText(text, maxWidth) {
        const words = text.split(' ');
        let line = '';
        let lines = [];
        const canvasCtx = ui.canvas.getContext('2d'); // get context

        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n] + ' ';
            let metrics = canvasCtx.measureText(testLine);
            let testWidth = metrics.width;

            if (testWidth > maxWidth && n > 0) {
                lines.push(line.trim());
                line = words[n] + ' ';
            } else {
                line = testLine;
            }
        }
        lines.push(line.trim());
        return lines;
    }

    // --- STORAGE UTILITIES --- //
    const Storage = {
        save: (key, data) => {
            try {
                localStorage.setItem(key, JSON.stringify(data));
            } catch (e) {
                console.warn('Failed to save to localStorage:', e);
            }
        },
        load: (key) => {
            try {
                const data = localStorage.getItem(key);
                return data ? JSON.parse(data) : null;
            } catch (e) {
                console.warn('Failed to load from localStorage:', e);
                return null;
            }
        },
        remove: (key) => {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.warn('Failed to remove from localStorage:', e);
            }
        }
    };

    // --- ANALYTICS & TRACKING --- //
    const Analytics = {
        trackEvent: (event, data = {}) => {
            console.log('Analytics:', event, data);
            // In production, send to analytics service
        },
        trackError: (error, context = {}) => {
            console.error('Error tracked:', error, context);
            // In production, send to error tracking service
        }
    };

    // --- UI EVENT HANDLERS --- //
    // Initialize the application
    function initializeUI() {
        ui.curateButton.addEventListener('click', handleCurateClick);
        ui.topicInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleCurateClick();
        });
        ui.topicInput.addEventListener('input', validateInput);
        ui.playPauseButton.addEventListener('click', playPauseLesson);
        ui.nextSegmentButton.addEventListener('click', () => processNextSegment(true));

        ui.videoVolume.addEventListener('input', (e) => ui.video.volume = parseFloat(e.target.value));
        ui.narrationVolume.addEventListener('input', (e) => { 
            Storage.save('narrationVolume', e.target.value);
        });
        ui.video.addEventListener('timeupdate', updateProgressBar);
        ui.video.addEventListener('ended', handleVideoEnd);
        ui.video.addEventListener('error', (e) => handleVideoError(e));

        document.addEventListener('keydown', handleKeyboardShortcuts);
        loadPreviousSession();

         // Load saved settings
         const savedVideoVolume = Storage.load('videoVolume');
         const savedNarrationVolume = Storage.load('narrationVolume');
         if (savedVideoVolume !== null) ui.videoVolume.value = savedVideoVolume;
         if (savedNarrationVolume !== null) ui.narrationVolume.value = savedNarrationVolume;

         // Initialize skip video button (avoid duplicate listeners)
         if (ui.skipVideoButton && !ui.skipVideoButton.hasAttribute('data-initialized')) {
             ui.skipVideoButton.setAttribute('data-initialized', 'true');
             ui.skipVideoButton.addEventListener('click', () => {
                 console.log('Skip video button clicked');
                 handleVideoEnd(); // Skip to next segment immediately
             });
         }
    }

    // --- INITIALIZE APPLICATION --- //
    initializeUI();

    // YouTube API ready callback
    window.onYouTubeIframeAPIReady = function() {
        console.log("YouTube Iframe API is ready.");
    };

    // Handle voice loading - only log once
    let voicesLoaded = false;
    try {
        if (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = () => {
                if (!voicesLoaded) {
                    console.log("Speech synthesis voices loaded.");
                    voicesLoaded = true;
                }
            };
        }
    } catch (error) {
        console.warn('Could not set up voice loading callback:', error);
    }

    // Performance monitoring
    const startTime = performance.now();
    window.addEventListener('load', () => {
        const loadTime = performance.now() - startTime;
        Analytics.trackEvent('app_loaded', { loadTime });
    });
});