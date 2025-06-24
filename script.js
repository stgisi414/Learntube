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
    const SUPADATA_API_KEY = "sd_8f84f1ec20cd0065c05f36acf8efc4a4";

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
            log("GEMINI (V5 Architecture): Generating culturally-aware lesson plan for:", topic);

            // Analyze cultural context first
            const context = this.analyzeCulturalContext(topic);
            log(`GEMINI (V5): Detected context - Culture: ${context.primaryCulture}, Domain: ${context.domain}, Level: ${context.specificityLevel}`);

            const brainstormCulturalKeywords = async (topicForBrainstorm, culturalContext) => {
                log("GEMINI (V5): Step 1 - Brainstorming culturally-specific keywords for:", topicForBrainstorm);
                
                const prompt = `You are an expert curriculum designer specializing in culturally-accurate educational content.

TOPIC ANALYSIS TASK:
Topic: "${topicForBrainstorm}"
Cultural Context: ${culturalContext.primaryCulture || 'General'}
Subject Domain: ${culturalContext.domain}
Required Specificity: ${culturalContext.specificityLevel}

KEYWORD EXTRACTION REQUIREMENTS:
1. PRIMARY CULTURAL TERMS: Extract authentic native language terms and concepts
2. SPECIFIC SUBJECT VOCABULARY: Domain-specific terminology and concepts
3. CULTURAL EXAMPLES: Real-world applications and cultural manifestations
4. LEARNING PROGRESSION: Terms suitable for different learning levels
5. AVOID GENERIC TERMS: Do not include broad, non-specific concepts

${culturalContext.primaryCulture ? `
CULTURAL FOCUS REQUIREMENTS for ${culturalContext.primaryCulture}:
- Include native language terminology
- Reference authentic cultural practices and examples
- Avoid westernized or generic interpretations
- Include cultural context that gives meaning to the concepts
` : ''}

OUTPUT FORMAT:
Return a comma-separated list of 8-12 highly specific keywords that will enable creation of authentic, culturally-accurate learning content.

Example for "Korean onomatopoeia":
의성어 (uiseongeo), 의태어 (uitaeeo), Korean sound symbolism, webtoon sound effects, K-drama expressions, Korean phonetic aesthetics, mimetic words in Korean, Korean comic book sounds, traditional Korean sound words, modern Korean slang sounds

Topic: "${topicForBrainstorm}"
Keywords:`;

                try {
                    const response = await this.makeRequest(prompt, { temperature: 0.3 });
                    if (typeof response === 'string' && response.length > 10) {
                        const keywords = response.split(',').map(k => k.trim()).filter(k => k.length > 0);
                        log("GEMINI (V5): Brainstormed culturally-specific keywords:", keywords);
                        return keywords;
                    }
                    throw new Error("Brainstorming returned invalid keyword format.");
                } catch (error) {
                    logError("GEMINI (V5): Cultural keyword brainstorming failed. Using fallback.", error);
                    return topicForBrainstorm.split(' ').concat(context.nativeTerms || []); 
                }
            };

            const createCulturallyAwarePlan = (topic, keywords, culturalContext) => {
                log("GEMINI (V5): Step 2 - Building culturally-aware lesson plan from keywords.");
                
                const usedKeywords = new Set();
                const pickKeyword = () => {
                    const available = keywords.filter(k => 
                        !usedKeywords.has(k) && 
                        k.toLowerCase() !== topic.toLowerCase() &&
                        k.length > 2
                    );
                    if (available.length === 0) {
                        return keywords[Math.floor(Math.random() * keywords.length)] || 'advanced concepts';
                    }
                    const keyword = available[0]; 
                    usedKeywords.add(keyword);
                    return keyword;
                };

                // Create culturally-specific learning points
                const culturePrefix = culturalContext.primaryCulture ? `${culturalContext.primaryCulture.charAt(0).toUpperCase() + culturalContext.primaryCulture.slice(1)} ` : '';
                
                const apprenticePoints = [
                    `Introduction to ${culturePrefix}${topic}: Understanding the Core Concepts`,
                    `Exploring fundamental aspects: ${pickKeyword()}`,
                    `Basic examples and applications of ${topic} in ${culturalContext.primaryCulture || 'practical'} contexts`
                ];

                const journeymanPoints = [
                    ...apprenticePoints,
                    `Deeper understanding: The role of ${pickKeyword()} in ${topic}`,
                    `Cultural significance and variations: ${pickKeyword()}`,
                    `Comparing traditional and modern expressions of ${topic}`
                ];

                const seniorPoints = [
                    ...journeymanPoints,
                    `Historical development and cultural evolution of ${topic}`,
                    `Advanced analysis: How ${pickKeyword()} shapes understanding`,
                    `Cross-cultural perspectives and influences on ${topic}`
                ];

                const masterPoints = [
                    ...seniorPoints,
                    `Expert synthesis: The intersection of ${topic} and ${pickKeyword()}`,
                    `Creative applications and contemporary innovations in ${topic}`,
                    `Teaching and preserving ${culturePrefix}${topic} for future generations`
                ];

                const lessonPlan = { 
                    "Apprentice": apprenticePoints, 
                    "Journeyman": journeymanPoints, 
                    "Senior": seniorPoints, 
                    "Master": masterPoints 
                };
                
                log("GEMINI (V5): Culturally-aware lesson plan created successfully.");
                return lessonPlan;
            };

            try {
                const culturalKeywords = await brainstormCulturalKeywords(topic, context);
                const finalLessonPlan = createCulturallyAwarePlan(topic, culturalKeywords, context);
                
                // Validate cultural specificity in lesson plan
                if (context.primaryCulture) {
                    const hasSpecificity = this.validateLessonPlanCulturalSpecificity(finalLessonPlan, context);
                    if (!hasSpecificity) {
                        log("GEMINI (V5): Warning - Lesson plan lacks cultural specificity, regenerating...");
                        // Add fallback cultural terms
                        culturalKeywords.push(...(context.nativeTerms || []));
                        return createCulturallyAwarePlan(topic, culturalKeywords, context);
                    }
                }
                
                return finalLessonPlan;
            } catch (error) {
                logError("generateLessonPlan (V5) failed. Returning null.", error);
                return null;
            }
        }

        validateLessonPlanCulturalSpecificity(lessonPlan, context) {
            if (!context.primaryCulture) return true;
            
            const allPoints = Object.values(lessonPlan).flat().join(' ').toLowerCase();
            const requiredTerms = [context.primaryCulture];
            if (context.nativeTerms) requiredTerms.push(...context.nativeTerms);
            
            return requiredTerms.some(term => allPoints.includes(term.toLowerCase()));
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
            
            // Dynamic cultural and linguistic context extraction
            const contextAnalysis = this.analyzeCulturalContext(mainTopic + ' ' + learningPoint);
            
            const prompt = `You are a specialized educational search query generator. Create 4-6 highly specific YouTube search queries for: "${learningPoint}" within the context of: "${mainTopic}".

CONTEXT ANALYSIS:
- Primary Language/Culture: ${contextAnalysis.primaryCulture || 'General'}
- Subject Domain: ${contextAnalysis.domain}
- Specificity Level: ${contextAnalysis.specificityLevel}
- Educational Focus: ${contextAnalysis.educationalFocus}

DYNAMIC QUERY GENERATION RULES:
1. If cultural/linguistic context detected: ALL queries MUST include the specific culture/language terms
2. Include educational keywords: "tutorial", "lesson", "learn", "how to", "explained"
3. Avoid generic content that could match unrelated domains
4. Use native language terms when culturally appropriate
5. Target beginner-friendly educational content

FORBIDDEN PATTERNS (dynamic based on context):
${contextAnalysis.forbiddenPatterns.length > 0 ? `- Avoid: ${contextAnalysis.forbiddenPatterns.join(', ')}` : '- No specific forbidden patterns detected'}

EXAMPLE FORMAT:
If topic is "Korean onomatopoeia":
✓ "Korean onomatopoeia 의성어 tutorial for beginners"
✓ "Learn Korean sound words 의성어 explained"
✗ "onomatopoeia sound design" (too generic)

Return ONLY a valid JSON array of 4-6 specific search query strings.`;

            const response = await this.makeRequest(prompt, { temperature: 0.2 });
            const queries = this.parseJSONResponse(response);
            
            // Validate queries for cultural specificity
            if (queries && contextAnalysis.primaryCulture) {
                const validatedQueries = queries.filter(query => 
                    this.validateCulturalSpecificity(query, contextAnalysis)
                );
                if (validatedQueries.length > 0) {
                    log(`SEARCH: Validated ${validatedQueries.length}/${queries.length} culturally specific queries`);
                    return validatedQueries;
                }
            }
            
            return queries || [];
        }

        analyzeCulturalContext(text) {
            const textLower = text.toLowerCase();
            
            // Dynamic language/culture detection
            const cultures = {
                korean: { patterns: ['korean', '한국', 'hangul', '의성어', '의태어'], native: ['의성어', '의태어'] },
                japanese: { patterns: ['japanese', '日本', 'hiragana', 'katakana', 'onomatopoeia'], native: ['擬音語', '擬態語'] },
                chinese: { patterns: ['chinese', '中文', 'mandarin', 'cantonese'], native: ['象声词'] },
                spanish: { patterns: ['spanish', 'español', 'castellano'], native: ['onomatopeya'] },
                french: { patterns: ['french', 'français'], native: ['onomatopée'] },
                german: { patterns: ['german', 'deutsch'], native: ['lautmalerei'] },
                arabic: { patterns: ['arabic', 'عربي'], native: ['محاكاة الأصوات'] }
            };

            // Subject domain detection
            const domains = {
                linguistics: ['onomatopoeia', 'phonetics', 'language', 'sound symbolism', 'linguistics'],
                music: ['music', 'sound design', 'audio', 'production'],
                history: ['history', 'historical', 'ancient', 'medieval'],
                science: ['physics', 'chemistry', 'biology', 'quantum'],
                art: ['art', 'painting', 'sculpture', 'renaissance']
            };

            let primaryCulture = null;
            let detectedDomain = 'general';
            
            // Find primary culture
            for (const [culture, data] of Object.entries(cultures)) {
                if (data.patterns.some(pattern => textLower.includes(pattern))) {
                    primaryCulture = culture;
                    break;
                }
            }

            // Find domain
            for (const [domain, keywords] of Object.entries(domains)) {
                if (keywords.some(keyword => textLower.includes(keyword))) {
                    detectedDomain = domain;
                    break;
                }
            }

            // Generate forbidden patterns dynamically
            const forbiddenPatterns = this.generateForbiddenPatterns(detectedDomain, primaryCulture);

            return {
                primaryCulture,
                domain: detectedDomain,
                specificityLevel: primaryCulture ? 'high' : 'medium',
                educationalFocus: this.determineEducationalFocus(text),
                forbiddenPatterns,
                nativeTerms: primaryCulture ? cultures[primaryCulture].native : []
            };
        }

        generateForbiddenPatterns(domain, culture) {
            const forbiddenMap = {
                linguistics: ['music production', 'sound design', 'audio engineering', 'daw', 'mixing'],
                music: ['language learning', 'linguistics'],
                history: ['modern politics', 'current events'],
                science: ['pseudoscience', 'conspiracy']
            };

            const generalForbidden = ['compilation', 'reaction', 'meme', 'funny', 'compilation'];
            return [...(forbiddenMap[domain] || []), ...generalForbidden];
        }

        determineEducationalFocus(text) {
            if (text.includes('beginner') || text.includes('basic') || text.includes('introduction')) return 'beginner';
            if (text.includes('advanced') || text.includes('expert') || text.includes('master')) return 'advanced';
            return 'intermediate';
        }

        validateCulturalSpecificity(query, context) {
            if (!context.primaryCulture) return true; // No specific culture requirement
            
            const queryLower = query.toLowerCase();
            const culturePatterns = {
                korean: ['korean', '한국', '의성어', '의태어'],
                japanese: ['japanese', '日本', '擬音語', '擬態語'],
                chinese: ['chinese', '中文', '象声词'],
                spanish: ['spanish', 'español', 'onomatopeya'],
                french: ['french', 'français', 'onomatopée'],
                german: ['german', 'deutsch', 'lautmalerei'],
                arabic: ['arabic', 'عربي', 'محاكاة الأصوات']
            };

            const requiredPatterns = culturePatterns[context.primaryCulture] || [];
            return requiredPatterns.some(pattern => queryLower.includes(pattern));
        }

        async checkVideoRelevance(videoTitle, learningPoint, mainTopic, transcript = null) {
            log(`RELEVANCE V5: Analyzing "${videoTitle}" for "${learningPoint}"`);
            
            // Use dynamic cultural context analysis
            const context = this.analyzeCulturalContext(mainTopic + ' ' + learningPoint);
            const titleLower = videoTitle.toLowerCase();
            const transcriptLower = transcript ? transcript.toLowerCase() : '';

            // Pre-filtering with dynamic forbidden patterns
            if (context.forbiddenPatterns.some(term => titleLower.includes(term) || transcriptLower.includes(term))) {
                log(`RELEVANCE V5 REJECT (PRE-FILTER): Contains forbidden pattern from ${context.domain} domain`);
                return { relevant: false, reason: 'forbidden_pattern' };
            }

            // Cultural specificity validation
            if (context.primaryCulture) {
                const hasRequiredCulture = this.validateCulturalSpecificity(videoTitle + ' ' + (transcript || ''), context);
                if (!hasRequiredCulture) {
                    log(`RELEVANCE V5 REJECT (PRE-FILTER): Missing required ${context.primaryCulture} cultural context`);
                    return { relevant: false, reason: 'missing_cultural_context' };
                }
            }

            // Enhanced AI analysis with cultural context
            const prompt = `You are an expert Educational Content Validator specializing in cultural and linguistic accuracy.

VIDEO ANALYSIS TASK:
- Video Title: "${videoTitle}"
- Learning Objective: "${learningPoint}"
- Main Topic Context: "${mainTopic}"
${transcript ? `- Transcript Sample: "${transcript.substring(0, 2000)}"` : '- (No transcript available)'}

CULTURAL CONTEXT REQUIREMENTS:
- Primary Culture/Language: ${context.primaryCulture || 'General'}
- Subject Domain: ${context.domain}
- Educational Level: ${context.educationalFocus}
- Required Specificity: ${context.specificityLevel}

VALIDATION CRITERIA:
1. CULTURAL ACCURACY: ${context.primaryCulture ? `Must genuinely focus on ${context.primaryCulture} culture/language, not just mention it` : 'No specific cultural requirements'}
2. EDUCATIONAL VALUE: Must be instructional, not entertainment or compilation
3. DOMAIN RELEVANCE: Must be about ${context.domain}, not tangentially related topics
4. CONTENT QUALITY: Must provide substantive learning content

STRICT REJECTION TRIGGERS:
- Generic content that doesn't address the specific cultural/linguistic context
- Entertainment/reaction videos disguised as educational content
- Content from wrong subject domains (e.g., music production for linguistics topics)
- Videos that only briefly mention the topic without deep coverage

Return JSON with this exact structure:
{
  "isRelevant": boolean,
  "confidenceScore": number (1-10),
  "culturalAccuracy": number (1-10),
  "educationalValue": number (1-10),
  "reasoning": "detailed explanation",
  "identifiedCulturalFocus": "detected culture/language or 'general'",
  "contentType": "educational/entertainment/mixed/unclear"
}`;

            try {
                const aiResult = await this.makeRequest(prompt, { temperature: 0.1 }).then(this.parseJSONResponse);
                
                if (!aiResult) {
                    log(`RELEVANCE V5 REJECT: AI analysis failed`);
                    return { relevant: false, reason: 'ai_analysis_failed' };
                }

                // Multi-criteria validation
                const isRelevant = aiResult.isRelevant && 
                                 aiResult.confidenceScore >= 7 && 
                                 aiResult.culturalAccuracy >= 8 && 
                                 aiResult.educationalValue >= 7 &&
                                 aiResult.contentType === 'educational';

                // Additional cultural focus validation
                if (context.primaryCulture && aiResult.identifiedCulturalFocus) {
                    const culturalMatch = aiResult.identifiedCulturalFocus.toLowerCase().includes(context.primaryCulture) ||
                                        aiResult.identifiedCulturalFocus === context.primaryCulture;
                    if (!culturalMatch) {
                        log(`RELEVANCE V5 REJECT: Cultural focus mismatch - expected ${context.primaryCulture}, found ${aiResult.identifiedCulturalFocus}`);
                        return { relevant: false, reason: 'cultural_mismatch' };
                    }
                }

                if (isRelevant) {
                    log(`RELEVANCE V5 ACCEPT: "${videoTitle}" (confidence: ${aiResult.confidenceScore}, cultural: ${aiResult.culturalAccuracy})`);
                    return { 
                        relevant: true, 
                        confidence: aiResult.confidenceScore,
                        culturalAccuracy: aiResult.culturalAccuracy,
                        educationalValue: aiResult.educationalValue
                    };
                } else {
                    log(`RELEVANCE V5 REJECT: Low scores - confidence: ${aiResult.confidenceScore}, cultural: ${aiResult.culturalAccuracy}, educational: ${aiResult.educationalValue}`);
                    return { relevant: false, reason: 'low_quality_scores', details: aiResult };
                }

            } catch (error) {
                logError(`RELEVANCE V5: Analysis error:`, error);
                return { relevant: false, reason: 'analysis_error' };
            }
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
            log(`TRANSCRIPT: Fetching transcript for video: ${youtubeId}`);

            // First, verify that the API key constant exists and is not a placeholder.
            if (!SUPADATA_API_KEY || SUPADATA_API_KEY === "YOUR_SUPADATA_API_KEY") {
                logError(`TRANSCRIPT: Supadata API key is missing or is still a placeholder.`);
                return null;
            }

            try {
                const apiUrl = `https://api.supadata.ai/v1/youtube/video?id=${youtubeId}`;

                // --- CORRECTED PART ---
                // Using the 'x-api-key' header as specified by the Supadata documentation
                const response = await fetch(apiUrl, { 
                    method: 'GET',
                    headers: { 
                        'x-api-key': SUPADATA_API_KEY,
                        'Content-Type': 'application/json'
                    } 
                });
                // --- END OF CORRECTION ---

                if (!response.ok) { 
                    const errorBody = await response.text();
                    logError(`TRANSCRIPT: API request failed for ${youtubeId}. Status: ${response.status}. Response: ${errorBody}`);
                    return null; 
                }

                const data = await response.json();
                if (data && Array.isArray(data.transcript)) {
                    log(`TRANSCRIPT: Successfully fetched transcript for ${youtubeId}`);
                    return data.transcript.map(item => item.text || '').join(' ');
                }
                return null;

            } catch (error) {
                logError(`TRANSCRIPT: A network or other unexpected error occurred during fetch for ${youtubeId}:`, error);
                return null;
            }
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
                if (lessonState === 'narrating') {
                    ui.nextSegmentButton.disabled = false;
                    onComplete();
                }
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

        handleVideoError() { 
            logError('Video error, creating fallback.');
            this.createFallbackContent(currentLessonPlan[currentLearningPath][currentSegmentIndex]);
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
            ui.youtubePlayerContainer.innerHTML = `<div class="p-6 md:p-8 text-white h-full flex flex-col justify-center"><div class="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6 border border-white/20"><p class="text-xl lg:text-2xl">${quiz.question}</p></div><div class="space-y-4 mb-6">${quiz.options.map((option, index) => `<button class="quiz-option w-full text-left p-4 bg-blue-600 hover:bg-blue-700 rounded-xl" data-index="${index}"><span>${String.fromCharCode(65 + index)})</span> ${option}</button>`).join('')}</div><div id="quiz-result" class="hidden opacity-0 duration-500"><div id="quiz-explanation-container" class="border rounded-xl p-4 mb-4"><p id="quiz-explanation"></p></div><div class="text-center"><button id="continue-button" class="bg-green-600 hover:bg-green-700 px-8 py-3 rounded-xl">Continue →</button></div></div></div>`;
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