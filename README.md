# DeepInfra TTS Reader (Chrome Extension)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
<!-- Optional: Add a version badge if you tag releases -->
<!-- [![Release](https://img.shields.io/github/v/release/rabie3150/DeepInfra-TTS-Reader)](https://github.com/rabie3150/DeepInfra-TTS-Reader/releases/latest) -->

A Chrome extension that uses the [DeepInfra API](https://deepinfra.com/) (specifically the [Kokoro-82M model](https://deepinfra.com/hexgrad/Kokoro-82M)) to read web page text aloud. It features a convenient "Read From Here" context menu option, selected text reading, playback controls with visual highlighting, and audio caching.

## Key Features

*   **Read Selected Text:** Simply select text on a webpage, right-click, and choose "Read Selected Text".
*   **Read From Here:** Right-click near where you want to start reading on a page and choose "Read From Here". The extension attempts to identify the surrounding text block (like an article or section) and starts reading from your click point.
*   **DeepInfra TTS:** Utilizes the `hexgrad/Kokoro-82M` model hosted on DeepInfra for audio generation.
*   **Dual API Modes:**
    *   **Free Tier:** Works without an API key (using a public endpoint). Provides sentence-level highlighting based on duration estimation.
    *   **API Key (Premium):** Requires a DeepInfra API key (free or paid accounts). Enables **word-level highlighting** (if the API returns timestamps) and potentially offers better reliability or voice options depending on the DeepInfra service.
*   **Floating Playback Toolbar:** Appears during playback with controls for:
    *   Play / Pause (Spacebar shortcut)
    *   Stop (Escape key shortcut)
    *   Download Audio File (MP3, WAV, Opus, FLAC - based on settings)
    *   Volume Control Slider
    *   Playback Speed Slider
    *   Seekable Progress Bar
*   **Visual Highlighting:** Highlights the currently spoken word (API Key mode) or sentence (Free Tier mode) directly on the webpage.
*   **Configurable:** Extension popup allows setting:
    *   API Key Usage (toggle) & API Token Input
    *   Language & Voice Selection
    *   Playback Speed
    *   Audio Output Format
*   **Audio Caching:** Generated audio is cached locally in the browser to avoid repeated API calls for the same text and settings (uses an LRU strategy).



## How to Use

1.  **Install the Extension:** (See Installation instructions below).
2.  **(Optional) Configure Settings:** Click the extension icon in your Chrome toolbar to open the settings popup.
    *   To enable word-level highlighting and potentially better TTS, toggle **"Use API Key (Premium)"** on, paste your DeepInfra API token (get one [here](https://deepinfra.com/dash/api_keys)), and click **"Save Settings"**.
    *   Adjust Language, Voice, Speed, and Output Format as desired and click **"Save Settings"**.
3.  **Read Text:**
    *   **Selected Text:** Highlight the text you want to read, right-click on the selection, and choose **"Read Selected Text"**.
    *   **From a Point:** Right-click on or near the paragraph/sentence where you want reading to begin and choose **"Read From Here"**.
4.  **Control Playback:** Use the floating toolbar that appears at the bottom-right to control playback, adjust volume/speed, seek, or download the audio. Use `Spacebar` to toggle play/pause and `Escape` to stop.

## Installation

Since this extension is not (yet) on the Chrome Web Store, you need to load it manually:

1.  **Download:** Download or clone this repository to your local machine.
    ```bash
    git clone https://github.com/rabie3150/DeepInfra-TTS-Reader.git
    # or download the ZIP and extract it
    ```
2.  **Open Chrome Extensions:** Open Google Chrome, type `chrome://extensions` in the address bar, and press Enter.
3.  **Enable Developer Mode:** In the top-right corner of the Extensions page, toggle the **"Developer mode"** switch **ON**.
4.  **Load Unpacked:** Click the **"Load unpacked"** button that appears.
5.  **Select Directory:** In the file dialog, navigate to the directory where you downloaded/cloned the repository (the one containing the `manifest.json` file) and click **"Select Folder"**.

The extension should now appear in your list of extensions and be ready to use.

## Configuration Details

*   **API Key:**
    *   Using an API Key is recommended for the best experience (word highlighting).
    *   You can get an API key from your [DeepInfra Dashboard](https://deepinfra.com/dash/api_keys). Both free and paid DeepInfra accounts provide API keys.
    *   The token is stored securely in your browser's **local** storage (`chrome.storage.local`) and is *not* synced across devices.
*   **Other Settings:** Voice, language, speed, format, and the API key *toggle state* are stored using `chrome.storage.sync` and will sync across devices where you're logged into Chrome (if sync is enabled).

## Technology Used

*   Google Chrome Extension APIs (Manifest V3)
    *   `contextMenus`
    *   `storage` (sync and local)
    *   `scripting`
    *   `notifications`
    *   `runtime`
    *   `tabs`
*   JavaScript (ES6+ async/await)
*   Web Audio API (for playback control, volume, speed)
*   Fetch API (for calling DeepInfra)
*   HTML / CSS (for popup and toolbar)

## Known Issues / Limitations

*   **"Read From Here" Accuracy:** The logic to find the surrounding text block for "Read From Here" works well on many sites but might grab too much or too little text on pages with very complex or unusual structures.
*   **Highlighting:**
    *   Word highlighting requires the API Key mode and depends on DeepInfra providing accurate timestamps.
    *   Sentence highlighting (Free Tier) is an estimation based on word count and duration, so it might drift slightly.
    *   Highlighting might fail or become inaccurate if the webpage content changes dynamically *while* reading is in progress.
*   **Cache Limits:** The local cache has a size limit (`CACHE_LIMIT` in `background.js`). If you generate many large audio files, older items will be evicted. You might see quota errors in the background console if the browser's storage limit is hit unexpectedly.
*   **Content Script Injection:** The extension attempts to inject its content script (`content.js`) when needed. This might fail on certain pages (e.g., `chrome://` pages, other extension pages, pages with strict Content Security Policies) or if the extension permissions are revoked.

<!--
## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## Future Ideas

*   More sophisticated text block detection.
*   Keyboard shortcuts for more actions (e.g., speed up/down).
*   Option to clear the cache manually.
*   Support for other TTS providers/models.
-->

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file  or the statement below for details.

**MIT License**

Copyright (c) [2025] [Rabie/rabie3150]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
