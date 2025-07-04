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
    const SUPADATA_API_KEY = "sd_1d4e0e4e3d5aecda115fc39d1d47a33b";

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
            
            // Extract language/cultural context with enhanced detection
            const extractCulturalContext = (topicText) => {
                const text = topicText.toLowerCase();
                
                // Enhanced language detection with variations
                const languagePatterns = {
                    korean: /\b(korean|korea|hangul|한국|k-pop|kimchi|seoul)\b/gi,
                    japanese: /\b(japanese|japan|nihongo|日本|hiragana|katakana|kanji|tokyo|anime|manga)\b/gi,
                    chinese: /\b(chinese|china|mandarin|cantonese|中文|汉语|普通话|beijing|shanghai)\b/gi,
                    spanish: /\b(spanish|spain|español|castellano|madrid|mexico|latin america)\b/gi,
                    french: /\b(french|france|français|francais|paris|quebec)\b/gi,
                    german: /\b(german|germany|deutsch|berlin|austria|swiss)\b/gi,
                    italian: /\b(italian|italy|italiano|rome|milan)\b/gi,
                    portuguese: /\b(portuguese|portugal|português|brazil|brasil|rio)\b/gi,
                    russian: /\b(russian|russia|русский|moscow|soviet)\b/gi,
                    arabic: /\b(arabic|arab|العربية|middle east|egypt|saudi)\b/gi,
                    hindi: /\b(hindi|india|हिंदी|bollywood|delhi|mumbai)\b/gi
                };
                
                // Cultural/linguistic terms
                const culturalTerms = /\b(onomatopoeia|onomatopoeic|sound words|phonetic|linguistic|language|dialect|accent|pronunciation|grammar|syntax|vocabulary|idiom|phrase|expression|cultural|traditional|folk|native|indigenous)\b/gi;
                
                const detectedLanguages = [];
                const detectedCultures = [];
                
                // Check for language matches
                for (const [lang, pattern] of Object.entries(languagePatterns)) {
                    if (pattern.test(text)) {
                        detectedLanguages.push(lang);
                    }
                }
                
                // Check for cultural/linguistic terms
                const culturalMatches = text.match(culturalTerms);
                if (culturalMatches) {
                    detectedCultures.push(...culturalMatches);
                }
                
                return {
                    languages: [...new Set(detectedLanguages)],
                    culturalTerms: [...new Set(culturalMatches || [])],
                    hasSpecificLanguage: detectedLanguages.length > 0,
                    hasCulturalContext: culturalMatches && culturalMatches.length > 0
                };
            };
            
            const context = extractCulturalContext(topic);
            const requiresStrictCulturalMaintenance = context.hasSpecificLanguage || context.hasCulturalContext;
            
            let prompt = `You are an expert curriculum designer. Create a learning plan for the EXACT topic: "${topic}".

CORE PRINCIPLES:
1.  TOPIC FIDELITY: Every learning point MUST directly relate to "${topic}". Do NOT generalize or use broader categories. The phrase "${topic}" must be present in each point.
2.  PROGRESSIVE LEARNING: Structure the plan from basic to advanced across difficulty levels.
3.  CULTURAL AUTHENTICITY: If the topic has specific cultural or linguistic elements (details below), ensure learning points reflect this authentically.

${requiresStrictCulturalMaintenance ? `
🚨 CRITICAL CULTURAL/LINGUISTIC CONTEXT DETECTED 🚨
- Detected Languages: ${context.languages.join(', ') || 'None'}
- Detected Cultural Keywords: ${context.culturalTerms.join(', ') || 'None'}

CULTURALLY ENRICHED LEARNING POINTS REQUIRED:
- Each learning point must not only include "${topic}" but also incorporate specific examples, facets, or contexts relevant to ${context.languages.join(' and/or ')} culture/language related to "${topic}".
- For example, if the topic is "Korean onomatopoeia", points should be like "Exploring Korean onomatopoeia in K-Dramas" or "Comparing animal sound onomatopoeia in Korean vs. English".
- Avoid generic points like "Basic concepts of ${topic}" if a cultural context is active. Instead, frame it as "Basic concepts of ${topic} within the ${context.languages[0]} cultural context".
- If no specific language is detected but cultural terms are, ensure points reflect those terms. For example, if topic is "Linguistic relativity", points should be about "Linguistic relativity and its impact on thought" not just "Understanding Linguistic relativity".
- Generic points that only append the topic string are NOT acceptable if a cultural context is identified.
FORBIDDEN:
- Do NOT substitute "${topic}" with general terms (e.g., "sound words" for "Korean onomatopoeia").
` : `
STANDARD LEARNING POINTS:
- Focus on educational aspects of "${topic}".
`}

DIFFICULTY LEVELS & POINT COUNT:
- Apprentice: 3 learning points
- Journeyman: 5 learning points
- Senior: 7 learning points
- Master: 9 learning points

OUTPUT FORMAT: Return ONLY valid JSON.
Example structure:
{
  "Apprentice": ["Point 1 about ${topic}", "Point 2 about ${topic}", ...],
  "Journeyman": ["More advanced Point 1 about ${topic}", ...],
  "Senior": [...],
  "Master": [...]
}
${requiresStrictCulturalMaintenance && context.languages.length > 0 ? `
Example for a topic like "Korean Onomatopoeia":
{
  "Apprentice": [
    "Introduction to Korean Onomatopoeia in daily Korean life",
    "Basic categories of Korean Onomatopoeia (e.g., sounds, movements)",
    "Common examples of Korean Onomatopoeia used in simple Korean conversations"
  ], ...
}` : `
Example for a topic like "Photosynthesis":
{
  "Apprentice": [
    "What is Photosynthesis?",
    "Key components involved in Photosynthesis (sunlight, water, CO2)",
    "Why Photosynthesis is important for plants"
  ], ...
}`}

Ensure every learning point is distinct and directly contributes to understanding "${topic}" with the specified cultural context if applicable.`;

            const response = await this.makeRequest(prompt, { temperature: 0.35 }); // Slightly increased temp for richer points
            let parsedPlan = this.parseJSONResponse(response);

            // Validation and potential retry
            if (parsedPlan && requiresStrictCulturalMaintenance) {
                const allPoints = Object.values(parsedPlan).flat();
                let failedValidation = false;

                for (const point of allPoints) {
                    const pointLower = point.toLowerCase();
                    if (!pointLower.includes(topic.toLowerCase())) {
                        log(`LESSON PLAN VALIDATION FAIL (Topic): Point "${point}" missing base topic "${topic}"`);
                        failedValidation = true;
                        break;
                    }
                    // MVP Heuristic: Check if language or specific cultural term is present
                    if (context.languages.length > 0 && !context.languages.some(lang => pointLower.includes(lang.toLowerCase()))) {
                         // Check if the point is too generic by also checking for general cultural terms
                        if (!context.culturalTerms.some(term => pointLower.includes(term.toLowerCase()))) {
                            log(`LESSON PLAN VALIDATION FAIL (Language): Point "${point}" for topic "${topic}" lacks specific language enrichment for ${context.languages.join('/')}.`);
                            failedValidation = true;
                            break;
                        }
                    }
                }
                
                if (failedValidation) {
                    log(`LESSON PLAN VALIDATION: Strict cultural maintenance failed. Regenerating with a more direct retry prompt.`);
                    const retryPrompt = `RETRY - Previous lesson plan for "${topic}" failed cultural specificity or topic fidelity.

MUST-FOLLOW RULES:
1.  The EXACT phrase "${topic}" MUST be in every learning point.
2.  If cultural/linguistic context was specified (Languages: ${context.languages.join(', ') || 'N/A'}, Cultural Terms: ${context.culturalTerms.join(', ') || 'N/A'}), learning points MUST integrate this.
    For "Korean onomatopoeia", points MUST be about KOREAN onomatopoeia in specific KOREAN contexts (e.g., "Korean onomatopoeia in webtoons"), not just "What is Korean onomatopoeia".
3.  DO NOT generalize.
4.  Output valid JSON for 4 levels: Apprentice (3), Journeyman (5), Senior (7), Master (9).

Topic: "${topic}"
Strive for culturally rich and specific learning points.`;
                    const retryResponse = await this.makeRequest(retryPrompt, { temperature: 0.2 }); // Lower temp for stricter retry
                    parsedPlan = this.parseJSONResponse(retryResponse);
                }
            }
            
            return parsedPlan;
        }

        async generateSearchQueries(learningPoint) {
            log(`GEMINI: Generating search queries for "${learningPoint}"`);
            const mainTopic = currentLessonPlan?.topic || learningPoint;

            // Re-use extractCulturalContext logic (or make it a shared utility)
            // For now, defining it locally for clarity during refactor
            const extractCulturalContextForQuery = (topicText) => {
                const text = topicText.toLowerCase();
                const languagePatterns = {
                    korean: /\b(korean|korea|hangul|한국)\b/gi,
                    japanese: /\b(japanese|japan|nihongo|日本)\b/gi,
                    chinese: /\b(chinese|china|mandarin|中文)\b/gi,
                    spanish: /\b(spanish|español)\b/gi,
                    french: /\b(french|français)\b/gi,
                };
                const detectedLanguages = [];
                for (const [lang, pattern] of Object.entries(languagePatterns)) {
                    if (pattern.test(text)) detectedLanguages.push(lang);
                }
                return {
                    languages: [...new Set(detectedLanguages)],
                    hasSpecificLanguage: detectedLanguages.length > 0,
                };
            };
            
            // Get forbidden terms based on main topic + learning point
            const getForbiddenTermsForQuery = (topic) => {
                const keywords = { languages: [], subjects: [], forbidden: [] };
                const langMatches = topic.match(/\b(korean|japanese|chinese|spanish|french)\b/gi);
                if (langMatches) keywords.languages = [...new Set(langMatches.map(l => l.toLowerCase()))];
                const subjectMatches = topic.match(/\b(onomatopoeia|language|linguistics)\b/gi);
                if (subjectMatches) keywords.subjects = [...new Set(subjectMatches.map(s => s.toLowerCase()))];

                if (keywords.languages.includes('korean') && keywords.subjects.includes('onomatopoeia')) {
                    keywords.forbidden = ['music production', 'sound design', 'audio editing', 'daw', 'fl studio', 'ableton', 'logic pro'];
                }
                // Add more rules as needed for other contexts
                return keywords.forbidden;
            };

            const culturalContext = extractCulturalContextForQuery(mainTopic);
            const forbiddenTerms = getForbiddenTermsForQuery(mainTopic + " " + learningPoint);

            let requiredTermsStr = `"${learningPoint}"`;
            if (culturalContext.hasSpecificLanguage) {
                requiredTermsStr += ` ${culturalContext.languages.join(' ')}`;
            }

            let prompt = `Generate 3-5 YouTube search queries for a video about: "${learningPoint}".
The overall lesson topic is: "${mainTopic}".

CRITICAL INSTRUCTIONS FOR QUERIES:
1.  SPECIFICITY: Queries MUST be highly specific to "${learningPoint}". If "${mainTopic}" includes a language (e.g., Korean, Japanese), ensure the queries reflect this. For example, for "Korean onomatopoeia", queries should be like "learn Korean onomatopoeia", "Korean onomatopoeia examples".
2.  CONTENT TYPE: Target educational content, tutorials, lessons, explanations, or "how-to" guides.
3.  LENGTH: Each query should be 3-7 words.
4.  KEYWORDS: Queries MUST include core terms from "${learningPoint}" and relevant cultural/linguistic terms from "${mainTopic}" if applicable (e.g., ${culturalContext.languages.join(', ') || 'specific cultural terms'}).
5.  AVOID GENERIC: Do not generate overly broad queries.

${forbiddenTerms.length > 0 ? `
NEGATIVE KEYWORDS: Queries should actively AVOID terms related to: "${forbiddenTerms.join('", "')}".
Focus strictly on the educational and cultural aspects, not these unrelated domains.
Example: If learning "Korean onomatopoeia", AVOID queries like "sound design tutorial" or "music production software".
` : ''}

Examples of GOOD queries for "Learning Korean Vowel Sounds":
- "Korean vowel pronunciation guide"
- "learn basic Korean vowels"
- "how to pronounce Korean vowels for beginners"

Main Topic: "${mainTopic}"
Current Learning Point: "${learningPoint}"
${culturalContext.hasSpecificLanguage ? `Language Context: ${culturalContext.languages.join(', ')}` : ''}

Return ONLY a valid JSON array of 3-5 unique query strings.`;

            const response = await this.makeRequest(prompt, { temperature: 0.25 });
            return this.parseJSONResponse(response);
        }

        async checkVideoRelevance(videoTitle, learningPoint, mainTopic, transcript = null) {
            log(`RELEVANCE CHECKER V2: Analyzing "${videoTitle}" for learningPoint "${learningPoint}" (mainTopic: "${mainTopic}")`);

            // Step 1: Enhanced Keyword Extraction
            const extractTopicKeywords = (topicString) => {
                const keywords = {
                    requiredLangs: [], // e.g., "korean" from "Korean onomatopoeia"
                    requiredSubjects: [], // e.g., "onomatopoeia"
                    optionalSubjects: [], // general related terms like "language", "linguistics"
                    forbiddenDomains: [], // e.g., "music production"
                    fullTopicPhrase: topicString
                };
                const topicLower = topicString.toLowerCase();

                // Detect specific languages mentioned in the topic itself
                if (/\b(korean|korea|hangul|한국)\b/gi.test(topicLower)) keywords.requiredLangs.push("korean");
                if (/\b(japanese|japan|nihongo|日本)\b/gi.test(topicLower)) keywords.requiredLangs.push("japanese");
                if (/\b(chinese|china|mandarin|中文)\b/gi.test(topicLower)) keywords.requiredLangs.push("chinese");
                // Add other languages as needed

                // Detect core subject
                if (/\b(onomatopoeia|sound words)\b/gi.test(topicLower)) keywords.requiredSubjects.push("onomatopoeia");
                if (/\b(calligraphy)\b/gi.test(topicLower)) keywords.requiredSubjects.push("calligraphy");
                if (/\b(verb conjugation)\b/gi.test(topicLower)) keywords.requiredSubjects.push("verb conjugation");
                 // Add other core subjects

                // Optional related terms
                if (/\b(language|linguistic|grammar|vocabulary|phonetic)\b/gi.test(topicLower)) {
                    keywords.optionalSubjects.push("language", "linguistics");
                }

                // Define forbidden domains based on context
                if (keywords.requiredLangs.includes("korean") && keywords.requiredSubjects.includes("onomatopoeia")) {
                    keywords.forbiddenDomains = ['music production', 'audio editing', 'sound design', 'daw', 'ableton', 'logic pro', 'fl studio', 'sound effects library', 'sfx pack', 'game audio'];
                }
                if (keywords.requiredSubjects.includes("calligraphy")) {
                    keywords.forbiddenDomains = ['graphic design software', 'digital art tutorial', 'photoshop', 'illustrator'];
                }

                keywords.requiredLangs = [...new Set(keywords.requiredLangs)];
                keywords.requiredSubjects = [...new Set(keywords.requiredSubjects)];
                keywords.optionalSubjects = [...new Set(keywords.optionalSubjects)];

                log("Extracted keywords for relevance:", keywords);
                return keywords;
            };

            const extractedKeywords = extractTopicKeywords(mainTopic + " " + learningPoint); // Combine for broader context

            // --- Stage 1: Strict Pre-filtering (Code-based) ---
            const titleLower = videoTitle.toLowerCase();
            let preFilterRejectReason = null;

            // Check for forbidden domain terms in title
            if (extractedKeywords.forbiddenDomains.length > 0) {
                for (const forbidden of extractedKeywords.forbiddenDomains) {
                    if (titleLower.includes(forbidden)) {
                        preFilterRejectReason = `Title contains forbidden domain term: "${forbidden}"`;
                        break;
                    }
                }
            }

            // Check for required language if specified in topic
            if (!preFilterRejectReason && extractedKeywords.requiredLangs.length > 0) {
                if (!extractedKeywords.requiredLangs.some(lang => titleLower.includes(lang))) {
                    preFilterRejectReason = `Title does not explicitly mention required language(s): "${extractedKeywords.requiredLangs.join(', ')}"`;
                }
            }

            // Check for required subject if specified
            if (!preFilterRejectReason && extractedKeywords.requiredSubjects.length > 0) {
                if (!extractedKeywords.requiredSubjects.some(subj => titleLower.includes(subj))) {
                     // Allow if at least one optional subject is present (e.g. "Korean language lesson" for "Korean onomatopoeia")
                    if (!extractedKeywords.optionalSubjects.some(optSubj => titleLower.includes(optSubj))) {
                        preFilterRejectReason = `Title missing required subject: "${extractedKeywords.requiredSubjects.join(', ')}" and no strong optional subject.`;
                    }
                }
            }

            if (preFilterRejectReason) {
                log(`RELEVANCE PRE-FILTER REJECT: "${videoTitle}" for topic "${mainTopic}". Reason: ${preFilterRejectReason}`);
                return { relevant: false, reason: `Pre-filter: ${preFilterRejectReason}`, confidence: 0 };
            }
            log(`RELEVANCE PRE-FILTER PASS: "${videoTitle}" for topic "${mainTopic}"`);

            // --- Stage 2: AI-Assisted Relevance Check (Gemini) ---
            let prompt = `You are a Strict Educational Content Validator.
Your task is to determine if the YouTube video titled "${videoTitle}" is DIRECTLY and SPECIFICALLY relevant for a user learning about "${learningPoint}", which is part of the main lesson topic "${mainTopic}".

Video Title: "${videoTitle}"
Learning Point: "${learningPoint}"
Main Lesson Topic: "${mainTopic}"

Contextual Keywords & Rules:
- Required Language(s) in Topic: ${extractedKeywords.requiredLangs.join(', ') || "None specified"}
- Required Subject(s) in Topic: ${extractedKeywords.requiredSubjects.join(', ') || "None specified"}
- Related Subject Keywords: ${extractedKeywords.optionalSubjects.join(', ') || "None"}
- FORBIDDEN DOMAINS/TERMS (video must NOT be about these): ${extractedKeywords.forbiddenDomains.join(', ') || "None"}

${transcript ? `
Video Transcript Snippet (first 1500 chars):
"${transcript.substring(0, 1500).replace(/"/g, "'")}"
` : `(No transcript provided for analysis - rely on title and keywords more heavily)`}

CRITICAL EVALUATION CRITERIA:
1.  DIRECT RELEVANCE: Does the video *directly teach or explain* "${learningPoint}"?
2.  TOPIC ALIGNMENT: Is it clearly aligned with "${mainTopic}"?
3.  CULTURAL/LINGUISTIC ACCURACY:
    - If "Required Language(s)" are specified, does the video content demonstrably focus on that language/culture in relation to the subject?
    - A video about "onomatopoeia in general" is NOT relevant if the topic is "Korean onomatopoeia". It MUST be about KOREAN onomatopoeia.
4.  EDUCATIONAL NATURE: Is the video educational (lesson, tutorial, explanation)? It should NOT be purely entertainment, music, a software demo unrelated to learning the core topic, or a vlog.
5.  FORBIDDEN DOMAINS: Does the video fall into any of the FORBIDDEN DOMAINS/TERMS listed above? If yes, it's an automatic REJECT.

Based on your analysis, provide a JSON response with the following structure:
{
  "isRelevant": boolean, // True if it meets ALL criteria, false otherwise
  "confidenceScore": number, // From 0 (not relevant) to 10 (perfectly relevant)
  "reasoning": "Detailed explanation for your decision, referencing specific criteria and keywords.",
  "identifiedLanguageFocus": "e.g., korean, english, japanese, general, none_clear" // What language context does the video seem to have?
}

Decision Guidance:
- If "Required Language(s)" are specified (e.g., Korean), and the video is about the subject (e.g., onomatopoeia) but in a *different* language (e.g., English onomatopoeia) or is generic, it is NOT relevant.
- If the video title or transcript mentions terms from FORBIDDEN DOMAINS, it is NOT relevant.
- Be very strict. Prefer to reject if uncertain.
`;
            try {
                const response = await this.makeRequest(prompt, { temperature: 0.05 }); // Low temperature for rule-following
                const aiResult = this.parseJSONResponse(response);

                if (!aiResult || typeof aiResult.isRelevant !== 'boolean' || typeof aiResult.confidenceScore !== 'number') {
                    logError('RELEVANCE CHECKER V2: AI response malformed or incomplete.', aiResult);
                    return { relevant: false, reason: "AI analysis failed to produce valid structured output.", confidence: 0 };
                }

                log(`RELEVANCE CHECKER V2 AI RESULT for "${videoTitle}": Relevant: ${aiResult.isRelevant}, Confidence: ${aiResult.confidenceScore}, Reason: ${aiResult.reasoning}, LangFocus: ${aiResult.identifiedLanguageFocus}`);

                // --- Stage 3: Final Decision Logic ---
                if (!aiResult.isRelevant) {
                    return { relevant: false, reason: `AI Rejection: ${aiResult.reasoning}`, confidence: aiResult.confidenceScore };
                }
                if (aiResult.confidenceScore < 7) { // Stricter threshold
                    return { relevant: false, reason: `AI Confidence Low (${aiResult.confidenceScore}/10): ${aiResult.reasoning}`, confidence: aiResult.confidenceScore };
                }

                // If specific language context is required, verify AI's language identification
                if (extractedKeywords.requiredLangs.length > 0) {
                    const primaryRequiredLang = extractedKeywords.requiredLangs[0];
                    if (!aiResult.identifiedLanguageFocus || !aiResult.identifiedLanguageFocus.toLowerCase().includes(primaryRequiredLang)) {
                         // Allow if AI says 'general' but title strongly implies the language (e.g. "Learn Korean...")
                        const titleHasLang = extractedKeywords.requiredLangs.some(lang => titleLower.includes(lang));
                        if (!(aiResult.identifiedLanguageFocus === 'general' && titleHasLang)) {
                            return { relevant: false, reason: `Language Mismatch: Topic requires ${primaryRequiredLang}, AI identified video focus as ${aiResult.identifiedLanguageFocus}.`, confidence: aiResult.confidenceScore };
                        }
                    }
                }

                log(`RELEVANCE CHECKER V2 FINAL ACCEPT: "${videoTitle}" (Confidence: ${aiResult.confidenceScore})`);
                return { relevant: true, reason: aiResult.reasoning, confidence: aiResult.confidenceScore };

            } catch (error) {
                logError('RELEVANCE CHECKER V2: AI analysis failed with error:', error);
                return { relevant: false, reason: "AI analysis threw an exception.", confidence: 0 };
            }
        }

        async generateNarration(learningPoint, previousPoint) {
            log(`GEMINI: Generating narration for "${learningPoint}"`);
            const mainTopic = currentLessonPlan?.topic || learningPoint;

            // Detect languages for mixed-language content generation
            const isKorean = /korean|hangul|한국|onomatopoeia.*korean/i.test(mainTopic + ' ' + learningPoint);
            const isJapanese = /japanese|nihongo|日本|hiragana|katakana|kanji/i.test(mainTopic + ' ' + learningPoint);
            const isChinese = /chinese|mandarin|cantonese|中文|汉语|普通话/i.test(mainTopic + ' ' + learningPoint);
            const isSpanish = /spanish|español|castellano|español/i.test(mainTopic + ' ' + learningPoint);
            const isFrench = /french|français|francais/i.test(mainTopic + ' ' + learningPoint);

            let languageInstruction = '';
            if (isKorean) {
                languageInstruction = '\n\nMULTILINGUAL CONTENT: Create mixed-language narration. Use KOREAN text for Korean words/concepts (한국어). Use ENGLISH for explanations. Mark language boundaries with [LANG:ko] and [LANG:en] tags. Example: "[LANG:en]Korean onomatopoeia includes[LANG:ko] 야옹 (meow)[LANG:en] and[LANG:ko] 멍멍 (woof)[LANG:en]."';
            } else if (isJapanese) {
                languageInstruction = '\n\nMULTILINGUAL CONTENT: Create mixed-language narration. Use JAPANESE text for Japanese words/concepts (日本語). Use ENGLISH for explanations. Mark language boundaries with [LANG:ja] and [LANG:en] tags.';
            } else if (isChinese) {
                languageInstruction = '\n\nMULTILINGUAL CONTENT: Create mixed-language narration. Use CHINESE text for Chinese words/concepts (中文). Use ENGLISH for explanations. Mark language boundaries with [LANG:zh] and [LANG:en] tags.';
            } else if (isSpanish) {
                languageInstruction = '\n\nMULTILINGUAL CONTENT: Create mixed-language narration. Use SPANISH text for Spanish words/concepts. Use ENGLISH for explanations. Mark language boundaries with [LANG:es] and [LANG:en] tags.';
            } else if (isFrench) {
                languageInstruction = '\n\nMULTILINGUAL CONTENT: Create mixed-language narration. Use FRENCH text for French words/concepts. Use ENGLISH for explanations. Mark language boundaries with [LANG:fr] and [LANG:en] tags.';
            }

            let prompt = previousPoint ?
                `Write a simple 1-2 sentence transition for a lesson about "${mainTopic}". The previous topic was "${previousPoint}". Now we're learning about "${learningPoint}". 

IMPORTANT: Make sure to specifically mention "${mainTopic}" in your narration and keep the focus on this exact topic. Be specific about the cultural/linguistic context if applicable.${languageInstruction}

Keep it simple and educational. Just return the text.` :
                `Write a simple 1-2 sentence welcome message for a lesson about "${mainTopic}", specifically focusing on "${learningPoint}". 

IMPORTANT: Make sure to specifically mention "${mainTopic}" in your welcome message and maintain any cultural/linguistic specificity.${languageInstruction}

Keep it friendly and educational. Just return the text.`;
            return await this.makeRequest(prompt, { temperature: 0.5, maxOutputTokens: 256 });
        }

        async generateConcludingNarration(learningPoint) {
            log(`GEMINI: Generating concluding narration for "${learningPoint}"`);
            const mainTopic = currentLessonPlan?.topic || learningPoint;
            const prompt = `Write a short, 1-sentence concluding summary for the topic "${learningPoint}" in the context of learning about "${mainTopic}". 

IMPORTANT: Make sure to specifically mention "${mainTopic}" and maintain any cultural/linguistic specificity in your summary.

This will play after the video or quiz. Keep it encouraging and specific to the exact topic. Just return the text.`;
            return await this.makeRequest(prompt, { temperature: 0.6, maxOutputTokens: 256 });
        }

        async findVideoSegments(videoTitle, youtubeUrl, learningPoint, transcript = null) {
            log(`SEGMENTER: Analyzing YouTube video for "${learningPoint}"`);
            try {
                let prompt = `You are a video analyst. For a YouTube video titled "${videoTitle}", identify the most relevant segments for the learning topic: "${learningPoint}".`;

                if (transcript && transcript.trim().length > 0) {
                    // Truncate transcript for analysis if too long
                    const truncatedTranscript = transcript.length > 3000 
                        ? transcript.substring(0, 3000) + "..." 
                        : transcript;

                    prompt += `

Video Transcript:
"${truncatedTranscript}"

TRANSCRIPT-BASED ANALYSIS:
- Use the transcript to identify specific time segments where "${learningPoint}" is discussed
- Look for educational explanations, examples, or demonstrations related to the topic
- Identify 1-3 key segments, each 30-120 seconds long. Total duration should be 60-240 seconds.
- Prioritize segments with the most relevant and educational content
- Avoid intro/outro segments unless they contain relevant information`;
                } else {
                    prompt += `

(No transcript available - using general heuristics)
- Educational videos usually have an intro (0-30s), main content, and an outro. Focus on the main content.
- Identify 1-3 key segments, each 30-120 seconds long. Total duration should be 60-240 seconds.`;
                }

                prompt += `

Return ONLY a valid JSON array like: [{"startTime": 45, "endTime": 135, "reason": "Explanation of core concepts"}]
If you can't determine specific segments, return one comprehensive segment: [{"startTime": 30, "endTime": 210, "reason": "Core educational content"}]`;

                const response = await this.makeRequest(prompt, { temperature: 0.3, maxOutputTokens: 1024 });
                const segments = this.parseJSONResponse(response);
                if (Array.isArray(segments) && segments.length > 0 && typeof segments[0].startTime === 'number') {
                    const transcriptNote = transcript ? " (using transcript)" : " (using heuristics)";
                    log(`SEGMENTER: Found ${segments.length} valid segments${transcriptNote}.`);
                    return segments;
                }
                log("SEGMENTER WARN: AI response invalid. Using fallback.");
                return [{ startTime: 30, endTime: 180, reason: "Main educational content" }];
            } catch (error) {
                logError("SEGMENTER ERROR:", error);
                return [{ startTime: 30, endTime: 180, reason: "Main educational content" }];
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

        async getVideoTranscript(youtubeId) {
            log(`TRANSCRIPT: Fetching transcript for video: ${youtubeId}`);
            try {
                const response = await fetch(`https://api.supadata.ai/v1/transcript?video_id=${youtubeId}`, {
                    method: 'GET',
                    headers: {
                        'x-api-key': SUPADATA_API_KEY,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    log(`TRANSCRIPT: API failed for ${youtubeId}: ${response.status} ${response.statusText}`);
                    return null;
                }

                const data = await response.json();

                // Extract transcript text from the response
                if (data && data.transcript) {
                    const transcriptText = Array.isArray(data.transcript) 
                        ? data.transcript.map(item => item.text || item.content || '').join(' ')
                        : typeof data.transcript === 'string' 
                        ? data.transcript 
                        : JSON.stringify(data.transcript);

                    log(`TRANSCRIPT: Successfully fetched ${transcriptText.length} characters for ${youtubeId}`);
                    return transcriptText;
                } else {
                    log(`TRANSCRIPT: No transcript data found for ${youtubeId}`);
                    return null;
                }
            } catch (error) {
                logError(`TRANSCRIPT: Error fetching transcript for ${youtubeId}:`, error);
                return null;
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
        constructor() { 
            this.apiKey = "AIzaSyA43RRVypjAAXwYdpKrojWVmdRAGyLKwr8"; 
            this.apiUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize'; 
            this.onCompleteCallback = null; 
            this.onProgressCallback = null; 
            this.isPaused = false; 
            this.isPlaying = false;
            this.audioQueue = [];
            this.currentAudioIndex = 0;
            this.startTime = null;
        }

        detectLanguage(text) {
            // More precise language detection with priority order
            const patterns = [
                { lang: 'ko', pattern: /[\u3131-\u3163\uac00-\ud7a3]/g }, // Korean characters
                { lang: 'ja', pattern: /[\u3040-\u309f\u30a0-\u30ff]/g }, // Hiragana/Katakana
                { lang: 'zh', pattern: /[\u4e00-\u9fff]/g }, // Chinese characters
                { lang: 'ru', pattern: /[\u0400-\u04ff]/g }, // Cyrillic
                { lang: 'ar', pattern: /[\u0600-\u06ff]/g }, // Arabic
                { lang: 'hi', pattern: /[\u0900-\u097f]/g }, // Devanagari
                { lang: 'es', pattern: /\b(español|castellano|¿|¡|ñ|á|é|í|ó|ú)\b/gi },
                { lang: 'fr', pattern: /\b(français|francais|à|é|è|ê|ë|ç|î|ï|ô|ù|û|ü|ÿ)\b/gi },
                { lang: 'de', pattern: /\b(deutsch|ä|ö|ü|ß)\b/gi },
                { lang: 'it', pattern: /\b(italiano|à|è|é|ì|í|î|ò|ó|ù|ú)\b/gi },
                { lang: 'pt', pattern: /\b(português|português|ã|ç|á|à|â|é|ê|í|ó|ô|õ|ú)\b/gi }
            ];

            // Check for non-Latin scripts first (they're more definitive)
            for (const {lang, pattern} of patterns.slice(0, 6)) {
                const matches = text.match(pattern);
                if (matches && matches.length > 0) {
                    return lang;
                }
            }

            // Check for Latin-based languages
            for (const {lang, pattern} of patterns.slice(6)) {
                if (pattern.test(text)) {
                    return lang;
                }
            }

            return 'en'; // Default to English
        }

        getVoiceConfig(languageCode) {
            const voices = {
                'ko': { languageCode: 'ko-KR', name: 'ko-KR-Standard-C', ssmlGender: 'FEMALE' },
                'ja': { languageCode: 'ja-JP', name: 'ja-JP-Standard-B', ssmlGender: 'FEMALE' },
                'zh': { languageCode: 'zh-CN', name: 'zh-CN-Standard-A', ssmlGender: 'FEMALE' },
                'es': { languageCode: 'es-US', name: 'es-US-Standard-A', ssmlGender: 'FEMALE' },
                'fr': { languageCode: 'fr-FR', name: 'fr-FR-Standard-C', ssmlGender: 'FEMALE' },
                'de': { languageCode: 'de-DE', name: 'de-DE-Standard-A', ssmlGender: 'FEMALE' },
                'it': { languageCode: 'it-IT', name: 'it-IT-Standard-A', ssmlGender: 'FEMALE' },
                'pt': { languageCode: 'pt-BR', name: 'pt-BR-Standard-A', ssmlGender: 'FEMALE' },
                'ru': { languageCode: 'ru-RU', name: 'ru-RU-Standard-C', ssmlGender: 'FEMALE' },
                'ar': { languageCode: 'ar-XA', name: 'ar-XA-Standard-A', ssmlGender: 'FEMALE' },
                'hi': { languageCode: 'hi-IN', name: 'hi-IN-Standard-A', ssmlGender: 'FEMALE' },
                'en': { languageCode: 'en-US', name: 'en-US-Standard-H', ssmlGender: 'FEMALE' }
            };
            return voices[languageCode] || voices['en'];
        }

        parseMultilingualText(text) {
            // Parse text with [LANG:code] markers
            const segments = [];
            const langPattern = /\[LANG:(.*?)\](.*?)(?=\[LANG:|$)/g;
            let match;
            let lastIndex = 0;

            while ((match = langPattern.exec(text)) !== null) {
                // Add any text before the first language tag as English
                if (lastIndex === 0 && match.index > 0) {
                    const beforeText = text.substring(0, match.index).trim();
                    if (beforeText) {
                        segments.push({
                            text: beforeText,
                            language: 'en'
                        });
                    }
                }

                const lang = match[1].toLowerCase();
                const content = match[2].trim();
                if (content) {
                    segments.push({
                        text: content,
                        language: lang
                    });
                }
                lastIndex = match.index + match[0].length;
            }

            // If no language tags found, smart split by language detection
            if (segments.length === 0) {
                return this.smartLanguageSplit(text);
            } else {
                // Add any remaining text as English
                const remainingText = text.substring(lastIndex).trim();
                if (remainingText) {
                    const detectedLang = this.detectLanguage(remainingText);
                    segments.push({
                        text: remainingText,
                        language: detectedLang
                    });
                }
            }

            return segments.filter(segment => segment.text.length > 0);
        }

        smartLanguageSplit(text) {
            // Smart splitting for mixed-language content without explicit tags
            const segments = [];
            
            // Split by sentences first
            const sentences = text.match(/[^\.!?]+[\.!?]+/g) || [text];
            
            for (const sentence of sentences) {
                const cleanSentence = sentence.trim();
                if (!cleanSentence) continue;

                // Detect language for each sentence
                const detectedLang = this.detectLanguage(cleanSentence);
                
                // If we have a previous segment with the same language, combine them
                if (segments.length > 0 && segments[segments.length - 1].language === detectedLang) {
                    segments[segments.length - 1].text += ' ' + cleanSentence;
                } else {
                    segments.push({
                        text: cleanSentence,
                        language: detectedLang
                    });
                }
            }

            // If no sentences detected, treat as single segment
            if (segments.length === 0) {
                const detectedLang = this.detectLanguage(text);
                segments.push({
                    text: text.trim(),
                    language: detectedLang
                });
            }

            return segments;
        }

        async synthesizeSegment(text, languageCode) {
            const voiceConfig = this.getVoiceConfig(languageCode);
            log(`SPEECH: Synthesizing "${text.substring(0, 30)}..." in ${languageCode} using voice ${voiceConfig.name}`);

            // Language-specific audio configuration
            const audioConfig = {
                audioEncoding: 'MP3',
                speakingRate: this.getSpeakingRate(languageCode),
                pitch: this.getPitch(languageCode),
                volumeGainDb: 0.0
            };

            const maxRetries = 3;
            let currentRetry = 0;

            while (currentRetry <= maxRetries) {
                try {
                    const requestBody = {
                        input: { text: this.preprocessTextForLanguage(text, languageCode) },
                        voice: voiceConfig,
                        audioConfig: audioConfig
                    };

                    log(`SPEECH API: Request for ${languageCode}:`, requestBody);

                    const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });

                    if (response.ok) {
                        const data = await response.json();
                        log(`SPEECH: Successfully synthesized ${languageCode} audio`);
                        return this.base64ToBlob(data.audioContent);
                    }

                    const errorData = await response.json().catch(() => ({}));
                    log(`SPEECH API ERROR: ${response.status} - ${JSON.stringify(errorData)}`);

                    if (response.status === 429 && currentRetry < maxRetries) {
                        log(`SPEECH API: Rate limited. Retrying in ${(currentRetry + 1) * 2} seconds...`);
                        currentRetry++;
                        await new Promise(resolve => setTimeout(resolve, (currentRetry) * 2000));
                    } else if (response.status >= 500 && currentRetry < maxRetries) {
                        log(`SPEECH API: Server error ${response.status}. Retrying...`);
                        currentRetry++;
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    } else {
                        throw new Error(`Speech API failed: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
                    }
                } catch (fetchError) {
                    if (currentRetry < maxRetries) {
                        log(`SPEECH API: Network error. Retrying... (${currentRetry + 1}/${maxRetries})`);
                        currentRetry++;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        logError(`SPEECH: Final synthesis error for ${languageCode}:`, fetchError);
                        throw fetchError;
                    }
                }
            }
        }

        getSpeakingRate(languageCode) {
            // Adjust speaking rate for different languages
            const rates = {
                'ko': 0.9,  // Korean slightly slower
                'ja': 0.9,  // Japanese slightly slower
                'zh': 0.9,  // Chinese slightly slower
                'es': 1.0,  // Spanish normal
                'fr': 1.0,  // French normal
                'de': 0.95, // German slightly slower
                'it': 1.0,  // Italian normal
                'pt': 1.0,  // Portuguese normal
                'ru': 0.9,  // Russian slightly slower
                'ar': 0.9,  // Arabic slightly slower
                'hi': 0.9,  // Hindi slightly slower
                'en': 1.0   // English normal
            };
            return rates[languageCode] || 1.0;
        }

        getPitch(languageCode) {
            // Adjust pitch for different languages
            const pitches = {
                'ko': 0.0,   // Korean neutral
                'ja': 0.0,   // Japanese neutral
                'zh': 0.0,   // Chinese neutral
                'es': 0.0,   // Spanish neutral
                'fr': 0.0,   // French neutral
                'de': -1.0,  // German slightly lower
                'it': 1.0,   // Italian slightly higher
                'pt': 0.0,   // Portuguese neutral
                'ru': -1.0,  // Russian slightly lower
                'ar': 0.0,   // Arabic neutral
                'hi': 0.0,   // Hindi neutral
                'en': 0.0    // English neutral
            };
            return pitches[languageCode] || 0.0;
        }

        preprocessTextForLanguage(text, languageCode) {
            // Add language-specific preprocessing for better pronunciation
            let processedText = text.trim();

            switch (languageCode) {
                case 'ko':
                    // Korean text preprocessing
                    processedText = processedText.replace(/\s+/g, ' ');
                    break;
                case 'ja':
                    // Japanese text preprocessing
                    processedText = processedText.replace(/\s+/g, ' ');
                    break;
                case 'zh':
                    // Chinese text preprocessing
                    processedText = processedText.replace(/\s+/g, '');
                    break;
                case 'es':
                    // Spanish text preprocessing - add pronunciation hints
                    processedText = processedText.replace(/ñ/g, 'ñ');
                    break;
                default:
                    processedText = processedText.replace(/\s+/g, ' ');
            }

            return processedText;
        }

        async play(text, { onProgress = null, onComplete = null } = {}) {
            log(`SPEECH: Starting multilingual playback: "${text.substring(0, 50)}..."`);
            this.stop();

            if (!text) {
                if (onComplete) onComplete();
                return;
            }

            this.onProgressCallback = onProgress;
            this.onCompleteCallback = onComplete;
            this.isPaused = false;
            this.isPlaying = true;
            this.startTime = Date.now();

            try {
                // Parse text into language segments
                const segments = this.parseMultilingualText(text);
                log(`SPEECH: Parsed into ${segments.length} segments:`, segments.map(s => `${s.language}: "${s.text.substring(0, 20)}..."`));

                // Synthesize all segments in parallel for better performance
                const audioPromises = segments.map(segment => 
                    this.synthesizeSegment(segment.text, segment.language)
                );

                const audioBlobs = await Promise.all(audioPromises);

                // Create audio elements for each segment
                this.audioQueue = audioBlobs.map((blob, index) => {
                    const audio = new Audio();
                    audio.src = URL.createObjectURL(blob);
                    audio.preload = 'auto';
                    return {
                        audio,
                        segment: segments[index],
                        duration: 0 // Will be set when loaded
                    };
                });

                this.currentAudioIndex = 0;

                // Load duration for progress calculation
                await this.loadAudioDurations();

                // Start playing the first segment
                this.playCurrentSegment();

            } catch (error) {
                logError(`SPEECH: Multilingual synthesis error:`, error);
                this.fallbackTiming(text);
            }
        }

        async loadAudioDurations() {
            const loadPromises = this.audioQueue.map(item => 
                new Promise(resolve => {
                    const audio = item.audio;
                    const onLoad = () => {
                        item.duration = audio.duration || 2; // Fallback duration
                        audio.removeEventListener('loadedmetadata', onLoad);
                        audio.removeEventListener('canplaythrough', onLoad);
                        resolve();
                    };
                    audio.addEventListener('loadedmetadata', onLoad);
                    audio.addEventListener('canplaythrough', onLoad);
                    // Timeout fallback
                    setTimeout(() => {
                        item.duration = 2;
                        resolve();
                    }, 3000);
                })
            );
            await Promise.all(loadPromises);
        }

        playCurrentSegment() {
            if (!this.isPlaying || this.currentAudioIndex >= this.audioQueue.length) {
                this.handlePlaybackComplete();
                return;
            }

            const currentItem = this.audioQueue[this.currentAudioIndex];
            const audio = currentItem.audio;

            log(`SPEECH: Playing segment ${this.currentAudioIndex + 1}/${this.audioQueue.length} (${currentItem.segment.language}): "${currentItem.segment.text.substring(0, 30)}..."`);

            audio.onended = () => {
                this.currentAudioIndex++;
                setTimeout(() => this.playCurrentSegment(), 100); // Small gap between segments
            };

            audio.onerror = () => {
                logError(`Audio error for segment ${this.currentAudioIndex + 1}`);
                this.currentAudioIndex++;
                setTimeout(() => this.playCurrentSegment(), 100);
            };

            audio.ontimeupdate = () => {
                this.updateProgress();
            };

            audio.play().catch(e => {
                logError(`Error playing segment ${this.currentAudioIndex + 1}:`, e);
                this.currentAudioIndex++;
                setTimeout(() => this.playCurrentSegment(), 100);
            });
        }

        updateProgress() {
            if (!this.onProgressCallback || this.audioQueue.length === 0) return;

            const totalDuration = this.audioQueue.reduce((sum, item) => sum + (item.duration || 0), 0);
            if (totalDuration === 0) return;

            let elapsedDuration = 0;

            // Add duration of completed segments
            for (let i = 0; i < this.currentAudioIndex; i++) {
                elapsedDuration += this.audioQueue[i].duration || 0;
            }

            // Add current segment progress
            if (this.currentAudioIndex < this.audioQueue.length) {
                const currentAudio = this.audioQueue[this.currentAudioIndex].audio;
                elapsedDuration += currentAudio.currentTime || 0;
            }

            const progress = Math.min(elapsedDuration / totalDuration, 1);
            this.onProgressCallback(progress);
        }

        handlePlaybackComplete() {
            this.isPlaying = false;
            this.isPaused = false;

            if (this.onProgressCallback) this.onProgressCallback(1);
            if (this.onCompleteCallback) this.onCompleteCallback();

            log('SPEECH: Multilingual playback completed');
        }

        fallbackTiming(text) {
            const estimatedDuration = Math.max(3000, Math.min(text.length * 80, 15000));
            log(`SPEECH: Using fallback timer for ${estimatedDuration}ms`);

            if (this.onProgressCallback) {
                const progressInterval = setInterval(() => {
                    if (!this.isPlaying) {
                        clearInterval(progressInterval);
                        return;
                    }
                    const elapsed = Date.now() - this.startTime;
                    const progress = Math.min(elapsed / estimatedDuration, 1);
                    this.onProgressCallback(progress);

                    if (progress >= 1) {
                        clearInterval(progressInterval);
                    }
                }, 100);
            }

            setTimeout(() => {
                if (this.isPlaying && this.onCompleteCallback) {
                    this.handlePlaybackComplete();
                }
            }, estimatedDuration);
        }

        pause() {
            if (this.isPlaying && !this.isPaused && this.currentAudioIndex < this.audioQueue.length) {
                this.audioQueue[this.currentAudioIndex].audio.pause();
                this.isPaused = true;
                log('SPEECH: Multilingual playback paused');
            }
        }

        resume() {
            if (this.isPaused && this.isPlaying && this.currentAudioIndex < this.audioQueue.length) {
                this.audioQueue[this.currentAudioIndex].audio.play().catch(e => logError(`Resume error:`, e));
                this.isPaused = false;
                log('SPEECH: Multilingual playback resumed');
            }
        }

        stop() {
            log('SPEECH: Stopping multilingual playback');
            this.isPlaying = false;
            this.isPaused = false;

            // Stop and cleanup all audio elements
            this.audioQueue.forEach(item => {
                try {
                    item.audio.pause();
                    item.audio.currentTime = 0;
                    if (item.audio.src) {
                        URL.revokeObjectURL(item.audio.src);
                        item.audio.src = '';
                    }
                    // Clear event handlers
                    item.audio.onended = null;
                    item.audio.onerror = null;
                    item.audio.ontimeupdate = null;
                } catch (e) {
                    log('SPEECH: Error cleaning up audio:', e);
                }
            });

            this.audioQueue = [];
            this.currentAudioIndex = 0;
            log('SPEECH: Multilingual cleanup completed');
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

                // Step 2.5: Filter videos for relevance (with transcript analysis)
                displayStatusMessage('🎯 Filtering relevant content...', `Checking relevance to: "${learningPoint}"`);
                const uniqueVideos = [...new Map(allVideos.map(v => [v.youtubeId, v])).values()]
                    .sort((a, b) => b.educationalScore - a.educationalScore);

                const relevantVideos = [];
                const mainTopic = currentLessonPlan.topic || learningPoint;

                // Check up to 8 top videos for relevance (reduced since transcript analysis is more thorough)
                for (const video of uniqueVideos.slice(0, 8)) {
                    displayStatusMessage('🎯 Analyzing video content...', `Checking: "${video.title}"`);

                    // Fetch transcript for more accurate relevance checking
                    const transcript = await this.videoSourcer.getVideoTranscript(video.youtubeId);

                    const relevanceCheck = await this.gemini.checkVideoRelevance(
                        video.title, 
                        learningPoint, 
                        mainTopic, 
                        transcript
                    );

                    if (relevanceCheck.relevant) {
                        // Apply confidence-based scoring (higher boost for transcript-based analysis)
                        const confidenceBoost = transcript 
                            ? (relevanceCheck.confidence || 5) / 1.5  // Higher boost with transcript
                            : (relevanceCheck.confidence || 5) / 2;   // Lower boost without transcript

                        video.educationalScore += confidenceBoost;
                        video.relevanceConfidence = relevanceCheck.confidence || 5;
                        video.hasTranscript = !!transcript;
                        if (transcript) {
                            video.transcript = transcript;
                        }
                        relevantVideos.push(video);

                        const transcriptNote = transcript ? " (with transcript)" : " (title only)";
                        log(`RELEVANT VIDEO: "${video.title}" (Confidence: ${relevanceCheck.confidence || 'N/A'})${transcriptNote} - ${relevanceCheck.reason}`);
                    } else {
                        const transcriptNote = transcript ? " (analyzed transcript)" : " (title only)";
                        log(`FILTERED OUT: "${video.title}"${transcriptNote} - ${relevanceCheck.reason}`);
                    }

                    // Stop when we have enough HIGH-CONFIDENCE relevant videos
                    if (relevantVideos.length >= 5) break;
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

                // Use transcript if available from relevance checking
                const transcript = video.transcript || null;
                const transcriptNote = transcript ? " (with transcript data)" : " (title-based)";
                displayStatusMessage('✂️ Finding best segments...', `Analyzing: "${video.title}"${transcriptNote}`);

                currentSegments = await this.gemini.findVideoSegments(video.title, youtubeUrl, learningPoint, transcript);
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

        log('TEXT DISPLAY: Canvas is now hidden');    }

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