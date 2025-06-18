document.addEventListener('DOMContentLoaded', () => {
    // --- CORE VARIABLES --- //
    let currentLessonPlan = null;
    let currentLearningPath = null;
    let currentSegmentIndex = -1;
    let lessonState = 'idle'; // idle, narrating, playing_video, paused

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
    };
    const canvasCtx = ui.canvas.getContext('2d');

    // --- API CONFIGURATION (MOCK) --- //
    // In a real app, these would be handled securely and not exposed client-side.
    const GEMINI_API_KEY = "AIzaSyAo4mWr5x3UPEACzFC3_6W0bd1DG8dCudA";
    const YOUTUBE_API_KEY = "AIzaSyBQLgFiUYdSNvpbyO_TgdzXmSvT9BFgal4";

    // --- CORE LOGIC --- //

    /**
     * Initializes the application, sets up event listeners.
     */
    function initializeUI() {
        ui.curateButton.addEventListener('click', handleCurateClick);
        ui.topicInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleCurateClick();
        });
        ui.playPauseButton.addEventListener('click', playPauseLesson);
        ui.nextSegmentButton.addEventListener('click', () => processNextSegment(true)); // force next
        ui.video.addEventListener('timeupdate', updateProgressBar);
        ui.video.addEventListener('ended', handleVideoEnd);
        ui.videoVolume.addEventListener('input', (e) => { ui.video.volume = e.target.value; });
    }

    /**
     * Handles the initial "Curate Lesson" button click.
     */
    async function handleCurateClick() {
        const topic = ui.topicInput.value.trim();
        if (!topic) {
            displayError("Please enter a topic to learn.");
            return;
        }
        resetUI();
        showLoading("Generating Lesson Plan...");
        try {
            const lessonPlan = await generateLessonPlan(topic);
            currentLessonPlan = lessonPlan;
            hideLoading();
            displayLevelSelection();
        } catch (error) {
            console.error("Failed to generate lesson plan:", error);
            hideLoading();
            displayError(error.message || "Could not generate the lesson plan.");
        }
    }

    /**
     * Shows the loading indicator with a specific message.
     * @param {string} message - The message to display.
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
        ui.inputSection.classList.remove('hidden');
        ui.topicInput.value = '';
        currentLessonPlan = null;
        currentLearningPath = null;
        currentSegmentIndex = -1;
        lessonState = 'idle';
    }

    /**
     * Displays an error message to the user.
     * @param {string} message - The error message.
     */
    function displayError(message) {
        ui.errorMessage.textContent = message;
        ui.errorDisplay.classList.remove('hidden');
    }

    /**
     * MOCK: Simulates a call to the Gemini API to get a lesson plan.
     * @param {string} topic - The topic for the lesson.
     * @returns {Promise<object>} A promise that resolves with the lesson plan.
     */
    function generateLessonPlan(topic) {
        console.log(`Generating lesson plan for: ${topic}`);
        return new Promise((resolve) => {
            setTimeout(() => {
                const mockLessonPlan = {
                    "Apprentice": ["Core Concept of " + topic, "First Key Principle", "Simple Application", "Common Misconception", "Introductory Analogy"],
                    "Journeyman": ["Building on the Core Concept", "Intermediate Principles", "Practical Use Case Analysis", "Connecting to Related Fields", "Exploring Nuances"],
                    "Senior": ["Advanced Theoretical Models", "Complex Applications & Edge Cases", "Historical Context and Evolution", "Critique of Standard Theories", "Leading Research Directions"],
                    "Master": ["Synthesizing " + topic + " with Other Disciplines", "Philosophical Implications", "Developing a Novel Hypothesis", "Teaching " + topic + " to an Expert", "Future Unsolved Problems"]
                };
                resolve(mockLessonPlan);
            }, 1500);
        });
    }

    /**
     * Displays the level selection buttons based on the generated plan.
     */
    function displayLevelSelection() {
        ui.levelButtonsContainer.innerHTML = '';
        const levels = Object.keys(currentLessonPlan);
        const colors = ['blue', 'green', 'yellow', 'red'];
        levels.forEach((level, index) => {
            const button = document.createElement('button');
            button.textContent = level;
            button.className = `p-8 rounded-xl text-xl font-bold transition-transform transform hover:scale-105 shadow-lg bg-${colors[index]}-600 hover:bg-${colors[index]}-700`;
            button.onclick = () => startLesson(level);
            ui.levelButtonsContainer.appendChild(button);
        });
        ui.inputSection.classList.add('hidden');
        ui.levelSelection.classList.remove('hidden');
    }

    /**
     * Starts the lesson for the selected difficulty level.
     * @param {string} level - The chosen learning path (e.g., 'Journeyman').
     */
    function startLesson(level) {
        console.log(`Starting lesson at level: ${level}`);
        currentLearningPath = level;
        currentSegmentIndex = -1; // Will be incremented to 0 by processNextSegment
        ui.levelSelection.classList.add('hidden');
        ui.learningCanvasContainer.classList.remove('hidden');
        updateCanvasVisuals('Lesson starting...', 'Get ready!');
        processNextSegment();
    }

    /**
     * Processes the next segment in the lesson plan.
     * @param {boolean} forceNext - If true, skips to the next segment regardless of state.
     */
    async function processNextSegment(forceNext = false) {
        if (lessonState === 'narrating' && !forceNext) return; // Don't interrupt narration

        // Stop any ongoing speech or video
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

        showLoadingMessageOnCanvas(`Sourcing video for: "${learningPoint}"`);
        ui.currentTopicDisplay.textContent = learningPoint;
        ui.nextSegmentButton.disabled = true;

        try {
            const videoInfo = await sourceVideoForLearningPoint(learningPoint);
            showLoadingMessageOnCanvas(`Generating narration...`);
            const narrationText = await generateNarrativeBridge(learningPoint, previousLearningPoint, videoInfo.title);

            synthesizeSpeech(narrationText, videoInfo);
        } catch (error) {
            console.error("Error processing segment:", error);
            displayErrorOnCanvas("Could not load segment", "Trying the next one in 5s...");
            setTimeout(() => processNextSegment(true), 5000);
        }
    }

    /**
     * MOCK: Simulates finding a relevant YouTube video segment.
     * @param {string} learningPoint - The concept to find a video for.
     * @returns {Promise<object>} A promise resolving with video info.
     */
    function sourceVideoForLearningPoint(learningPoint) {
        console.log(`Sourcing video for: ${learningPoint}`);
        return new Promise(resolve => {
            setTimeout(() => {
                // In a real app, this would involve YouTube API, caption analysis, etc.
                resolve({
                    // Using a royalty-free video for demonstration
                    url: 'https://videos.pexels.com/video-files/3209828/3209828-hd_1280_720_25fps.mp4',
                    startTime: 5, // Mock start time
                    endTime: 15,  // Mock end time
                    title: 'Abstract Visuals'
                });
            }, 1000);
        });
    }

    /**
     * MOCK: Generates introductory narration using Gemini.
     * This function now correctly accepts the previous learning point for context.
     * @param {string} learningPoint - The current topic.
     * @param {string|null} previousLearningPoint - The previous topic for context.
     * @param {string} videoTitle - The title of the upcoming video.
     * @returns {Promise<string>} A promise resolving with the narration text.
     */
    function generateNarrativeBridge(learningPoint, previousLearningPoint, videoTitle) {
        const previousTopicText = previousLearningPoint
            ? `You just finished learning about '${previousLearningPoint}'. Now, let's transition to the next key idea.`
            : "Let's begin your lesson.";

        const prompt = `${previousTopicText} The current topic is '${learningPoint}'. I am about to show you a video clip titled '${videoTitle}'. Please provide a concise, 2-3 sentence narration to introduce this topic and set up the video. Be engaging and clear.`;

        console.log("Generating narration with prompt:", prompt);

        // MOCK API call
        return new Promise(resolve => {
            setTimeout(() => {
                const mockNarration = `${previousTopicText} Now, we will explore ${learningPoint}. The following clip, called ${videoTitle}, will provide a visual foundation for this concept. Pay close attention.`;
                resolve(mockNarration);
            }, 1000);
        });
    }

    /**
     * Converts text to speech and plays it. On completion, plays the video segment.
     * @param {string} narrationText - The text to be spoken.
     * @param {object} videoInfo - Contains URL, startTime, and endTime for the video.
     */
    function synthesizeSpeech(narrationText, videoInfo) {
        lessonState = 'narrating';
        updateCanvasVisuals(narrationText);

        const utterance = new SpeechSynthesisUtterance(narrationText);
        utterance.volume = ui.narrationVolume.value;
        utterance.rate = 1.1;

        // Find a suitable voice
        const voices = speechSynthesis.getVoices();
        utterance.voice = voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) || voices.find(v => v.lang.startsWith('en')) || voices[0];

        utterance.onend = () => {
            if (lessonState === 'narrating') { // Ensure we weren't interrupted
                playVideoSegment(videoInfo);
            }
        };

        utterance.onerror = (e) => {
            console.error("Speech synthesis error:", e);
            // Fallback: if speech fails, just play the video
            playVideoSegment(videoInfo);
        };

        speechSynthesis.cancel(); // Clear any previous utterances
        speechSynthesis.speak(utterance);

        ui.narrationVolume.oninput = () => { utterance.volume = ui.narrationVolume.value; };
    }

    /**
     * Plays a specific segment of a video.
     * @param {object} videoInfo - Contains URL, startTime, and endTime.
     */
    function playVideoSegment({ url, startTime, endTime }) {
        lessonState = 'playing_video';
        ui.nextSegmentButton.disabled = false;

        // We draw the video to the canvas instead of showing the element
        if (ui.video.src !== url) {
            ui.video.src = url;
        }
        ui.video.currentTime = startTime;

        function videoFrameLoop() {
            if (lessonState !== 'playing_video' && lessonState !== 'paused') return;

            // Draw video frame to canvas
            canvasCtx.drawImage(ui.video, 0, 0, ui.canvas.width, ui.canvas.height);

            // Check if segment is over
            if (ui.video.currentTime >= endTime) {
                ui.video.pause();
                handleVideoEnd();
                return; // Stop the loop
            }

            requestAnimationFrame(videoFrameLoop);
        }

        ui.video.play().then(() => {
            lessonState = 'playing_video';
            updatePlayPauseIcon();
            requestAnimationFrame(videoFrameLoop);
        }).catch(e => {
            console.error("Video play error:", e);
            displayErrorOnCanvas("Could not play video.", "Please check browser permissions.");
        });
    }

    /**
     * Updates the visual display on the canvas.
     * @param {string} mainText - The primary text to display.
     * @param {string} subText - Optional secondary text.
     */
    function updateCanvasVisuals(mainText, subText = '') {
        // Set canvas resolution to its display size
        ui.canvas.width = ui.canvas.clientWidth;
        ui.canvas.height = ui.canvas.clientHeight;

        // Clear canvas
        canvasCtx.fillStyle = '#000000';
        canvasCtx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

        // Draw text
        canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'middle';

        const maxWidth = ui.canvas.width * 0.8;

        // Responsive font size for main text
        let fontSize = Math.max(24, ui.canvas.width / 30);
        canvasCtx.font = `bold ${fontSize}px Inter, sans-serif`;
        wrapText(mainText, ui.canvas.width / 2, ui.canvas.height / 2 - 20, maxWidth, fontSize + 4);

        if (subText) {
            let subFontSize = Math.max(16, ui.canvas.width / 50);
            canvasCtx.font = `${subFontSize}px Inter, sans-serif`;
            canvasCtx.fillStyle = 'rgba(200, 200, 200, 0.8)';
            wrapText(subText, ui.canvas.width / 2, ui.canvas.height / 2 + 40, maxWidth, subFontSize + 4);
        }
    }

    function showLoadingMessageOnCanvas(message) {
        updateCanvasVisuals('Loading...', message);
    }

    function displayErrorOnCanvas(title, message) {
        updateCanvasVisuals(`Error: ${title}`, message);
    }

    /**
     * Handles play/pause button clicks.
     */
    function playPauseLesson() {
        if (lessonState === 'playing_video') {
            ui.video.pause();
            lessonState = 'paused';
        } else if (lessonState === 'paused') {
            ui.video.play();
            lessonState = 'playing_video';
        }
        updatePlayPauseIcon();
    }

    /**
     * Updates the play/pause icon based on the lesson state.
     */
    function updatePlayPauseIcon() {
        const isPlaying = lessonState === 'playing_video';
        ui.playIcon.classList.toggle('hidden', isPlaying);
        ui.pauseIcon.classList.toggle('hidden', !isPlaying);
    }

    /**
     * Called when a video segment naturally ends.
     */
    function handleVideoEnd() {
        console.log("Segment finished.");
        updateCanvasVisuals("Segment Complete!", "Preparing next topic...");
        setTimeout(() => processNextSegment(), 1500);
    }

    /**
     * Updates the custom progress bar.
     */
    function updateProgressBar() {
        if (!ui.video.duration) return;
        const progress = (ui.video.currentTime / ui.video.duration) * 100;
        ui.progressBar.style.width = `${progress}%`;
    }

    /**
     * Displays the final "Lesson Complete" message.
     */
    function endLesson() {
        lessonState = 'idle';
        updateCanvasVisuals("Lesson Complete!", "Congratulations on finishing your learning path.");
        ui.nextSegmentButton.disabled = true;
        // Could add a "Start a new lesson" button here.
    }

    /**
     * Helper function to wrap text on the canvas.
     */
    function wrapText(text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n] + ' ';
            let metrics = canvasCtx.measureText(testLine);
            let testWidth = metrics.width;
            if (testWidth > maxWidth && n > 0) {
                canvasCtx.fillText(line, x, y);
                line = words[n] + ' ';
                y += lineHeight;
            } else {
                line = testLine;
            }
        }
        canvasCtx.fillText(line, x, y);
    }

    // --- INITIALIZATION --- //
    initializeUI();

    // It can take a moment for voices to load.
    speechSynthesis.onvoiceschanged = () => {
        console.log("Speech synthesis voices loaded.");
    };
});