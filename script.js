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
    //const YOUTUBE_API_KEY = "AIzaSyBQLgFiUYdSNvpbyO_TgdzXmSvT9BFgal4";
    //const YOUTUBE_API_KEY = "AIzaSyA43RRVypjAAXwYdpKrojWVmdRAGyLKwr8";
    const YOUTUBE_API_KEY = "AIzaSyDbxmMIxsnVWW16iHrVrq1kNe9KTTSpNH4";
    const CSE_ID = 'b53121b78d1c64563'; 
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
            const cacheKey = `lessonPlan:${topic}`;
            const cachedPlan = Storage.getCache(cacheKey);
            if (cachedPlan) {
                console.log("Returning CACHED lesson plan.");
                return cachedPlan;
            }

            this.currentTopic = topic;
            showLoading("Generating comprehensive lesson plan...");
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

            try {
                const response = await this.makeRequest(prompt);
                const lessonPlan = this.parseJSONResponse(response);
                if (lessonPlan) {
                    Storage.setCache(cacheKey, lessonPlan); // Save the new plan to the cache
                    console.log("Lesson plan generated and stored.");
                    return lessonPlan;
                } else {
                    throw new Error("Failed to parse lesson plan from response.");
                }
            } catch (error) {
                console.error("Error generating lesson plan:", error);
                // Fallback to creating a simple plan structure if error occurs
                return this.createFallbackLessonPlan(topic);
            }
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
            const prompt = `Generate 5 optimized Youtube queries for finding educational videos about: "${learningPoint}" within the topic of "${topic}".

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
            const prompt = `Analyze this YouTube video to find all relevant segments that teach about: "${learningPoint}".

        Video Title: "${videoTitle}"
        Video Description: "${videoDescription.substring(0, 800)}"

        Rules for segments:
        1. Find all distinct, relevant parts of the video.
        2. Each individual segment must be between 5 and 15 seconds long.
        3. The TOTAL duration of all segments combined must be between 15 and 45 seconds.
        4. Avoid generic intros/outros. Find where the actual teaching happens.
        5. If no segments fit the rules, return an empty array.

        Return ONLY a valid JSON array of objects, like this:
        [
          {"startTime": 120, "endTime": 135, "reason": "Explains the core definition."},
          {"startTime": 310, "endTime": 320, "reason": "Provides a practical example."}
        ]`;

            const response = await this.makeRequest(prompt, { temperature: 0.2, maxOutputTokens: 512 });
            // Ensure the response is an array, or fallback to an empty array.
            const segments = this.parseJSONResponse(response);
            return Array.isArray(segments) ? segments : [];
        }

        parseJSONResponse(response) {
            try {
                // First try to parse the entire response as JSON
                try {
                    return JSON.parse(response);
                } catch (e) {
                    // Continue to extract JSON from text
                }

                // Clean up the response text
                let cleanedResponse = response.trim();

                // Remove markdown code blocks if present
                cleanedResponse = cleanedResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '');

                // Try to find JSON object or array in the response with multiple patterns
                const patterns = [
                    /\{[\s\S]*?\}/g,  // Match JSON objects
                    /\[[\s\S]*?\]/g,  // Match JSON arrays
                    /{\s*"[^"]+"\s*:\s*[^}]+}/g,  // Simple object pattern
                    /{\s*"startTime"\s*:\s*\d+[\s\S]*?"endTime"\s*:\s*\d+[\s\S]*?}/g  // Specific startTime/endTime pattern
                ];

                for (const pattern of patterns) {
                    const matches = cleanedResponse.match(pattern);
                    if (matches) {
                        for (const match of matches) {
                            try {
                                const parsed = JSON.parse(match);
                                // Validate that we have the expected structure
                                if (parsed && typeof parsed === 'object') {
                                    return parsed;
                                }
                            } catch (e) {
                                continue;
                            }
                        }
                    }
                }

                // Last resort: try to extract numbers for startTime and endTime
                const startTimeMatch = cleanedResponse.match(/["']?startTime["']?\s*:\s*(\d+)/i);
                const endTimeMatch = cleanedResponse.match(/["']?endTime["']?\s*:\s*(\d+)/i);

                if (startTimeMatch && endTimeMatch) {
                    return {
                        startTime: parseInt(startTimeMatch[1]),
                        endTime: parseInt(endTimeMatch[1]),
                        reason: "Extracted from text pattern"
                    };
                }

                console.error('No valid JSON found in response:', response);
                return null;
            } catch (error) {
                console.error('Error in parseJSONResponse:', error);
                return null;
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
            const cacheKey = `video:${topic}:${learningPoint}:${level}`;
            const cachedVideo = Storage.getCache(cacheKey);
            if (cachedVideo) {
                console.log("Returning CACHED video info.");
                return cachedVideo;
            }

            try {
                // Generate optimized search queries using Gemini
                const searchQueries = await this.gemini.generateSearchQueries(learningPoint, topic);

                for (const query of searchQueries) {
                    try {
                        const video = await this.searchYouTube(query);
                        if (video) {
                            const isRelevant = await this.validateVideoRelevance(video, learningPoint, topic);
                            if (isRelevant) {
                                const segments = await this.gemini.findVideoSegment(video.title, video.description, learningPoint);
                                video.segments = segments;
                                Storage.setCache(cacheKey, video); // Save the found video to the cache
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
            console.log(`Searching via Custom Search API for: "${query}"`);

            const searchParams = new URLSearchParams({
                key: YOUTUBE_API_KEY,
                cx: CSE_ID,
                q: query,
                num: 10 // Request 10 results
            });

            const response = await fetch(`https://www.googleapis.com/customsearch/v1?${searchParams}`);

            if (!response.ok) {
                throw new Error(`Custom Search API failed: ${response.status}`);
            }

            const data = await response.json();
            const items = data.items || [];

            // Transform the CSE items to look like the old YouTube Data API items.
            // This allows the rest of the system to work without changes.
            const transformedItems = items.map(item => {
                try {
                    // Ensure the link is a valid YouTube video URL and extract the video ID.
                    if (!item.link || !item.link.includes('youtube.com/watch?v=')) {
                        return null;
                    }
                    const url = new URL(item.link);
                    const videoId = url.searchParams.get('v');
                    if (!videoId) return null;

                    return {
                        id: { videoId: videoId },
                        snippet: {
                            title: item.title,
                            description: item.snippet,
                            thumbnails: {
                                default: {
                                    url: item.pagemap?.cse_thumbnail?.[0]?.src || ''
                                }
                            }
                        }
                    };
                } catch (e) {
                    console.warn("Could not parse CSE item:", item, e);
                    return null;
                }
            }).filter(Boolean); // Filter out any null items that couldn't be parsed.

            return transformedItems;
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
    // This new SpeechEngine uses the reliable Google Cloud TTS API.
    class SpeechEngine {
        constructor() {
            // NOTE: This API key is visible in the client-side code.
            // Ensure you have quotas and restrictions set up in your Google Cloud Console.
            this.apiKey = 'AIzaSyA43RRVypjAAXwYdpKrojWVmdRAGyLKwr8';
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

            console.log('Requesting speech synthesis from Google Cloud API...');

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
                    const errorData = await response.json();
                    throw new Error(`API Error: ${errorData.error.message}`);
                }

                const data = await response.json();
                const audioBlob = this.base64ToBlob(data.audioContent, 'audio/mpeg');

                this.audioElement.src = URL.createObjectURL(audioBlob);
                this.audioElement.play();

                this.audioElement.ontimeupdate = () => {
                    if (this.onProgressCallback && this.audioElement.duration) {
                        const progress = this.audioElement.currentTime / this.audioElement.duration;
                        this.onProgressCallback(progress);
                    }
                };

                this.audioElement.onended = () => {
                    console.log("Narration finished.");
                    if (this.onProgressCallback) this.onProgressCallback(1); // Ensure it ends at 100%
                    if (this.onCompleteCallback) this.onCompleteCallback();
                };

            } catch (error) {
                console.error('SpeechService Error:', error);
                // If speech fails, ensure the lesson can continue by calling the onComplete callback.
                if (this.onCompleteCallback) this.onCompleteCallback();
            }
        }

        pause() {
            if (this.audioElement) this.audioElement.pause();
        }

        resume() {
            if (this.audioElement) this.audioElement.play();
        }

        stop() {
            if (this.audioElement) {
                this.audioElement.onended = null;
                this.audioElement.ontimeupdate = null;
                this.audioElement.pause();
                if (this.audioElement.src) {
                    this.audioElement.currentTime = 0;
                }
            }
        }

        base64ToBlob(base64, contentType = '', sliceSize = 512) {
            const byteCharacters = atob(base64);
            const byteArrays = [];
            for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
                const slice = byteCharacters.slice(offset, offset + 512);
                const byteNumbers = new Array(slice.length);
                for (let i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                byteArrays.push(byteArray);
            }
            return new Blob(byteArrays, { type: contentType });
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
            this.speechEngine.stop(); // Ensure any prior speech is stopped
            lessonState = 'narrating';
            updatePlayPauseIcon();
            if (ui.skipVideoButton) ui.skipVideoButton.style.display = 'none';

            // Define the callbacks that the SpeechEngine will use
            const onProgress = (progress) => {
                updateTeleprompter(narrationText, progress);
            };

            const onComplete = () => {
                if (lessonState === 'narrating') {
                    this.playVideoContent(videoInfo);
                }
            };

            // This single call starts the entire narration process.
            await this.speechEngine.play(narrationText, { onProgress, onComplete });
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
            } else {
                this.createYouTubePlayer(videoInfo);
            }
        }

        createYouTubePlayer(videoInfo) {
            if (this.youtubePlayer) {
                this.youtubePlayer.destroy();
            }
            const playerContainer = document.getElementById('youtube-player-container');
            if (playerContainer) playerContainer.innerHTML = '';

            let segmentQueue = videoInfo.segments || [];
            if (segmentQueue.length === 0) {
                segmentQueue.push({ startTime: 0, endTime: 30, reason: "Fallback segment" });
            }

            let currentSegmentIdx = 0;

            const playSegment = (segment) => {
                console.log(`Playing segment ${currentSegmentIdx + 1}/${segmentQueue.length}: ${segment.startTime}s to ${segment.endTime}s`);

                if (this.youtubePlayer) {
                    this.youtubePlayer.destroy();
                }

                this.youtubePlayer = new YT.Player('youtube-player-container', {
                    height: '100%',
                    width: '100%',
                    videoId: videoInfo.youtubeId,
                    playerVars: {
                        autoplay: 1,
                        controls: 1,
                        rel: 0,
                        start: segment.startTime,
                        end: segment.endTime,
                        modestbranding: 1,
                        // --- ADD THIS LINE ---
                        origin: window.location.origin
                    },
                    events: {
                        'onStateChange': (event) => {
                            if (event.data === YT.PlayerState.ENDED) {
                                currentSegmentIdx++;
                                if (currentSegmentIdx < segmentQueue.length) {
                                    playSegment(segmentQueue[currentSegmentIdx]);
                                } else {
                                    console.log('Finished all video segments.');
                                    handleVideoEnd();
                                }
                            }
                        },
                        'onError': (error) => {
                            console.error('YouTube Player Error:', error);
                            handleVideoError(new Error('YouTube Player failed'));
                        }
                    }
                });
            };

            ui.canvas.style.opacity = '0.3';
            playSegment(segmentQueue[currentSegmentIdx]);
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

        updateCanvasVisuals("Segment Complete! 🎉", "Great job! Click 'Next Segment' to continue.");
        ui.nextSegmentButton.disabled = false; // Ensure the button is enabled
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

        ui.nextSegmentButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Next Segment button clicked');
            if (!ui.nextSegmentButton.disabled) {
                processNextSegment(true);
            }
        });

        ui.nextSegmentButton.style.cursor = 'pointer';

        // The 'input' event for these volume sliders is fine.
        ui.videoVolume.addEventListener('input', (e) => {
            if (learningPipeline.youtubePlayer && typeof learningPipeline.youtubePlayer.setVolume === 'function') {
                learningPipeline.youtubePlayer.setVolume(parseFloat(e.target.value) * 100);
            }
        });
        ui.narrationVolume.addEventListener('input', (e) => {
            learningPipeline.speechEngine.audioElement.volume = parseFloat(e.target.value);
        });

        // --- REMOVE THESE THREE LINES ---
        // ui.video.addEventListener('timeupdate', updateProgressBar);
        // ui.video.addEventListener('ended', handleVideoEnd);
        // ui.video.addEventListener('error', (e) => handleVideoError(e));
        // ---------------------------------

        document.addEventListener('keydown', handleKeyboardShortcuts);
        loadPreviousSession();

        // Load saved settings
        const savedVideoVolume = Storage.load('videoVolume');
        const savedNarrationVolume = Storage.load('narrationVolume');
        if (savedVideoVolume !== null) ui.videoVolume.value = savedVideoVolume;
        if (savedNarrationVolume !== null) ui.narrationVolume.value = savedNarrationVolume;

        // Initialize skip video button
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

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                playPauseLesson();
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
        ui.nextSegmentButton.disabled = true; // Disable until segment is ready

        learningPipeline.speechEngine.stop();
        if (!ui.video.paused) ui.video.pause();

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
            const subLines = wrapText(subText, maxWidth);
            subLines.forEach((line, index) => {
                canvasCtx.fillText(line, ui.canvas.width / 2, startY + (lines.length * (fontSize + 8)) + (index * (subFontSize + 6)));
            });
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
            if (learningPipeline.youtubePlayer) learningPipeline.youtubePlayer.pauseVideo();
            lessonState = 'paused';
        } else if (lessonState === 'paused') {
            if (learningPipeline.youtubePlayer) learningPipeline.youtubePlayer.playVideo();
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
    function updateTeleprompter(fullText, progress) {
        if (!ui.canvas) return;
        ui.canvas.width = ui.canvas.clientWidth;
        ui.canvas.height = ui.canvas.clientHeight;
        const canvasCtx = ui.canvas.getContext('2d');

        // Background
        const gradient = canvasCtx.createLinearGradient(0, 0, ui.canvas.width, ui.canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

        // Text properties
        const maxWidth = ui.canvas.width * 0.9;
        const fontSize = Math.max(20, Math.min(ui.canvas.width / 25, 28));
        const lineHeight = fontSize + 12;
        canvasCtx.font = `${fontSize}px Inter, sans-serif`;
        canvasCtx.textAlign = 'center';
        canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';

        // Calculate scrolling based on audio progress
        const lines = wrapText(fullText, maxWidth);
        const totalContentHeight = (lines.length - 1) * lineHeight;
        const totalScrollDistance = totalContentHeight > (ui.canvas.height / 2) ? totalContentHeight - (ui.canvas.height / 2) : 0;

        const yOffset = (ui.canvas.height / 2) - (totalScrollDistance * progress);

        // Draw the text
        canvasCtx.save();
        canvasCtx.translate(ui.canvas.width / 2, yOffset);
        lines.forEach((line, index) => {
            canvasCtx.fillText(line, 0, index * lineHeight);
        });
        canvasCtx.restore();
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
            try { localStorage.setItem(key, JSON.stringify(data)); }
            catch (e) { console.warn('Failed to save to localStorage:', e); }
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
        getCache: (key) => {
            try {
                const itemStr = localStorage.getItem(key);
                if (!itemStr) return null;
                const item = JSON.parse(itemStr);
                const now = new Date();
                // Invalidate cache after 24 hours
                if (now.getTime() > item.expiry) {
                    localStorage.removeItem(key);
                    return null;
                }
                return item.value;
            } catch (e) {
                console.warn('Failed to get from cache:', e);
                return null;
            }
        },
        setCache: (key, value, ttl = 86400000) => { // ttl = 24 hours in ms
            try {
                const now = new Date();
                const item = {
                    value: value,
                    expiry: now.getTime() + ttl,
                };
                localStorage.setItem(key, JSON.stringify(item));
            } catch (e) {
                console.warn('Failed to save to cache:', e);
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