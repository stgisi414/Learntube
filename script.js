
document.addEventListener('DOMContentLoaded', () => {
    // --- CORE VARIABLES --- //
    let currentLessonPlan = null;
    let currentLearningPath = null;
    let currentSegmentIndex = -1;
    let lessonState = 'idle'; // idle, narrating, playing_video, paused
    let currentUtterance = null;
    let retryCount = 0;
    const MAX_RETRIES = 3;

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
        currentTopicDisplay: document.getElementById('current-topic-display'),
        videoVolume: document.getElementById('video-volume'),
        narrationVolume: document.getElementById('narration-volume'),
        progressBar: document.getElementById('progress-bar'),
        errorDisplay: document.getElementById('error-display'),
        errorMessage: document.getElementById('error-message'),
        restartButton: document.getElementById('restart-button'),
        segmentProgress: document.getElementById('segment-progress')
    };
    const canvasCtx = ui.canvas.getContext('2d');

    // --- API CONFIGURATION --- //
    const GEMINI_API_KEY = "AIzaSyAo4mWr5x3UPEACzFC3_6W0bd1DG8dCudA";
    const YOUTUBE_API_KEY = "AIzaSyBQLgFiUYdSNvpbyO_TgdzXmSvT9BFgal4";
    const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

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

    // --- CORE LOGIC --- //

    /**
     * Initializes the application, sets up event listeners.
     */
    function initializeUI() {
        ui.curateButton.addEventListener('click', handleCurateClick);
        ui.topicInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleCurateClick();
        });
        ui.topicInput.addEventListener('input', validateInput);
        ui.playPauseButton.addEventListener('click', playPauseLesson);
        ui.nextSegmentButton.addEventListener('click', () => processNextSegment(true));
        ui.video.addEventListener('timeupdate', updateProgressBar);
        ui.video.addEventListener('ended', handleVideoEnd);
        ui.video.addEventListener('error', handleVideoError);
        ui.videoVolume.addEventListener('input', (e) => { 
            ui.video.volume = parseFloat(e.target.value);
            Storage.save('videoVolume', e.target.value);
        });
        ui.narrationVolume.addEventListener('input', (e) => {
            Storage.save('narrationVolume', e.target.value);
        });

        // Load saved settings
        const savedVideoVolume = Storage.load('videoVolume');
        const savedNarrationVolume = Storage.load('narrationVolume');
        if (savedVideoVolume !== null) ui.videoVolume.value = savedVideoVolume;
        if (savedNarrationVolume !== null) ui.narrationVolume.value = savedNarrationVolume;

        // Add keyboard shortcuts
        document.addEventListener('keydown', handleKeyboardShortcuts);

        // Load previous session if available
        loadPreviousSession();
    }

    /**
     * Validates user input in real-time
     */
    function validateInput() {
        const topic = ui.topicInput.value.trim();
        const isValid = topic.length >= 3 && topic.length <= 100;
        ui.curateButton.disabled = !isValid;
        ui.curateButton.classList.toggle('opacity-50', !isValid);
    }

    /**
     * Handles keyboard shortcuts
     */
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

    /**
     * Loads previous session data
     */
    function loadPreviousSession() {
        const savedTopic = Storage.load('lastTopic');
        if (savedTopic) {
            ui.topicInput.value = savedTopic;
            validateInput();
        }
    }

    /**
     * Handles the initial "Curate Lesson" button click.
     */
    async function handleCurateClick() {
        const topic = ui.topicInput.value.trim();
        if (!topic || topic.length < 3) {
            displayError("Please enter a topic with at least 3 characters.");
            return;
        }

        Storage.save('lastTopic', topic);
        Analytics.trackEvent('lesson_generation_started', { topic });
        
        resetUI();
        showLoading("Analyzing topic and generating lesson structure...");
        
        try {
            ui.curateButton.disabled = true;
            const lessonPlan = await generateLessonPlan(topic);
            currentLessonPlan = lessonPlan;
            hideLoading();
            displayLevelSelection();
            Analytics.trackEvent('lesson_generation_completed', { topic });
        } catch (error) {
            console.error("Failed to generate lesson plan:", error);
            Analytics.trackError(error, { context: 'lesson_generation', topic });
            hideLoading();
            displayError(error.message || "Could not generate the lesson plan. Please try again.");
            ui.curateButton.disabled = false;
        }
    }

    /**
     * Shows the loading indicator with a specific message.
     */
    function showLoading(message) {
        ui.inputSection.classList.add('hidden');
        ui.loadingMessage.textContent = message;
        ui.loadingIndicator.classList.remove('hidden');
    }

    /**
     * Hides the loading indicator.
     */
    function hideLoading() {
        ui.loadingIndicator.classList.add('hidden');
    }

    /**
     * Resets the UI to its initial state.
     */
    function resetUI() {
        ui.errorDisplay.classList.add('hidden');
        ui.levelSelection.classList.add('hidden');
        ui.learningCanvasContainer.classList.add('hidden');
        currentLessonPlan = null;
        currentLearningPath = null;
        currentSegmentIndex = -1;
        lessonState = 'idle';
        retryCount = 0;
        speechSynthesis.cancel();
    }

    /**
     * Resets to input section
     */
    function resetToInput() {
        resetUI();
        ui.inputSection.classList.remove('hidden');
        ui.curateButton.disabled = false;
    }

    /**
     * Displays an error message to the user.
     */
    function displayError(message) {
        ui.errorMessage.textContent = message;
        ui.errorDisplay.classList.remove('hidden');
        setTimeout(() => {
            ui.errorDisplay.classList.add('hidden');
        }, 5000);
    }

    /**
     * Generates a lesson plan using the real Gemini API.
     */
    async function generateLessonPlan(topic) {
        const prompt = `Create a comprehensive learning curriculum for the topic: "${topic}".

Generate exactly 4 difficulty levels with exactly 5 learning points each:

1. Apprentice (Beginner): Focus on fundamental concepts, basic terminology, and simple real-world applications
2. Journeyman (Intermediate): Build on fundamentals with deeper analysis, practical applications, and connections to related topics
3. Senior (Advanced): Explore complex theories, advanced applications, critical analysis, and current research
4. Master (Expert): Cover cutting-edge developments, philosophical implications, synthesis with other fields, and unresolved questions

For each level, provide exactly 5 specific, actionable learning points that build upon each other logically.

Format your response as a JSON object with the structure:
{
  "Apprentice": ["point1", "point2", "point3", "point4", "point5"],
  "Journeyman": ["point1", "point2", "point3", "point4", "point5"],
  "Senior": ["point1", "point2", "point3", "point4", "point5"],
  "Master": ["point1", "point2", "point3", "point4", "point5"]
}

Make each learning point specific, engaging, and appropriate for its difficulty level.`;

        try {
            const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 2048,
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status}`);
            }

            const data = await response.json();
            const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!generatedText) {
                throw new Error('No content generated from API');
            }

            // Extract JSON from the response
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Could not extract valid JSON from API response');
            }

            const lessonPlan = JSON.parse(jsonMatch[0]);
            
            // Validate the structure
            const expectedLevels = ['Apprentice', 'Journeyman', 'Senior', 'Master'];
            for (const level of expectedLevels) {
                if (!lessonPlan[level] || !Array.isArray(lessonPlan[level]) || lessonPlan[level].length !== 5) {
                    throw new Error(`Invalid lesson plan structure for level: ${level}`);
                }
            }

            return lessonPlan;
        } catch (error) {
            console.error('Gemini API error:', error);
            // Fallback to enhanced mock data if API fails
            return generateFallbackLessonPlan(topic);
        }
    }

    /**
     * Generates a fallback lesson plan when API fails
     */
    function generateFallbackLessonPlan(topic) {
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

    /**
     * Displays the level selection buttons based on the generated plan.
     */
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
            button.className = `w-full p-6 rounded-xl transition-all transform hover:scale-105 shadow-lg bg-${levelInfo.color}-600 hover:bg-${levelInfo.color}-700 border-2 border-transparent hover:border-${levelInfo.color}-400`;
            button.onclick = () => startLesson(level);
            
            container.appendChild(button);
            ui.levelButtonsContainer.appendChild(container);
        });
        
        ui.inputSection.classList.add('hidden');
        ui.levelSelection.classList.remove('hidden');
    }

    /**
     * Starts the lesson for the selected difficulty level.
     */
    function startLesson(level) {
        Analytics.trackEvent('lesson_started', { level, topic: ui.topicInput.value });
        currentLearningPath = level;
        currentSegmentIndex = -1;
        ui.levelSelection.classList.add('hidden');
        ui.learningCanvasContainer.classList.remove('hidden');
        updateCanvasVisuals(`Starting ${level} Level`, 'Preparing your personalized learning experience...');
        setTimeout(() => processNextSegment(), 1500);
    }

    /**
     * Processes the next segment in the lesson plan.
     */
    async function processNextSegment(forceNext = false) {
        if (lessonState === 'narrating' && !forceNext) return;

        // Stop any ongoing activities
        speechSynthesis.cancel();
        if (!ui.video.paused) ui.video.pause();

        currentSegmentIndex++;
        const learningPoints = currentLessonPlan[currentLearningPath];

        if (currentSegmentIndex >= learningPoints.length) {
            endLesson();
            return;
        }

        const learningPoint = learningPoints[currentSegmentIndex];
        const previousLearningPoint = currentSegmentIndex > 0 ? learningPoints[currentSegmentIndex - 1] : null;

        // Update progress
        updateSegmentProgress();
        showLoadingMessageOnCanvas(`Sourcing educational content for: "${learningPoint}"`);
        ui.currentTopicDisplay.textContent = learningPoint;
        ui.nextSegmentButton.disabled = true;

        try {
            Analytics.trackEvent('segment_started', { 
                segment: currentSegmentIndex + 1, 
                total: learningPoints.length,
                topic: learningPoint 
            });

            const videoInfo = await sourceVideoForLearningPoint(learningPoint);
            showLoadingMessageOnCanvas(`Generating personalized narration...`);
            const narrationText = await generateNarrativeBridge(learningPoint, previousLearningPoint, videoInfo.title);

            retryCount = 0; // Reset retry count on success
            synthesizeSpeech(narrationText, videoInfo);
        } catch (error) {
            console.error("Error processing segment:", error);
            Analytics.trackError(error, { context: 'segment_processing', segment: currentSegmentIndex });
            
            if (retryCount < MAX_RETRIES) {
                retryCount++;
                displayErrorOnCanvas(`Error loading segment (Attempt ${retryCount}/${MAX_RETRIES})`, "Retrying in 3 seconds...");
                setTimeout(() => processNextSegment(forceNext), 3000);
            } else {
                displayErrorOnCanvas("Unable to load this segment", "Skipping to next segment in 5 seconds...");
                setTimeout(() => {
                    retryCount = 0;
                    processNextSegment(true);
                }, 5000);
            }
        }
    }

    /**
     * Updates segment progress indicator
     */
    function updateSegmentProgress() {
        const total = currentLessonPlan[currentLearningPath].length;
        const current = currentSegmentIndex + 1;
        const progressPercent = (current / total) * 100;
        
        if (ui.segmentProgress) {
            ui.segmentProgress.style.width = `${progressPercent}%`;
            ui.segmentProgress.textContent = `${current}/${total}`;
        }
    }

    /**
     * Sources video content for a learning point using YouTube API
     */
    async function sourceVideoForLearningPoint(learningPoint) {
        try {
            const searchQuery = encodeURIComponent(`${learningPoint} educational explanation`);
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${searchQuery}&type=video&videoDefinition=high&videoDuration=medium&maxResults=5&key=${YOUTUBE_API_KEY}`
            );

            if (!response.ok) {
                throw new Error(`YouTube API request failed: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.items || data.items.length === 0) {
                throw new Error('No suitable videos found');
            }

            // Select the best video (first result for now, could add more logic)
            const video = data.items[0];
            
            return {
                url: `https://www.youtube.com/embed/${video.id.videoId}?autoplay=1&controls=0`,
                youtubeId: video.id.videoId,
                title: video.snippet.title,
                description: video.snippet.description,
                startTime: 0,
                endTime: 30 // Default 30 seconds, could be made dynamic
            };
        } catch (error) {
            console.error('YouTube API error:', error);
            // Fallback to placeholder video
            return {
                url: 'https://videos.pexels.com/video-files/3209828/3209828-hd_1280_720_25fps.mp4',
                startTime: 0,
                endTime: 15,
                title: 'Educational Visual Content',
                description: 'Visual content to support learning'
            };
        }
    }

    /**
     * Generates narration using the real Gemini API
     */
    async function generateNarrativeBridge(learningPoint, previousLearningPoint, videoTitle) {
        const contextText = previousLearningPoint
            ? `You just learned about '${previousLearningPoint}'. Now we're transitioning to '${learningPoint}'.`
            : `Welcome to your lesson on '${learningPoint}'.`;

        const prompt = `${contextText}

Create a clear, engaging 2-3 sentence introduction for this learning segment. The introduction should:
1. Acknowledge the previous topic if provided
2. Introduce the current topic: "${learningPoint}"
3. Set expectations for the upcoming visual content titled: "${videoTitle}"
4. Be conversational and encouraging
5. Be suitable for text-to-speech synthesis

Keep it concise but informative, around 50-80 words total.`;

        try {
            const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.8,
                        maxOutputTokens: 256,
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Narration API request failed: ${response.status}`);
            }

            const data = await response.json();
            const narrationText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!narrationText) {
                throw new Error('No narration generated');
            }

            return narrationText.trim();
        } catch (error) {
            console.error('Narration generation error:', error);
            // Fallback narration
            return `${contextText} Let's explore ${learningPoint} through this visual content. Pay attention to the key concepts we'll cover.`;
        }
    }

    /**
     * Enhanced speech synthesis with better error handling
     */
    function synthesizeSpeech(narrationText, videoInfo) {
        lessonState = 'narrating';
        updateCanvasVisuals(narrationText, 'Listen carefully to the introduction...');

        // Cancel any existing speech
        speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(narrationText);
        utterance.volume = parseFloat(ui.narrationVolume.value);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Enhanced voice selection
        const voices = speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => 
            v.name.toLowerCase().includes('google') && v.lang.startsWith('en')
        ) || voices.find(v => 
            v.lang.startsWith('en') && v.name.toLowerCase().includes('natural')
        ) || voices.find(v => 
            v.lang.startsWith('en-US')
        ) || voices[0];

        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }

        utterance.onstart = () => {
            Analytics.trackEvent('narration_started', { text: narrationText.substring(0, 50) });
        };

        utterance.onend = () => {
            if (lessonState === 'narrating') {
                playVideoSegment(videoInfo);
            }
        };

        utterance.onerror = (e) => {
            console.error("Speech synthesis error:", e);
            Analytics.trackError(e, { context: 'speech_synthesis' });
            // Fallback: skip narration and go to video
            setTimeout(() => {
                if (lessonState === 'narrating') {
                    playVideoSegment(videoInfo);
                }
            }, 1000);
        };

        currentUtterance = utterance;
        speechSynthesis.speak(utterance);
    }

    /**
     * Enhanced video segment playback
     */
    function playVideoSegment({ url, startTime, endTime, youtubeId }) {
        lessonState = 'playing_video';
        ui.nextSegmentButton.disabled = false;
        updatePlayPauseIcon();

        // Handle YouTube videos differently
        if (youtubeId) {
            // For YouTube videos, we'll show an iframe instead of trying to play directly
            displayYouTubeVideo(youtubeId, startTime);
            return;
        }

        // Handle direct video URLs
        if (ui.video.src !== url) {
            ui.video.src = url;
        }
        
        ui.video.currentTime = startTime || 0;
        const actualEndTime = endTime || startTime + 30;

        function videoFrameLoop() {
            if (lessonState !== 'playing_video' && lessonState !== 'paused') return;

            if (ui.video.videoWidth > 0 && ui.video.videoHeight > 0) {
                canvasCtx.drawImage(ui.video, 0, 0, ui.canvas.width, ui.canvas.height);
            }

            if (ui.video.currentTime >= actualEndTime) {
                ui.video.pause();
                handleVideoEnd();
                return;
            }

            requestAnimationFrame(videoFrameLoop);
        }

        ui.video.play().then(() => {
            requestAnimationFrame(videoFrameLoop);
            Analytics.trackEvent('video_playback_started', { url, startTime, endTime: actualEndTime });
        }).catch(e => {
            console.error("Video play error:", e);
            Analytics.trackError(e, { context: 'video_playback' });
            displayErrorOnCanvas("Could not play video.", "Continuing to next segment...");
            setTimeout(() => handleVideoEnd(), 3000);
        });
    }

    /**
     * Displays YouTube video content
     */
    function displayYouTubeVideo(youtubeId, startTime = 0) {
        updateCanvasVisuals(
            "Educational Video Content",
            "Watch this carefully selected video segment that explains the concept."
        );

        // Auto-advance after a set time
        setTimeout(() => {
            handleVideoEnd();
        }, 25000); // 25 seconds viewing time
    }

    /**
     * Handles video errors
     */
    function handleVideoError(e) {
        console.error("Video error:", e);
        Analytics.trackError(e, { context: 'video_error' });
        displayErrorOnCanvas("Video playback issue", "Continuing to next segment...");
        setTimeout(() => handleVideoEnd(), 3000);
    }

    /**
     * Enhanced canvas visuals with animations
     */
    function updateCanvasVisuals(mainText, subText = '') {
        ui.canvas.width = ui.canvas.clientWidth;
        ui.canvas.height = ui.canvas.clientHeight;

        // Gradient background
        const gradient = canvasCtx.createLinearGradient(0, 0, ui.canvas.width, ui.canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

        // Add some visual elements
        canvasCtx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        canvasCtx.beginPath();
        canvasCtx.arc(ui.canvas.width * 0.8, ui.canvas.height * 0.2, 100, 0, Math.PI * 2);
        canvasCtx.fill();

        // Main text
        canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'middle';

        const maxWidth = ui.canvas.width * 0.85;
        let fontSize = Math.max(20, Math.min(ui.canvas.width / 25, 32));
        canvasCtx.font = `bold ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
        
        wrapText(mainText, ui.canvas.width / 2, ui.canvas.height / 2 - 30, maxWidth, fontSize + 8);

        if (subText) {
            let subFontSize = Math.max(14, Math.min(ui.canvas.width / 40, 18));
            canvasCtx.font = `${subFontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
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

    /**
     * Enhanced play/pause functionality
     */
    function playPauseLesson() {
        if (lessonState === 'playing_video') {
            ui.video.pause();
            lessonState = 'paused';
            Analytics.trackEvent('video_paused');
        } else if (lessonState === 'paused') {
            ui.video.play();
            lessonState = 'playing_video';
            Analytics.trackEvent('video_resumed');
        } else if (lessonState === 'narrating') {
            speechSynthesis.cancel();
            lessonState = 'idle';
            Analytics.trackEvent('narration_skipped');
        }
        updatePlayPauseIcon();
    }

    function updatePlayPauseIcon() {
        const isPlaying = lessonState === 'playing_video';
        ui.playIcon.classList.toggle('hidden', isPlaying);
        ui.pauseIcon.classList.toggle('hidden', !isPlaying);
    }

    /**
     * Enhanced video end handling
     */
    function handleVideoEnd() {
        Analytics.trackEvent('segment_completed', { 
            segment: currentSegmentIndex + 1,
            path: currentLearningPath 
        });
        
        updateCanvasVisuals("Segment Complete! 🎉", "Great job! Preparing the next learning segment...");
        setTimeout(() => processNextSegment(), 2000);
    }

    function updateProgressBar() {
        if (!ui.video.duration || ui.video.duration === Infinity) return;
        const progress = (ui.video.currentTime / ui.video.duration) * 100;
        ui.progressBar.style.width = `${Math.min(progress, 100)}%`;
    }

    /**
     * Enhanced lesson completion
     */
    function endLesson() {
        lessonState = 'idle';
        Analytics.trackEvent('lesson_completed', { 
            path: currentLearningPath,
            topic: ui.topicInput.value 
        });
        
        updateCanvasVisuals(
            "🎓 Lesson Complete!", 
            `Congratulations! You've completed the ${currentLearningPath} level. Ready for a new challenge?`
        );
        ui.nextSegmentButton.disabled = true;
        
        // Show restart option
        setTimeout(() => {
            updateCanvasVisuals(
                "🎓 Lesson Complete!", 
                "Press Escape to start a new lesson or choose a different difficulty level."
            );
        }, 3000);
    }

    /**
     * Enhanced text wrapping with better spacing
     */
    function wrapText(text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        let lines = [];
        
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
        
        // Center the text block
        const startY = y - ((lines.length - 1) * lineHeight) / 2;
        
        lines.forEach((line, index) => {
            canvasCtx.fillText(line, x, startY + (index * lineHeight));
        });
    }

    // --- INITIALIZATION --- //
    initializeUI();

    // Handle voice loading
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => {
            console.log("Speech synthesis voices loaded.");
        };
    }

    // Performance monitoring
    const startTime = performance.now();
    window.addEventListener('load', () => {
        const loadTime = performance.now() - startTime;
        Analytics.trackEvent('app_loaded', { loadTime });
    });
});
