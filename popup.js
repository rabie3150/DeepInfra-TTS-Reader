// popup.js

let voiceDescriptions = [];

async function fetchVoices() {
  try {
    const response = await fetch(chrome.runtime.getURL('voices.json'));
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    voiceDescriptions = await response.json();
    //console.log("Voices loaded:", voiceDescriptions.length);
  } catch (error) {
    console.error("Error loading voices.json:", error);
    setStatusMessage("Error loading voice list.", true);
    voiceDescriptions = [];
  }
}

function initLanguageSelector() {
  const languageSelector = document.getElementById("language-selector");
  languageSelector.innerHTML = ''; // Clear existing options

  if (!voiceDescriptions || voiceDescriptions.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No voices loaded";
    option.disabled = true;
    languageSelector.appendChild(option);
    return;
  }

  const languages = [...new Set(voiceDescriptions.map(voice => voice.language))]
                      .sort((a, b) => a.localeCompare(b)); // Simple sort

  languages.forEach(lang => {
    const option = document.createElement("option");
    option.value = lang;
    option.textContent = lang;
    languageSelector.appendChild(option);
  });
  //console.log("Languages populated:", languages.length);
}

function updateVoiceSelector(selectedVoiceCode = null) {
  const languageSelector = document.getElementById("language-selector");
  const voiceSelector = document.getElementById("voice-selector");
  const selectedLanguage = languageSelector.value;
  voiceSelector.innerHTML = ""; // Clear existing options

  if (!voiceDescriptions || voiceDescriptions.length === 0 || !selectedLanguage) {
     const option = document.createElement("option");
     option.textContent = "Select language first";
     option.disabled = true;
     voiceSelector.appendChild(option);
    return;
  }

  const filteredVoices = voiceDescriptions
      .filter(voice => voice.language === selectedLanguage)
      .sort((a, b) => a.title.localeCompare(b.title));

  if (filteredVoices.length === 0) {
     const option = document.createElement("option");
     option.textContent = "No voices for this language";
     option.disabled = true;
     voiceSelector.appendChild(option);
  } else {
    filteredVoices.forEach(voice => {
      const option = document.createElement("option");
      option.value = voice.code;
      option.textContent = voice.title; // Use the descriptive title
      // Pre-select if a voice code was passed
      if (selectedVoiceCode && voice.code === selectedVoiceCode) {
           option.selected = true;
      }
      voiceSelector.appendChild(option);
    });
  }
  //console.log(`Voices updated for ${selectedLanguage}:`, filteredVoices.length);
}

/**
 * Updates the visual state of the API details section based on the toggle.
 */
function updateApiDetailsVisibility() {
    const useApiKeyToggle = document.getElementById("use-api-key-toggle");
    const apiDetailsContent = document.getElementById("api-details-content");
    const apiTokenInput = document.getElementById("api-token");

    if (useApiKeyToggle.checked) {
        apiDetailsContent.classList.add('visible');
        apiTokenInput.disabled = false;
        // Optional: Focus input when revealed, but might be annoying
        // setTimeout(() => apiTokenInput.focus(), 310); // After transition
    } else {
        apiDetailsContent.classList.remove('visible');
        apiTokenInput.disabled = true;
    }
}

/**
 * Updates the background fill of the range slider based on its value.
 */
function updateRangeSliderFill(sliderElement) {
    if (!sliderElement) return;
    const min = parseFloat(sliderElement.min) || 0;
    const max = parseFloat(sliderElement.max) || 1;
    const value = parseFloat(sliderElement.value);
    const percentage = ((value - min) / (max - min)) * 100;
    sliderElement.style.setProperty('--value-percent', `${percentage}%`);
}


/**
 * Loads saved settings and updates UI controls.
 */
function loadSettings() {
    const useApiKeyToggle = document.getElementById("use-api-key-toggle");
    const apiTokenInput = document.getElementById("api-token");
    const speedInput = document.getElementById("speed-input");
    const speedValue = document.getElementById("speed-value");
    const formatSelector = document.getElementById("output-format");
    const languageSelector = document.getElementById("language-selector");
    const voiceSelector = document.getElementById("voice-selector");

    // --- Load API Token (local) ---
    chrome.storage.local.get(["apiToken"], (localResult) => {
        if (chrome.runtime.lastError) {
            console.error("Error loading API token:", chrome.runtime.lastError);
            setStatusMessage("Error loading API token.", true);
        } else if (localResult.apiToken) {
            apiTokenInput.value = localResult.apiToken;
             //console.log("API Token loaded from local storage.");
        }

        // --- Load Sync Settings (dependent on local token potentially loaded) ---
        const keysToGet = ["preset_voice", "speed", "output_format", "selected_language", "useApiKey"];
        chrome.storage.sync.get(keysToGet, (settings) => {
            if (chrome.runtime.lastError) {
                console.error("Error loading sync settings:", chrome.runtime.lastError);
                setStatusMessage("Error loading settings.", true);
                // Even on error, try to populate defaults/voice selector
                initLanguageSelector();
                updateVoiceSelector();
                 updateApiDetailsVisibility(); // Set initial visibility based on default/failed load
                updateRangeSliderFill(speedInput);
                return;
            }

            //console.log("Sync settings loaded:", settings);

            // Set API Key Toggle State
            const useApiKey = settings.useApiKey === true; // Default to false if undefined
            useApiKeyToggle.checked = useApiKey;
            updateApiDetailsVisibility(); // Update visibility based on loaded state

            // Set Speed
            speedInput.value = settings.speed ?? 1.0;
            speedValue.textContent = parseFloat(speedInput.value).toFixed(2);
            updateRangeSliderFill(speedInput); // Update slider visual fill

            // Set Output Format
            formatSelector.value = settings.output_format ?? "mp3";

            // Set Language and Voice
            const savedLang = settings.selected_language;
            const savedVoice = settings.preset_voice;

            initLanguageSelector(); // Initialize languages first

            // Select saved language if it exists in the list
            if (savedLang && [...languageSelector.options].some(opt => opt.value === savedLang)) {
                languageSelector.value = savedLang;
                //console.log("Saved language selected:", savedLang);
            } else if (savedVoice) {
                 // Fallback: Find language from saved voice if language wasn't saved/valid
                 const voice = voiceDescriptions.find(v => v.code === savedVoice);
                 if (voice && [...languageSelector.options].some(opt => opt.value === voice.language)) {
                     languageSelector.value = voice.language;
                      //console.log("Language derived from saved voice:", voice.language);
                 }
            } else {
                 //console.log("No valid saved language, using default.");
                 // Default language will be the first in the list
            }

            // Update voice list based on selected language and select saved voice
            updateVoiceSelector(savedVoice); // Pass saved voice code to pre-select

        }); // End chrome.storage.sync.get
    }); // End chrome.storage.local.get
}

/**
 * Saves settings from the UI to storage.
 */
function saveSettings() {
    const useApiKey = document.getElementById("use-api-key-toggle").checked;
    const apiToken = document.getElementById("api-token").value.trim();
    const preset_voice = document.getElementById("voice-selector").value;
    const speed = parseFloat(document.getElementById("speed-input").value);
    const output_format = document.getElementById("output-format").value;
    const selected_language = document.getElementById("language-selector").value;

    // Validate token only if the toggle is checked
    if (useApiKey && !apiToken) {
        setStatusMessage("API Token required when 'Use API Key' is enabled.", true);
        // Ensure details are visible and focus the input
        if (!document.getElementById("api-details-content").classList.contains('visible')) {
             updateApiDetailsVisibility(); // Show details if hidden
        }
        setTimeout(() => document.getElementById("api-token").focus(), 50); // Slight delay to ensure visible
        return;
    }

    // Save token to local storage
    chrome.storage.local.set({ apiToken }, (localResult) => {
        if (chrome.runtime.lastError) {
            console.error("Error saving API token:", chrome.runtime.lastError);
            setStatusMessage("Error saving API token!", true);
            // Don't proceed if local save fails? Maybe still save sync... depends on desired behavior.
            // Let's proceed for now.
        } else {
            //console.log("API Token saved locally.");
        }

        // Save other settings (including toggle state) to sync storage
        const syncSettings = { useApiKey, preset_voice, speed, output_format, selected_language };
        chrome.storage.sync.set(syncSettings, () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving sync settings:", chrome.runtime.lastError);
                setStatusMessage("Error saving settings!", true);
            } else {
                //console.log("Sync Settings saved:", syncSettings);
                setStatusMessage("Settings saved!", false, 'success'); // Use success class
            }
        });
    });
}

function setStatusMessage(message, isError = false, type = 'error') { // Added type parameter
    const statusDiv = document.getElementById("status-message");
    statusDiv.textContent = message;
    // Remove previous classes and add the correct one
    statusDiv.classList.remove('error', 'success');
    if (message) { // Only add class if there's a message
         statusDiv.classList.add(isError ? 'error' : type); // Use type ('success')
    }

    // Clear message after a delay
    if (statusDiv.timer) clearTimeout(statusDiv.timer); // Clear existing timer
    statusDiv.timer = setTimeout(() => {
        if (statusDiv.textContent === message) { // Avoid clearing newer messages
             statusDiv.textContent = '';
             statusDiv.classList.remove('error', 'success');
        }
    }, 3000);
}


// --- Event Listeners ---
document.addEventListener("DOMContentLoaded", async () => {
    // Get DOM elements
    const useApiKeyToggle = document.getElementById("use-api-key-toggle");
    const apiToggleClickable = document.getElementById("api-toggle-clickable");
    const languageSelector = document.getElementById("language-selector");
    const speedInput = document.getElementById("speed-input");
    const speedValue = document.getElementById("speed-value");
    const saveBtn = document.getElementById("save-btn");

    // --- Initial Setup ---
    await fetchVoices(); // Load voice data first
    loadSettings();      // Load settings which calls initLanguageSelector & updateVoiceSelector

    // --- Event Binding ---

    // API Key Toggle Functionality
    useApiKeyToggle.addEventListener("change", updateApiDetailsVisibility);
    // Allow clicking the whole toggle area
     apiToggleClickable.addEventListener("click", (e) => {
         // Prevent double-triggering if clicking directly on the checkbox itself
         if (e.target !== useApiKeyToggle) {
             useApiKeyToggle.checked = !useApiKeyToggle.checked;
             // Manually trigger the change event handler
             useApiKeyToggle.dispatchEvent(new Event('change'));
         }
     });


    // Language Selector Change
    languageSelector.addEventListener("change", () => {
        updateVoiceSelector(); // Update voice list when language changes
    });

    // Speed Slider Input
    speedInput.addEventListener("input", () => {
        speedValue.textContent = parseFloat(speedInput.value).toFixed(2);
        updateRangeSliderFill(speedInput); // Update visual fill
    });

    // Save Button Click
    saveBtn.addEventListener("click", saveSettings);

    //console.log("Popup UI Initialized");
});