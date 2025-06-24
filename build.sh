
#!/bin/bash

# Create a copy of script.js with environment variables injected
cp script.js script.js.template

# Replace placeholders with actual environment variables
sed -i "s/__GEMINI_API_KEY__/$GEMINI_API_KEY/g" script.js
sed -i "s/__YOUTUBE_API_KEY__/$YOUTUBE_API_KEY/g" script.js
sed -i "s/__CSE_ID__/$CSE_ID/g" script.js
sed -i "s/__SUPADATA_API_KEY__/$SUPADATA_API_KEY/g" script.js
sed -i "s/__GOOGLE_TTS_API_KEY__/$GOOGLE_TTS_API_KEY/g" script.js

echo "Environment variables injected into script.js"
