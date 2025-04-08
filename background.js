// background.js

// --- Configuration ---
const FREE_API_URL = "https://api.deepinfra.com/v1/inference/hexgrad/Kokoro-82M?version=2f0893cb40f2ae8356e8e1f7463e52236425f5fd"; // Original URL for potential keyless access
const PAID_API_URL = "https://api.deepinfra.com/v1/inference/hexgrad/Kokoro-82M"; // Base URL for authenticated access

const CACHE_LIMIT = 15; // Max number of TTS items to cache
const CACHE_INDEX_KEY = 'tts_cache_index'; // Key to store the order of cached items

const DEFAULT_SETTINGS = {
  preset_voice: "am_liam",
  speed: 1.0,
  output_format: "mp3",
  apiToken: null,
  useApiKey: false // New setting: Default to free tier
};

// --- Initialization ---
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  } else if (details.reason === "update") {
      const currentSettings = await getSettings();
      const updatedSettings = {...DEFAULT_SETTINGS, ...currentSettings};
      await chrome.storage.sync.set(updatedSettings);
      await chrome.storage.local.set({ apiToken: updatedSettings.apiToken });
  }

  // Create TWO context menu items
  chrome.contextMenus.create({
    id: "readSelection",
    title: "Read Selected Text",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "readFromHere",
    title: "Read From Here",
    contexts: ["page", "frame"],
  });
});

// --- Event Listeners ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) {
    console.error("Context menu clicked, but no valid tab ID found.");
    return;
  }

  // Ensure Script and Get Context
  try {
    await ensureContentScriptInjected(tab.id);
    //console.log(`Content script ensured for tab ${tab.id} before handling menu item: ${info.menuItemId}`);
  } catch (injectionError) {
    console.error(`Failed to ensure content script on tab ${tab.id}:`, injectionError);
    showErrorNotification("Error", `Cannot execute action on this page: ${injectionError.message}`);
    return;
  }

  // Handle different menu items
  if (info.menuItemId === "readSelection" && info.selectionText) {
    //console.log("Context menu: readSelection");
    processText(info.selectionText, tab); // No specific start index needed

  } else if (info.menuItemId === "readFromHere") {
    //console.log("Context menu: readFromHere");
    let clickData = null;
    try {
      clickData = await sendMessageToTab(tab.id, { action: "getClickData" });
      //console.log("Background received clickData:", clickData);

      if (clickData?.fullText && clickData.fullText.trim() !== "" && typeof clickData.totalCharOffset === 'number') {
        const startWordIndex = findWordIndexAtOffset(clickData.fullText, clickData.totalCharOffset);
        //console.log(`Calculated startWordIndex: ${startWordIndex} for char offset: ${clickData.totalCharOffset}`);
        processText(clickData.fullText, tab, startWordIndex);
      } else {
        console.warn("readFromHere executed, but no valid text/offset found in clickData.", clickData);
        showErrorNotification("Info", "Could not find specific text to read. Try selecting text.");
      }

    } catch (err) {
      console.error("Error getting click data from content script:", err);
      const message = err.message.includes("Could not establish connection")
        ? "Could not communicate with the page. Reload and try again."
        : "Could not get right-click context.";
      showErrorNotification("Error", message);
    }
  }
});


// --- Core Logic ---

/**
* Processes text for TTS, potentially starting from a specific word index.
* @param {string} text - The full text to synthesize.
* @param {chrome.tabs.Tab} tab - The target tab.
* @param {number} [startWordIndex=-1] - Optional index of the word to start playback from.
*/
async function processText(text, tab, startWordIndex = -1) {
  if (!tab?.id || !text || text.trim() === "") {
    console.error("processText called with invalid tab or empty text.");
    return;
  }
  text = text.trim();

  try {

    const settings = await getSettings();
    if (settings.useApiKey && !settings.apiToken) {
      throw new Error("API Token required but not set.");
    }

    const cacheKey = generateCacheKey(text, settings);
    let cachedData = await getCachedTTSData(cacheKey);
    let audioDataUrl, wordsData = null;

    if (cachedData) {
      audioDataUrl = cachedData.audioDataUrl;
      wordsData = cachedData.wordsData;
      //console.log(`Using cached TTS (Mode: ${settings.useApiKey ? 'Paid' : 'Free'}) Key: ${cacheKey}`);
    } else {
      //console.log(`Fetching new TTS (Mode: ${settings.useApiKey ? 'Paid' : 'Free'}) Key: ${cacheKey}`);
      // Fetch directly
      const ttsResult = await fetchTTS(text, settings);
      audioDataUrl = ttsResult.audioDataUrl;
      wordsData = ttsResult.words;
      await cacheTTSData(cacheKey, { audioDataUrl, wordsData });
    }

    // Ensure content script is ready (important!)
    await ensureContentScriptInjected(tab.id);

    // Send data to content script for playback
    await sendMessageToTab(tab.id, {
      action: "playAudio",
      audioUrl: audioDataUrl,
      words: wordsData,
      text: text,
      speed: settings.speed,
      startWordIndex: startWordIndex
    });

  } catch (error) {
    console.error("Error in processText:", error);
    const errorMessage = error.message || "An unknown error occurred.";
    showErrorNotification("TTS Error", errorMessage);
  }
}


async function ensureContentScriptInjected(tabId) {
  // Same implementation as before
  return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
    if (chrome.runtime.lastError) {
              //console.log("Content script ping failed, attempting injection.", chrome.runtime.lastError.message);
      chrome.scripting.executeScript({
                  target: { tabId: tabId },
        files: ["content.js"]
              }, (injectionResults) => {
        if (chrome.runtime.lastError) {
                      console.error(`Injection failed for tab ${tabId}:`, chrome.runtime.lastError.message);
                       if (chrome.runtime.lastError.message.includes("Cannot access") || chrome.runtime.lastError.message.includes("permissions")) {
                           reject(new Error(`Cannot inject script into this page (${tabId}). Extension might lack permissions for this URL.`));
                       } else {
                          reject(new Error(`Failed to inject content script: ${chrome.runtime.lastError.message}`));
                       }
                  } else if (!injectionResults || injectionResults.length === 0) {
                       console.warn(`Injection attempt for tab ${tabId} succeeded but no results returned. Assuming success.`);
                       setTimeout(resolve, 150);
                  } else {
                      //console.log(`Content script injected successfully into tab ${tabId}.`);
                       setTimeout(resolve, 150);
                  }
              });
          } else if (response?.status === "ok") {
          resolve();
        } else {
               console.warn(`Ping response not 'ok' for tab ${tabId}, assuming script is present.`);
               resolve(); // Assume ok if ping fails but no lastError (script might be there but unresponsive temporarily)
        }
      });
  });
}


function sendMessageToTab(tabId, message) {
  // Same implementation as before
   return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
              console.error("Error sending message to tab:", tabId, message.action, chrome.runtime.lastError.message);
              reject(new Error(`Failed to send message to content script: ${chrome.runtime.lastError.message}`));
            } else {
              resolve(response);
            }
        });
    });
}


async function fetchTTS(text, settings) {
  // Same implementation as before (fetch logic unchanged)
  const { apiToken, preset_voice, speed, output_format, useApiKey } = settings;
  let apiUrl;
  let headers = { "Content-Type": "application/json" };
  let payload = {};
  let actualOutputFormat = output_format || "mp3";

  if (useApiKey && apiToken) {
    //console.log("Using Paid Tier API Call");
    apiUrl = PAID_API_URL;
    headers["Authorization"] = `bearer ${apiToken}`;
    payload = { text, output_format: actualOutputFormat, preset_voice: [preset_voice || "am_liam"], speed: speed || 1.0, return_timestamps: true };
  } else {
     if (useApiKey && !apiToken) { throw new Error("API Token required but missing."); }
     //console.log("Using Free Tier API Call");
     apiUrl = FREE_API_URL;
     payload = { text, output_format: actualOutputFormat, preset_voice: Array.isArray(preset_voice) ? preset_voice[0] : (preset_voice || "am_liam"), speed: speed || 1.0 };
  }

  //console.log("API URL:", apiUrl);
  //console.log("Payload:", JSON.stringify(payload).substring(0, 200) + "...");

  let response;
  try {
    response = await fetch(apiUrl, { method: "POST", headers: headers, body: JSON.stringify(payload) });
  } catch (networkError) {
    console.error("Network error fetching TTS:", networkError);
    throw new Error(`Network error: ${networkError.message}`);
  }

  if (!response.ok) {
      let errorBody = "Could not read error response.";
      try { errorBody = await response.text(); } catch (e) { /* ignore */}
      console.error(`API Error: ${response.status} ${response.statusText}. Response: ${errorBody.substring(0, 500)}`);
      let message = `API request failed (${response.status}).`;
       if (response.headers.get("content-type")?.includes("application/json")) {
           try {
               const errorJson = JSON.parse(errorBody);
               message = errorJson.message || errorJson.detail || message;
               if (response.status === 401) message = "Authentication failed. Check your API token.";
           } catch(e) {/* ignore parsing error */}
       } else if (response.status === 401) { message = "Authentication failed. Check your API token.";
       } else if (response.status === 429) { message = "Rate limit exceeded. Please try again later."; }
      throw new Error(message);
  }

  const data = await response.json();
  if (!data.audio) { throw new Error("Invalid response from API: Missing audio data."); }

  let base64AudioData = data.audio;
  if (typeof base64AudioData === 'string' && base64AudioData.startsWith('data:')) {
      const commaIndex = base64AudioData.indexOf(',');
      base64AudioData = commaIndex !== -1 ? base64AudioData.substring(commaIndex + 1) : base64AudioData;
  }
  const audioDataUrl = `data:audio/${actualOutputFormat};base64,${base64AudioData}`;
  const words = data.words || null;
  if (useApiKey && !words) { console.warn("Requested timestamps in Paid Tier, but not received."); }
  return { audioDataUrl, words };
}

// --- Settings ---
function getSettings() { // Same implementation
  return new Promise((resolve) => {
    chrome.storage.local.get(["apiToken"], (localResult) => {
      chrome.storage.sync.get(["preset_voice", "speed", "output_format", "useApiKey", "selected_language"], (syncResult) => {
          resolve({ ...DEFAULT_SETTINGS, ...syncResult, apiToken: localResult.apiToken || null });
        }
      );
    });
  });
}

// --- Caching ---
function generateCacheKey(text, settings) { // Same implementation
  const hash = (str) => { let h=5381; for(let i=0;i<str.length;i++) h=(h*33)^str.charCodeAt(i); return h>>>0; };
  const textHash = hash(text.substring(0, 5000));
  const mode = settings.useApiKey ? 'paid' : 'free';
  return `tts_${mode}_${settings.preset_voice}_${settings.speed}_${settings.output_format}_${textHash}`;
}

/**
 * Retrieves cached TTS data and updates its position in the LRU index.
 * @param {string} key The cache key.
 * @returns {Promise<object|null>} The cached data { audioDataUrl, wordsData } or null.
 */
async function getCachedTTSData(key) {
  try {
      const result = await chrome.storage.local.get([key, CACHE_INDEX_KEY]);
      const cacheIndex = result[CACHE_INDEX_KEY] || [];
      const cachedItem = result[key];

      if (cachedItem) {
          //console.log("Cache hit:", key);
          // Move key to the end (most recently used)
          const keyIndex = cacheIndex.indexOf(key);
          if (keyIndex > -1) {
              cacheIndex.splice(keyIndex, 1); // Remove from current position
          }
          cacheIndex.push(key); // Add to end
          // Save the updated index asynchronously (fire and forget is okay here)
          chrome.storage.local.set({ [CACHE_INDEX_KEY]: cacheIndex }).catch(err => {
              console.warn("Failed to update cache index on get:", err);
          });
          return cachedItem; // { audioDataUrl, wordsData }
      } else {
          //console.log("Cache miss:", key);
          return null;
      }
  } catch (error) {
      console.error("Error getting cache:", error);
      return null;
  }
}

/**
 * Caches TTS data, managing the LRU index and enforcing size limits.
 * @param {string} key The cache key.
 * @param {object} data The data to cache { audioDataUrl, wordsData }.
 * @returns {Promise<void>}
 */
async function cacheTTSData(key, data) {
  try {
      const getResult = await chrome.storage.local.get(CACHE_INDEX_KEY);
      let cacheIndex = getResult[CACHE_INDEX_KEY] || [];
      let itemsToRemove = [];

      // Remove existing entry to move it to the end
      const existingIndex = cacheIndex.indexOf(key);
      if (existingIndex > -1) {
          cacheIndex.splice(existingIndex, 1);
      }

      // Add new key to the end (most recently used)
      cacheIndex.push(key);

      // Check if cache exceeds limit
      if (cacheIndex.length > CACHE_LIMIT) {
          const overflow = cacheIndex.length - CACHE_LIMIT;
          // Get the oldest keys to remove
          itemsToRemove = cacheIndex.splice(0, overflow); // Remove from the beginning
          //console.log(`Cache limit exceeded. Evicting ${overflow} items:`, itemsToRemove);
      }

      // Prepare data to save (new item + updated index)
      const dataToSet = {
          [key]: data,
          [CACHE_INDEX_KEY]: cacheIndex
      };

      // Set the new item and updated index
      await chrome.storage.local.set(dataToSet);
      //console.log("Cached data and updated index under key:", key);

      // Remove the evicted items' data (if any)
      if (itemsToRemove.length > 0) {
          await chrome.storage.local.remove(itemsToRemove);
          //console.log("Evicted items removed from storage.");
      }

  } catch (error) {
      console.error("Error setting cache:", error);
      // Don't reject, but log the error. Caching failure shouldn't stop TTS.
      // Check for specific quota error
      if (error.message && error.message.includes("QUOTA_BYTES")) {
           console.error("CACHE QUOTA EXCEEDED! Cannot store item:", key);
           // Potentially notify the user or try more aggressive eviction?
           // For now, just log it. The LRU should prevent this most times.

           // showErrorNotification("Cache Warning", "Storage limit reached. Older audio cache items were removed.");
           
           // As a fallback, try removing the oldest item again if set failed
           try {
               const getResult = await chrome.storage.local.get(CACHE_INDEX_KEY);
               let fallbackIndex = getResult[CACHE_INDEX_KEY] || [];
               if (fallbackIndex.length > 0) {
                    const oldestKey = fallbackIndex.shift();
                    await chrome.storage.local.remove(oldestKey);
                    await chrome.storage.local.set({ [CACHE_INDEX_KEY]: fallbackIndex });
                    //console.log("Fallback eviction performed for key:", oldestKey);
               }
           } catch (fallbackError) {
                console.error("Error during fallback cache eviction:", fallbackError);
           }
      } else {
           // Rethrow other unexpected storage errors? For now, just log.
           // throw new Error(`Failed to cache data: ${error.message}`);
      }
  }
}

// --- Utility ---
function showErrorNotification(title, message) { // Same implementation
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon48.png", title: title, message: message, priority: 1 });
}

function findWordIndexAtOffset(text, offset) { // Same implementation
  if (offset < 0 || !text) return -1;
  offset = Math.min(offset, text.length);
  if (offset === 0) return 0;
  const wordRegex = /\S+/g;
  let match; let wordIndex = 0; let lastWordEnd = 0;
  while ((match = wordRegex.exec(text)) !== null) {
      const wordStart = match.index; const wordEnd = wordStart + match[0].length;
      if (offset > lastWordEnd && offset <= wordEnd) { return wordIndex; }
      if (offset === wordStart) { return wordIndex; }
      wordIndex++; lastWordEnd = wordEnd;
  }
  if (offset > lastWordEnd && wordIndex > 0) { return wordIndex - 1; }
  return 0;
}