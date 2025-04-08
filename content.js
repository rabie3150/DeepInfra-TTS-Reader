// content.js

// --- Global State ---
let currentAudioContext = null;
let currentSource = null;
let currentAudioBuffer = null;
let gainNode = null;
let playbackStartTime = 0;
let pauseOffset = 0;
let totalDuration = 0;
let currentPlaybackRate = 1.0;
let highlightAnimationFrame = null;
let progressAnimationFrame = null;
let floatingToolbar = null; // Reference to the toolbar DOM element
let ttsState = "idle"; // "idle", "playing", "paused"
let lastRightClickData = null;
let currentAudioDataUrl = null; // To store the data URL for download
let currentAudioFormat = 'mp3'; // Default format, updated from data URL

// --- Data for Highlighting ---
let currentText = "";
let currentWords = [];
let currentSentenceTimings = [];
let currentHighlightMode = 'none';
let currentHighlightIndex = -1;
let lastSpokenIndex = -1;

// --- Constants ---
const SHORTCUTS = { toggle: 'Space', stop: 'Escape' };
const READING_CONTAINER_TAGS = ['article', 'main', 'section'];
const RELEVANT_BLOCK_TAGS = ['p', 'div', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre'];
const ALL_RELEVANT_TAGS = [...READING_CONTAINER_TAGS, ...RELEVANT_BLOCK_TAGS];
const BOUNDARY_TAGS = ['footer', 'nav', 'aside', 'header', 'form'];
const HIGHLIGHT_STYLE = {
    backgroundColor: "orange", color: "black", borderRadius: "3px",
    boxDecorationBreak: "clone", webkitBoxDecorationBreak: "clone",
    padding: "0.1em 0", margin: "-0.1em 0",
};
const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>'
};


// --- Event Listeners & Message Handling ---

document.addEventListener('contextmenu', (event) => { // Same sibling logic as before
    const targetElement = event.target;
    let clickedReadingElement = findNearestReadableElement(targetElement);
    if (!clickedReadingElement) { lastRightClickData = null; return; }
    const parentElement = clickedReadingElement.parentElement;
    if (!parentElement) { lastRightClickData = null; return; }

    const { fullText, offsetOfStartElement } = getTextFromSiblings(clickedReadingElement, parentElement);
    if (fullText && fullText.trim().length > 0 && offsetOfStartElement !== -1) {
        const clickOffsetInClickedElement = getClickOffsetInElement(event, clickedReadingElement);
        const totalCharOffset = offsetOfStartElement + clickOffsetInClickedElement;
        lastRightClickData = { fullText, totalCharOffset, timestamp: Date.now() };
        //console.log(`Stored right-click data: Offset=${totalCharOffset}, Text length=${fullText.length}`);
        return;
    }
    lastRightClickData = null;
}, true);

function handleKeyDown(e) {
  const tag = e.target.tagName.toLowerCase();
  const isEditable = e.target.isContentEditable;
  if (tag === 'input' || tag === 'textarea' || isEditable || e.target.closest('#tts-floating-toolbar')) return;
  if (e.code === SHORTCUTS.toggle) { e.preventDefault(); togglePauseResume(); }
  else if (e.code === SHORTCUTS.stop) { e.preventDefault(); stopAudio(); }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    //console.log("Content script received message:", request.action);
    switch (request.action) {
      case "ping":
        sendResponse({ status: "ok" });
        break;
      case "playAudio":

      currentPlaybackRate = request.speed || 1.0;
        // playAudio is now async, but we don't need to await it here
        playAudio(request.audioUrl, request.text, request.words, request.startWordIndex);
        sendResponse({ status: "received" });
        break;
      case "ttsError":
        console.error("Received TTS Error:", request.message);
        showTemporaryMessage("TTS Error: " + request.message, true);

        stopAudio(); // stopAudio is async, but don't need to await here
        sendResponse({ status: "error_received" });
        break;
      case "getClickData":
        //console.log("Sending click data to background:", lastRightClickData);
        sendResponse(lastRightClickData);
        break;

        default:
          //console.log("Unknown message action:", request.action);
          sendResponse({ status: "unknown_action" });
          break;
    }
    // Keep channel open for async responses (important for getClickData)
    return ["getClickData"].includes(request.action); // Only getClickData might need it now
});


// --- Context Extraction Helpers ---
// findNearestReadableElement, getTextFromSiblings, getVisibleTextContent,
// getClickOffsetInElement, getRangeFromPoint, getTextContentFromRange,
// filterVisibleNodesInRange - KEEP ALL THESE AS THEY WERE IN THE PREVIOUS VERSION
// They are complex but necessary for the "read from siblings" logic.
// (Copy-paste the implementations from the previous version if needed)
function findNearestReadableElement(startElement) {
    let current = startElement;
    while (current && current !== document.body) {
        const tagName = current.tagName.toLowerCase();
        if (ALL_RELEVANT_TAGS.includes(tagName)) {
            const style = window.getComputedStyle(current);
            if (style.display !== 'none' && style.visibility !== 'hidden' && current.textContent.trim().length > 0) {
                 const rect = current.getBoundingClientRect();
                 if (rect.width > 0 || rect.height > 0) { return current; }
            }
        }
        current = current.parentElement;
    }
    return null;
}
function getTextFromSiblings(startElement, parentElement) {
    let fullText = '';
    let offsetOfStartElement = -1;
    let foundStartElement = false;
    const childNodes = Array.from(parentElement.childNodes);
    let nodeIndex = childNodes.indexOf(startElement);

    if (nodeIndex === -1) {
         let tempCurrent = startElement;
         while (tempCurrent && tempCurrent.parentElement !== parentElement) { tempCurrent = tempCurrent.parentElement; }
         if (tempCurrent && tempCurrent.parentElement === parentElement) { nodeIndex = childNodes.indexOf(tempCurrent); startElement = tempCurrent; }
         else { console.error("Cannot locate start element relative to parent."); return { fullText: '', offsetOfStartElement: -1 }; }
    }

    for (let i = nodeIndex; i < childNodes.length; i++) {
        const node = childNodes[i];
        let elementText = '';
        let isRelevantBlock = false;

        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            const style = window.getComputedStyle(node);
            if (!ALL_RELEVANT_TAGS.includes(tagName) || BOUNDARY_TAGS.includes(tagName) || style.display === 'none' || style.visibility === 'hidden' || node.closest('#tts-floating-toolbar')) {
                if (BOUNDARY_TAGS.includes(tagName)) { break; } continue;
            }
            isRelevantBlock = RELEVANT_BLOCK_TAGS.includes(tagName) || tagName === 'br';
            elementText = getVisibleTextContent(node).trim();
        } else if (node.nodeType === Node.TEXT_NODE) {
             const parentStyle = window.getComputedStyle(parentElement);
             if (parentStyle.display !== 'none' && parentStyle.visibility !== 'hidden') { elementText = node.nodeValue.replace(/\s+/g, ' ').trim(); }
        }

        if (elementText) {
            if (node === startElement && !foundStartElement) { offsetOfStartElement = fullText.length; foundStartElement = true; }
            if (fullText.length > 0 && !/\n\n$/.test(fullText)) {
                 if (isRelevantBlock || node.nodeType === Node.TEXT_NODE) {
                      fullText += '\n\n'; if (foundStartElement && offsetOfStartElement === fullText.length - 2) { offsetOfStartElement = fullText.length; }
                 } else if (!/\s$/.test(fullText)) { fullText += ' '; if (foundStartElement && offsetOfStartElement === fullText.length - 1) { offsetOfStartElement = fullText.length; } }
            }
            fullText += elementText;
        }
    }
    if (foundStartElement && offsetOfStartElement === -1) { offsetOfStartElement = 0; }
    return { fullText: fullText.trim(), offsetOfStartElement };
}
function getVisibleTextContent(element) {
    let text = '';
    const nodeFilter = NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT;
    const rootNode = element;
    const walker = document.createTreeWalker(rootNode, nodeFilter, {
        acceptNode: function(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(node); const tagName = node.tagName.toLowerCase();
                if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0 || tagName === 'script' || tagName === 'style' || tagName === 'noscript' || node.closest('#tts-floating-toolbar') || node.getAttribute('aria-hidden') === 'true') { return NodeFilter.FILTER_REJECT; }
                 if (RELEVANT_BLOCK_TAGS.includes(tagName) || tagName === 'br') { if (text.length > 0 && !/\s*\n\n$/.test(text) && !text.endsWith('\n')) { text += '\n\n'; } }
            } else if (node.nodeType === Node.TEXT_NODE) {
                if (!node.parentElement) return NodeFilter.FILTER_REJECT;
                const parentStyle = window.getComputedStyle(node.parentElement);
                if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden' || parseFloat(parentStyle.opacity || '1') === 0) { return NodeFilter.FILTER_REJECT; }
                if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let currentNode;
    while (currentNode = walker.nextNode()) {
        if (currentNode.nodeType === Node.TEXT_NODE) {
            let processedText = currentNode.nodeValue.replace(/\s+/g, ' ');
            if (text.length > 0 && !/\s$/.test(text) && !/^\s/.test(processedText)) text += ' ';
            else if (/^\s/.test(processedText) && /\s$/.test(text)) processedText = processedText.trimStart();
            text += processedText.trimEnd();
        }
    }
    return text.replace(/(\n\s*){3,}/g, '\n\n').trim();
}
function getClickOffsetInElement(event, element) {
    try {
        const range = getRangeFromPoint(event);
        if (range && element.contains(range.startContainer)) {
            const elementRange = document.createRange(); elementRange.selectNodeContents(element);
            if (elementRange.comparePoint(range.startContainer, range.startOffset) > -1) { elementRange.setEnd(range.startContainer, range.startOffset); }
            else { return 0; }
            const textBeforeClick = getTextContentFromRange(elementRange); return textBeforeClick.length;
        }
    } catch (e) { console.warn("Error calculating click offset:", e); }
    return 0;
}
function getRangeFromPoint(event) {
    let range = null;
    if (document.caretRangeFromPoint) { range = document.caretRangeFromPoint(event.clientX, event.clientY); }
    else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
        if (pos && pos.offsetNode) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
    }
    return range;
}
function getTextContentFromRange(range) {
    let text = ''; const root = range.commonAncestorContainer; const nodeFilter = NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT;
    const walker = document.createTreeWalker(root, nodeFilter, { acceptNode: node => filterVisibleNodesInRange(node, range) });
    let currentNode;
    while (currentNode = walker.nextNode()) {
        if (currentNode.nodeType === Node.TEXT_NODE) {
            const nodeRange = document.createRange(); nodeRange.selectNode(currentNode); let textToAdd = '';
            const startContainer = range.startContainer; const startOffset = range.startOffset; const endContainer = range.endContainer; const endOffset = range.endOffset; const nodeValue = currentNode.nodeValue;
            let effectiveStart = 0; if (startContainer === currentNode) { effectiveStart = Math.min(startOffset, nodeValue.length); } else if (nodeRange.compareBoundaryPoints(Range.START_TO_START, range) < 0) { effectiveStart = 0; } else { effectiveStart = 0; }
            let effectiveEnd = nodeValue.length; if (endContainer === currentNode) { effectiveEnd = Math.min(endOffset, nodeValue.length); } else if (nodeRange.compareBoundaryPoints(Range.END_TO_END, range) > 0) { effectiveEnd = nodeValue.length; } else { effectiveEnd = nodeValue.length; }
            effectiveStart = Math.min(effectiveStart, effectiveEnd);
             if (nodeRange.compareBoundaryPoints(Range.START_TO_END, range) < 0 && nodeRange.compareBoundaryPoints(Range.END_TO_START, range) > 0) { textToAdd = nodeValue.substring(effectiveStart, effectiveEnd); }
            if (textToAdd) {
                let processedText = textToAdd.replace(/\s+/g, ' '); if (text.length > 0 && !/\s$/.test(text) && !/^\s/.test(processedText)) text += ' '; else if (/^\s/.test(processedText) && /\s$/.test(text)) processedText = processedText.trimStart(); text += processedText.trimEnd();
            }
        } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
             const tagName = currentNode.tagName.toLowerCase(); const elementRange = document.createRange(); elementRange.selectNode(currentNode);
             if (range.compareBoundaryPoints(Range.START_TO_START, elementRange) <= 0 && range.compareBoundaryPoints(Range.END_TO_START, elementRange) > 0) { if ((RELEVANT_BLOCK_TAGS.includes(tagName) || tagName === 'br')) { if (text.length > 0 && !/\s*\n\n$/.test(text) && !text.endsWith('\n')) { text += '\n\n'; } } }
        }
    }
    return text.replace(/(\n\s*){3,}/g, '\n\n').trim();
}
function filterVisibleNodesInRange(node, range) {
    if (node.nodeType === Node.ELEMENT_NODE) {
        const style = window.getComputedStyle(node); const tagName = node.tagName.toLowerCase();
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0 || tagName === 'script' || tagName === 'style' || tagName === 'noscript' || node.closest('#tts-floating-toolbar') || node.getAttribute('aria-hidden') === 'true') { return NodeFilter.FILTER_REJECT; }
        if (range.intersectsNode(node)) return NodeFilter.FILTER_ACCEPT; const elementRange = document.createRange(); elementRange.selectNode(node); if (elementRange.compareBoundaryPoints(Range.END_TO_START, range) < 0) return NodeFilter.FILTER_ACCEPT; return NodeFilter.FILTER_REJECT;
    } else if (node.nodeType === Node.TEXT_NODE) {
        if (!node.parentElement || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT; const parentStyle = window.getComputedStyle(node.parentElement); if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden' || parseFloat(parentStyle.opacity || '1') === 0) { return NodeFilter.FILTER_REJECT; }
        if (range.intersectsNode(node)) return NodeFilter.FILTER_ACCEPT; const nodeRange = document.createRange(); nodeRange.selectNode(node); if (nodeRange.compareBoundaryPoints(Range.END_TO_START, range) < 0) return NodeFilter.FILTER_ACCEPT; return NodeFilter.FILTER_REJECT;
    }
    return NodeFilter.FILTER_SKIP;
}



// --- Highlighting Logic ---
// findTextRange, highlightRange, removeHighlight, calculateSentenceTimings - KEEP THESE
// startHighlightLoop, updateWordHighlightLoop, updateSentenceHighlightLoop - KEEP THESE
// (Implementations are unchanged from previous version)

function findTextRange(textToFind) {
    const searchText = textToFind?.trim(); if (!searchText) return null; const searchTextNormalized = searchText.replace(/\s+/g, ' ');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: function(node) { /* ... visibility filters ... */ const parent = node.parentNode; if (!parent || parent.closest('#tts-floating-toolbar')) { return NodeFilter.FILTER_REJECT; } const style = window.getComputedStyle(parent); if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0 || parent.tagName.toLowerCase() === 'script' || parent.tagName.toLowerCase() === 'style') { return NodeFilter.FILTER_REJECT; } const nodeTextNormalized = node.nodeValue.replace(/\s+/g, ' '); if (nodeTextNormalized.includes(searchTextNormalized)) { return NodeFilter.FILTER_ACCEPT; } return NodeFilter.FILTER_SKIP; } });
    let node;
    while (node = walker.nextNode()) {
        const nodeText = node.nodeValue; const nodeTextNormalized = nodeText.replace(/\s+/g, ' '); let index = -1; let matchLength = -1; let currentSearchIndex = 0;
        while(currentSearchIndex < nodeTextNormalized.length) {
             const potentialIndex = nodeTextNormalized.indexOf(searchTextNormalized, currentSearchIndex); if (potentialIndex === -1) break;
             let originalStartIndex = -1; let normalizedCharsCounted = 0; let originalCharsCounted = 0; while(originalCharsCounted < nodeText.length && normalizedCharsCounted < potentialIndex) { if (!/\s/.test(nodeText[originalCharsCounted])) { normalizedCharsCounted++; } originalCharsCounted++; } while (originalCharsCounted < nodeText.length && /\s/.test(nodeText[originalCharsCounted])) { originalCharsCounted++; } originalStartIndex = originalCharsCounted;
             let originalEndIndex = originalStartIndex; let matchCharsFound = 0; const targetMatchChars = searchTextNormalized.replace(/\s+/g, '').length; while(originalEndIndex < nodeText.length && matchCharsFound < targetMatchChars) { if(!/\s/.test(nodeText[originalEndIndex])) { matchCharsFound++; } originalEndIndex++; }
             if (matchCharsFound === targetMatchChars) { index = originalStartIndex; matchLength = originalEndIndex - originalStartIndex; break; }
             else { console.warn(`Normalized match failed mapping for "${searchTextNormalized}"`); currentSearchIndex = potentialIndex + 1; }
        }
        if (index !== -1 && matchLength > 0) {
            const range = document.createRange();
            try {
                range.setStart(node, index); range.setEnd(node, index + matchLength); const rect = range.getBoundingClientRect();
                if (rect.width > 0 || rect.height > 0 || rect.top !== 0 || rect.left !== 0) { const parentStyle = window.getComputedStyle(node.parentNode || document.body); if (parentStyle.display !== 'none' && parentStyle.visibility !== 'hidden') { return range; } }
            } catch (e) { console.warn("Error creating range:", e); }
        }
    }
    console.warn(`Could not find visible range for: "${searchText}"`); return null;
}
const highlightRange = (range) => { removeHighlight(); if (!range) return; try { const span = document.createElement("span"); span.className = "tts-highlight"; Object.assign(span.style, HIGHLIGHT_STYLE); span.appendChild(range.extractContents()); range.insertNode(span); const rect = span.getBoundingClientRect(); if (rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth) { span.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } } catch (error) { console.error("Error applying highlight:", error); removeHighlight(); } };
const removeHighlight = () => { const h = document.querySelectorAll("span.tts-highlight"); h.forEach(s => { const p = s.parentNode; if (!p) return; while (s.firstChild) { p.insertBefore(s.firstChild, s); } try { p.removeChild(s); p.normalize(); } catch(e) { console.warn("Minor error removing highlight span:", e); } }); currentHighlightIndex = -1; };
function calculateSentenceTimings(text, duration) { currentSentenceTimings = []; if (!text || duration <= 0) return; const sentences = text.match(/([^\.!\?]+[\.!\?]+)|([^\.!\?]+$)/g) || [text]; const totalWords = text.split(/\s+/).filter(Boolean).length; if (totalWords === 0) return; let currentTime = 0; sentences.forEach(sentence => { const sentenceText = sentence.trim(); if (!sentenceText) return; const wordCount = sentenceText.split(/\s+/).filter(Boolean).length; const sentenceDuration = totalWords > 0 ? (wordCount / totalWords) * duration : 0; const endTime = currentTime + sentenceDuration; currentSentenceTimings.push({ sentence: sentenceText, start: currentTime, end: endTime }); currentTime = endTime; }); if (currentSentenceTimings.length > 0) { currentSentenceTimings[currentSentenceTimings.length - 1].end = duration; } }
function startHighlightLoop() { if (highlightAnimationFrame) { cancelAnimationFrame(highlightAnimationFrame); } if (ttsState !== 'playing') return; if (currentHighlightMode === 'word') { highlightAnimationFrame = requestAnimationFrame(updateWordHighlightLoop); } else if (currentHighlightMode === 'sentence') { highlightAnimationFrame = requestAnimationFrame(updateSentenceHighlightLoop); } else { highlightAnimationFrame = null; } }
function updateWordHighlightLoop() { if (ttsState !== 'playing' || !currentAudioContext || currentHighlightMode !== 'word' || !currentWords.length) { highlightAnimationFrame = null; return; } const elapsed = pauseOffset + (currentAudioContext.currentTime - playbackStartTime); let activeWordIndex = -1; for (let i = 0; i < currentWords.length; i++) { const wordStartTime = currentWords[i].start; const nextWordStartTime = (i === currentWords.length - 1) ? totalDuration : currentWords[i+1].start; const endTimeBuffer = (i === currentWords.length - 1) ? totalDuration + 0.1 : nextWordStartTime; if (elapsed >= wordStartTime && elapsed < endTimeBuffer) { activeWordIndex = i; break; } if (i === 0 && elapsed < wordStartTime) { activeWordIndex = -1; break; } } if (activeWordIndex !== currentHighlightIndex) { if (activeWordIndex !== -1) { const wordInfo = currentWords[activeWordIndex]; if (wordInfo?.text) { const range = findTextRange(wordInfo.text); highlightRange(range); } else { removeHighlight(); } } else { removeHighlight(); } currentHighlightIndex = activeWordIndex; } lastSpokenIndex = activeWordIndex; if (elapsed < totalDuration) { highlightAnimationFrame = requestAnimationFrame(updateWordHighlightLoop); } else { highlightAnimationFrame = null; } }
function updateSentenceHighlightLoop() { if (ttsState !== 'playing' || !currentAudioContext || currentHighlightMode !== 'sentence' || !currentSentenceTimings.length) { highlightAnimationFrame = null; return; } const elapsed = pauseOffset + (currentAudioContext.currentTime - playbackStartTime); let activeSentenceIndex = -1; for (let i = 0; i < currentSentenceTimings.length; i++) { if (elapsed >= currentSentenceTimings[i].start && elapsed < currentSentenceTimings[i].end) { activeSentenceIndex = i; break; } if (i === currentSentenceTimings.length - 1 && elapsed >= currentSentenceTimings[i].end) { activeSentenceIndex = i; break; } } if (activeSentenceIndex !== currentHighlightIndex) { if (activeSentenceIndex !== -1) { const sentenceInfo = currentSentenceTimings[activeSentenceIndex]; if (sentenceInfo?.sentence) { const range = findTextRange(sentenceInfo.sentence); highlightRange(range); } else { removeHighlight(); } } else { removeHighlight(); } currentHighlightIndex = activeSentenceIndex; } lastSpokenIndex = activeSentenceIndex; if (elapsed < totalDuration) { highlightAnimationFrame = requestAnimationFrame(updateSentenceHighlightLoop); } else { highlightAnimationFrame = null; } }


// --- UI (Toolbar - Creation and Management) ---

/**
 * Creates the floating toolbar DOM elements, assigns the main div
 * to the global `floatingToolbar` variable, but DOES NOT append to body or make visible.
 * It assumes any previous toolbar has been handled by stopAudio.
 * @returns {HTMLElement | null} The created toolbar element.
 */
function createFloatingToolbar() {
    //console.log("Creating new floating toolbar elements.");

    // --- Always create new elements ---
    floatingToolbar = document.createElement('div');
    floatingToolbar.id = 'tts-floating-toolbar';
    // Initial style set by CSS (opacity 0, transformed)

    const closeBtn = createButton('tts-close-btn', ICONS.close, 'Close Toolbar', () => stopAudio()); // stopAudio is async but doesn't need await here
    closeBtn.classList.add('tts-close-button');
    floatingToolbar.appendChild(closeBtn);

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'tts-controls-container';
    const pauseResumeBtn = createButton('pause-resume-btn', ICONS.pause, 'Pause (Space)', togglePauseResume);
    const stopBtn = createButton('stop-btn', ICONS.stop, 'Stop (Esc)', stopAudio); // stopAudio is async but doesn't need await here
    const downloadBtn = createButton('download-btn', ICONS.download, 'Save Audio File', handleDownload);
    controlsDiv.appendChild(pauseResumeBtn);
    controlsDiv.appendChild(stopBtn);
    controlsDiv.appendChild(downloadBtn);


    const progressContainer = document.createElement('div');
    progressContainer.className = 'tts-progress-container';
    progressContainer.setAttribute('aria-label', 'Playback progress. Click to seek.');
    const progressBar = document.createElement('div');
    progressBar.id = 'progress-bar';
    progressBar.className = 'tts-progress-bar';
    progressContainer.appendChild(progressBar);
    progressContainer.addEventListener('click', handleSeek);

    const slidersDiv = document.createElement('div');
    slidersDiv.className = 'tts-sliders-container';
    // Get initial values based on current state (gainNode might be null if called early)
    const initialVolume = gainNode ? gainNode.gain.value : 1.0;
    const initialSpeed = currentPlaybackRate; // Should be set before playAudio calls this
    const volumeControl = createSlider('volume-slider', 'Volume', 0, 1, 0.05, initialVolume, handleVolumeChange);
    const speedControl = createSlider('speed-slider', 'Speed', 0.25, 4.0, 0.05, initialSpeed, handleSpeedChange);
    slidersDiv.appendChild(volumeControl);
    slidersDiv.appendChild(speedControl);

    floatingToolbar.appendChild(controlsDiv);
    floatingToolbar.appendChild(progressContainer);
    floatingToolbar.appendChild(slidersDiv);

    //console.log("New toolbar elements created and assigned.");
    return floatingToolbar;
}

function createButton(id, svgIconHtml, title, onClick) { /* ... same ... */
    const btn = document.createElement('button'); btn.id = id; btn.className = 'tts-button'; btn.title = title; btn.setAttribute('aria-label', title); btn.innerHTML = svgIconHtml; btn.addEventListener('click', onClick); return btn;
}
function createSlider(id, labelText, min, max, step, value, onInput) { /* ... same ... */
    const container = document.createElement('div'); container.className = 'tts-slider-group'; const label = document.createElement('label'); label.htmlFor = id; label.textContent = `${labelText}:`; const input = document.createElement('input'); input.type = 'range'; input.id = id; input.min = min; input.max = max; input.step = step; input.value = value; input.setAttribute('aria-label', labelText); const valueSpan = document.createElement('span'); valueSpan.className = 'tts-slider-value'; valueSpan.textContent = parseFloat(value).toFixed(2); input.addEventListener('input', (e) => { valueSpan.textContent = parseFloat(e.target.value).toFixed(2); onInput(e); }); container.appendChild(label); container.appendChild(input); container.appendChild(valueSpan); return container;
}

function updateToolbar() { // Same implementation
    if (!floatingToolbar) return;
    const pauseResumeBtn = floatingToolbar.querySelector('#pause-resume-btn');
    if (!pauseResumeBtn) return;
    if (ttsState === 'playing') { pauseResumeBtn.innerHTML = ICONS.pause; pauseResumeBtn.title = 'Pause (Space)'; pauseResumeBtn.setAttribute('aria-label', 'Pause playback'); }
    else if (ttsState === 'paused') { pauseResumeBtn.innerHTML = ICONS.play; pauseResumeBtn.title = 'Resume (Space)'; pauseResumeBtn.setAttribute('aria-label', 'Resume playback'); }
}

/**
 * Removes the floating toolbar from the DOM with a fade-out animation.
 * Returns a promise that resolves when the removal is complete.
 */
function removeFloatingToolbar() {
    return new Promise((resolve) => {
        // Target the current global reference or the one in the DOM
        const toolbar = floatingToolbar || document.getElementById('tts-floating-toolbar');
        //console.log(`%c[Debug] removeFloatingToolbar ENTER (Toolbar found: ${!!(toolbar && toolbar.parentNode)})`, "color: orange;"); 

        // If no toolbar exists (already removed or never created), resolve immediately
        if (!toolbar || !toolbar.parentNode) {
            // Ensure global ref is null if it somehow points to a non-DOM element
            if (floatingToolbar === toolbar) floatingToolbar = null;
            resolve();
            return;
        }

        //console.log("Removing floating toolbar:", toolbar.id);
        const toolbarRef = toolbar; // Keep a local reference for closures
        let fallbackTimer = null; // Track the fallback timer

        // Cleanup function (removes from DOM, nullifies global ref IF it matches)
        const cleanup = (reason) => {
             if (fallbackTimer) { // Clear fallback if cleanup runs
                 clearTimeout(fallbackTimer);
                 fallbackTimer = null;
             }
            if (toolbarRef.parentNode) { // Check if still in DOM before removing
                toolbarRef.remove();
            }
            // Only nullify the global reference if it *still* points to the element we intended to remove
            if (floatingToolbar === toolbarRef) {
                floatingToolbar = null;
                //console.log("Global floatingToolbar reference cleared.");
            } else {
                 //console.log("Global floatingToolbar reference points to a different element, not clearing.");
            }
            //console.log(`Toolbar removal cleanup finished (${reason}).`);
            //console.log(`%c[Debug] removeFloatingToolbar EXIT (Reason: ${reason})`, "color: orange;");
            resolve(); // Resolve the promise indicating completion
        };

        const computedStyle = window.getComputedStyle(toolbarRef);
        const transitionDuration = parseFloat(computedStyle.transitionDuration) * 1000 || 0; // Get duration in ms, default 0
        const isVisible = computedStyle.opacity !== '0' && computedStyle.transform !== 'none'; // Check if currently visible/transformed

        // If the toolbar has a transition and is currently visible, fade it out
        if (transitionDuration > 0 && isVisible) {
            let cleanedUp = false;
            const transitionEndHandler = (event) => {
                 // Only act on opacity transition finishing on the toolbar itself
                 if (event.target === toolbarRef && event.propertyName === 'opacity') {
                    if (!cleanedUp) {
                        cleanedUp = true;
                        cleanup('transitionend');
                    }
                 }
             };
             // Add listener *before* starting transition
             toolbarRef.addEventListener('transitionend', transitionEndHandler, { once: true });
             // Start the fade-out transition
             toolbarRef.classList.remove('visible');

             // Set a fallback timer in case transitionend doesn't fire
             fallbackTimer = setTimeout(() => {
                 if (!cleanedUp) {
                     console.warn("Toolbar removal fallback triggered.");
                     // Manually remove listener as it didn't fire
                     toolbarRef.removeEventListener('transitionend', transitionEndHandler);
                     cleanedUp = true;
                     cleanup('fallback');
                 }
             }, transitionDuration + 150); // Wait slightly longer than the transition

        } else {
            // If no transition or not visible, remove immediately
            cleanup('immediate');
        }
    });
}


// --- Progress Bar Update ---
function updateProgressBar() { /* ... same implementation ... */
  if (!floatingToolbar || totalDuration <= 0 || ttsState === 'idle') return;
  const progressBar = floatingToolbar.querySelector('#progress-bar'); if (!progressBar) return;
  let elapsed = 0;
  if (ttsState === 'playing' && currentAudioContext) { elapsed = pauseOffset + (currentAudioContext.currentTime - playbackStartTime); }
  else if (ttsState === 'paused') { elapsed = pauseOffset; }
  elapsed = Math.max(0, Math.min(elapsed, totalDuration));
  const percentage = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0;
  progressBar.style.width = `${percentage}%`;
}
function updateProgressBarLoop() { /* ... same implementation ... */
   if (ttsState === 'idle') { progressAnimationFrame = null; const pb = floatingToolbar?.querySelector('#progress-bar'); if(pb) pb.style.width = '0%'; return; }
   if (ttsState === 'paused') { progressAnimationFrame = null; updateProgressBar(); return; }
   updateProgressBar(); progressAnimationFrame = requestAnimationFrame(updateProgressBarLoop);
}


// --- Core Audio Control Functions ---

/**
 * Main function to initialize and start audio playback.
 * Handles starting from a specific word index if provided.
 */
async function playAudio(audioDataUrl, text, wordsData, startWordIndex = -1) {
    // --- Wait for previous instance cleanup FIRST ---
    // stopAudio now returns a promise that resolves after toolbar removal is complete
    await stopAudio();
    // --- Previous instance (including toolbar removal and nullifying floatingToolbar) is now fully stopped ---

    //console.log(`playAudio: Starting setup. Start index: ${startWordIndex}`);
    currentText = text; // Store full text
    currentWords = (wordsData && wordsData.length > 0) ? wordsData : [];
    currentAudioDataUrl = audioDataUrl; // <<< Store data URL globally
    const formatMatch = audioDataUrl.match(/^data:audio\/([^;]+);base64,/);
    currentAudioFormat = formatMatch ? formatMatch[1] : 'mp3'; // Update format
    //console.log(`Audio format determined as: ${currentAudioFormat}`);
    
    let startTimeOffset = 0;
    // --- Explicitly ensure global reference is null before creating new one ---
    floatingToolbar = null;

    try {
        // 1. Setup Audio Context and Gain Node
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        // Check if context can be created (might fail in some environments)
        try {
             currentAudioContext = new AudioContext();
        } catch (contextError) {
             console.error("Failed to create AudioContext:", contextError);
             throw new Error("Browser does not support required Audio features.");
        }
        gainNode = currentAudioContext.createGain();

        // 2. Fetch and Decode Audio
        const response = await fetch(audioDataUrl);
        if (!response.ok) throw new Error(`Audio fetch error: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        try {
            currentAudioBuffer = await currentAudioContext.decodeAudioData(arrayBuffer);
        } catch (decodeError) {
            console.error("Failed to decode audio data:", decodeError);
            throw new Error("Could not decode audio. Format might be unsupported.");
        }
        totalDuration = currentAudioBuffer.duration;
        //console.log(`playAudio: Buffer decoded. Duration: ${totalDuration.toFixed(2)}s`);

        // 3. Determine Highlighting Mode & Calculate Start Offset
        currentHighlightMode = currentWords.length > 0 ? 'word' : 'sentence';
        startTimeOffset = calculateStartTimeOffset(startWordIndex, currentHighlightMode, currentWords, currentText, totalDuration);

        // 4. Create Toolbar Element (assigns to global floatingToolbar)
        createFloatingToolbar(); // This function now just creates elements and assigns the reference
        if (!floatingToolbar) {
             // This should be very unlikely now
             throw new Error("Failed to create toolbar elements.");
        }
        //console.log("playAudio: New toolbar created, ref assigned:", floatingToolbar.id);


        // 5. Start Audio Source Node (this function sets ttsState='playing' on success)
        startSourceNode(startTimeOffset);

        // --- Post-Start Setup (Only if audio source started successfully) ---
        if (ttsState === 'playing') {
            //console.log(`playAudio: Audio source confirmed started from ${startTimeOffset.toFixed(2)}s.`);

            // Attach global listeners needed during playback
            document.addEventListener('keydown', handleKeyDown);

            // Start animation loops
            requestAnimationFrame(updateProgressBarLoop);
            startHighlightLoop();


            // --- Append and Show Toolbar NOW ---
            // The global floatingToolbar reference should be valid and point to the newly created element.
            // It should NOT be in the DOM yet because stopAudio awaited its removal.
             if (!floatingToolbar.parentNode) {
                 //console.log("playAudio: Appending toolbar to body.");
                 document.body.appendChild(floatingToolbar);
             } else {
                  // This case would indicate a serious logic flaw if stopAudio is awaited correctly.
                  console.error("playAudio: FATAL - Toolbar was already in DOM after awaiting stopAudio! Aborting visibility.", floatingToolbar);
                  // Attempt cleanup again?
                  await stopAudio(); // Try to force cleanup
                  return; // Exit playAudio
             }

             // Use rAF to ensure the element is in the DOM before triggering the transition
             requestAnimationFrame(() => {
                 // Final check on the reference before making visible - paranoia check
                  if (floatingToolbar && floatingToolbar.id === 'tts-floating-toolbar' && floatingToolbar.parentNode) {
                       //console.log("playAudio: Adding 'visible' class to toolbar.");
                       floatingToolbar.classList.add('visible');
                  } else {
                        console.error("playAudio: Toolbar reference became invalid or detached before adding 'visible' class!");
                        // Attempt cleanup if something went wrong
                        if(floatingToolbar && floatingToolbar.parentNode) floatingToolbar.remove();
                        floatingToolbar = null;
                  }
             });
            // --- Toolbar appended and CSS should make it transition to visible ---

        } else {
             // If ttsState is not 'playing', startSourceNode must have failed.
             console.warn("playAudio: Playback state not 'playing' after startSourceNode. Cleanup initiated.");
             // We don't need to explicitly remove the toolbar here, as stopAudio (called at the start)
             // should have handled any remnants, and the new one wasn't appended yet.
             // Just throw the error to trigger the main catch block.
             throw new Error("Failed to start audio source node.");
        }

    } catch (error) {
        console.error("Error during playAudio initialization:", error);
        showTemporaryMessage(`Error playing audio: ${error.message}`, true);
        // stopAudio was called at the start. Calling it again ensures cleanup
        // if the error occurred *after* the context/buffer/toolbar were created.
        await stopAudio();
    }
}

function calculateStartTimeOffset(startWordIndex, mode, words, text, duration) { // Same implementation
    let offset = 0; if (startWordIndex < 0) return 0;
    if (mode === 'word') { if (startWordIndex < words.length) { offset = words[startWordIndex].start; } }
    else {
        calculateSentenceTimings(text, duration);
        if (currentSentenceTimings.length > 0) {
            const totalWordsInText = text.split(/\s+/).filter(Boolean).length;
            if (totalWordsInText > 0) {
                let cumulativeWords = 0; let targetSentenceIndex = -1;
                for (let i = 0; i < currentSentenceTimings.length; i++) { const sentenceWordCount = currentSentenceTimings[i].sentence.split(/\s+/).filter(Boolean).length; if (startWordIndex >= cumulativeWords && startWordIndex < cumulativeWords + sentenceWordCount) { targetSentenceIndex = i; break; } cumulativeWords += sentenceWordCount; }
                if (targetSentenceIndex === -1 && startWordIndex >= cumulativeWords) { targetSentenceIndex = currentSentenceTimings.length - 1; }
                if (targetSentenceIndex >= 0 && targetSentenceIndex < currentSentenceTimings.length) { offset = currentSentenceTimings[targetSentenceIndex].start; }
            }
        }
    } return Math.max(0, Math.min(offset, duration - 0.01));
}

function startSourceNode(offset = 0) {
    if (!currentAudioContext || !currentAudioBuffer) { console.error("startSourceNode: Missing Context/Buffer."); ttsState = 'idle'; return; }
    // Clean up previous source *if* it exists (belt-and-suspenders)
    if (currentSource) { try { currentSource.onended = null; currentSource.stop(); currentSource.disconnect(); } catch (e) {} currentSource = null; }

    currentSource = currentAudioContext.createBufferSource(); currentSource.buffer = currentAudioBuffer; currentSource.playbackRate.value = currentPlaybackRate;
    if (!gainNode) gainNode = currentAudioContext.createGain();
    const volumeSlider = floatingToolbar?.querySelector('#volume-slider'); const initialVolume = volumeSlider ? parseFloat(volumeSlider.value) : 1.0; gainNode.gain.setValueAtTime(initialVolume, currentAudioContext.currentTime);
    currentSource.connect(gainNode); gainNode.connect(currentAudioContext.destination);
    playbackStartTime = currentAudioContext.currentTime; pauseOffset = offset;

    try {
        currentSource.start(0, offset);
        ttsState = 'playing'; // Set state ONLY after successful start
        //console.log(`startSourceNode: Source started at offset ${offset.toFixed(2)}s.`);
        syncHighlightToOffset(offset); // Sync highlight AFTER state is playing
    } catch (startError) {
        console.error("Failed to start AudioBufferSourceNode:", startError);
        ttsState = 'idle'; // Ensure state is idle if start fails
        currentSource = null; // Clear failed source
        // Do not set onended handler if start failed
        return; // Exit function
    }


    currentSource.onended = () => {
       const wasPlayingOrPaused = (ttsState === 'playing' || ttsState === 'paused');
       const sourceEnded = currentSource; // Capture ref in case it's cleared elsewhere quickly
       currentSource = null; // Clear global ref immediately as this source is done

       // Check context state - might be closed by an explicit stopAudio call before onended fires
       if (!currentAudioContext || currentAudioContext.state === 'closed') {
           //console.log("Source ended, but context is closed or missing. State forced to idle.");
           ttsState = 'idle'; // Ensure state reflects reality
           return;
       }

        // Estimate elapsed time right before ending (use stored start time)
        // Avoid using currentAudioContext.currentTime if context might close during this handler
        // This calculation might be slightly off if stopAudio() interrupted suspend/resume timing.
        const endElapsed = pauseOffset + (currentAudioContext.currentTime - playbackStartTime); // Best effort
        const reachedEnd = Math.abs(endElapsed - totalDuration) < 0.20; // Increased tolerance slightly

       if (wasPlayingOrPaused && reachedEnd) {
            // --- Playback Finished Naturally ---
            //console.log("Audio source naturally ended.");
            ttsState = 'idle'; // Set state to idle
            currentHighlightMode = 'none'; // Reset highlight mode
            pauseOffset = totalDuration; // Ensure progress bar shows 100%

            // Cancel animation loops
            if (highlightAnimationFrame) cancelAnimationFrame(highlightAnimationFrame);
            if (progressAnimationFrame) cancelAnimationFrame(progressAnimationFrame);
            highlightAnimationFrame = null; progressAnimationFrame = null;

            // Update toolbar UI *if it still exists*
            if (floatingToolbar) {
                updateToolbar(); // Show play icon
                updateProgressBar(); // Show 100%
            }
            removeHighlight(); // Clear text highlight

            // Clean up the source node's connections (already done by setting currentSource=null?)
            if (sourceEnded) {
                try { sourceEnded.disconnect(); } catch(e) { /* ignore */ }
            }
            // Keep context, buffer, gainNode, and toolbar active

       } else if (wasPlayingOrPaused) {
            // --- Ended Prematurely (Stop/Seek) ---
            //console.log("Audio source ended prematurely (likely stop/seek). Cleanup handled elsewhere.");
            // Cleanup is handled by the function that called stop() (e.g., stopAudio, handleSeek)
            // Ensure state is idle if stopped
            if (ttsState !== 'idle') {
                 // This shouldn't happen if stopAudio sets state first, but just in case
                 // ttsState = 'idle';
            }
            // Disconnect just in case
            if (sourceEnded) { try { sourceEnded.disconnect(); } catch(e) {}}

       } else {
            // --- Ended while already Idle ---
            //console.log("Audio source 'onended' fired while state was already 'idle'.");
            if (sourceEnded) { try { sourceEnded.disconnect(); } catch(e) {}}
       }
   };
}

function togglePauseResume() { // Same implementation
  if (!currentAudioContext || ttsState === 'idle') { return; }
  if (ttsState === 'playing') {
    pauseOffset += currentAudioContext.currentTime - playbackStartTime;
    currentAudioContext.suspend().then(() => {
        ttsState = 'paused'; //console.log("Paused at offset:", pauseOffset.toFixed(2));
        if (highlightAnimationFrame) cancelAnimationFrame(highlightAnimationFrame); if (progressAnimationFrame) cancelAnimationFrame(progressAnimationFrame);
         highlightAnimationFrame = null; progressAnimationFrame = null; updateToolbar(); updateProgressBar();
    }).catch(e => console.error("Error suspending:", e));
  } else if (ttsState === 'paused') {
    currentAudioContext.resume().then(() => {
        playbackStartTime = currentAudioContext.currentTime; ttsState = 'playing'; //console.log("Resumed from offset:", pauseOffset.toFixed(2));
        updateToolbar(); if (!progressAnimationFrame) requestAnimationFrame(updateProgressBarLoop); syncHighlightToOffset(pauseOffset); startHighlightLoop();
    }).catch(e => console.error("Error resuming:", e));
  }
}

/**
 * Stops audio playback completely, cleans up all resources and UI elements.
 * Returns a promise that resolves when cleanup (including async toolbar removal) is done.
 */
async function stopAudio() {
    //console.log(`%c[Debug] stopAudio ENTER (State: ${ttsState})`, "color: red; font-weight: bold;"); 
    // Check if already stopped or stopping
    if (ttsState === 'idle' && !currentAudioContext && !floatingToolbar) {
        // //console.log("stopAudio: Already idle and cleaned up.");
        return Promise.resolve(); // Already stopped
    }
    // Basic check to prevent rapid re-entry if already processing stop
    if (ttsState === 'stopping') {
        //console.log("stopAudio: Already in stopping process.");
        // How to handle? Maybe return a promise that resolves when the *current* stop finishes? Complex.
        // For now, just return resolved to prevent interference.
        return Promise.resolve();
    }

   // Set a temporary state to prevent re-entry
   const wasAlreadyIdle = (ttsState === 'idle');
   ttsState = 'stopping'; // Indicate cleanup is in progress
   //console.log("stopAudio: Initiating cleanup...");

   // 1. Cancel animations FIRST
   if (highlightAnimationFrame) cancelAnimationFrame(highlightAnimationFrame);
   if (progressAnimationFrame) cancelAnimationFrame(progressAnimationFrame);
   highlightAnimationFrame = null; progressAnimationFrame = null;

   // 2. Remove listeners
   document.removeEventListener('keydown', handleKeyDown);

   // 3. Stop source node
   if (currentSource) {
       //console.log("stopAudio: Stopping source node.");
       try {
           currentSource.onended = null; // Critical: Prevent onended handler
           currentSource.stop();
           currentSource.disconnect();
       } catch (e) { console.warn("Minor error stopping/disconnecting source:", e.message); }
       currentSource = null; // Clear ref
   }

   // 4. Close Audio Context (async)
   let contextClosePromise = Promise.resolve();
   if (currentAudioContext) {
       //console.log("stopAudio: Closing AudioContext.");
       const contextToClose = currentAudioContext;
       currentAudioContext = null; // Clear ref immediately
       if (contextToClose.state !== 'closed') {
           contextClosePromise = contextToClose.close()
               .then(() => //console.log("stopAudio: AudioContext closed successfully."))
               .catch(e => console.warn("stopAudio: Error closing AudioContext:", e.message));
       } else {
            //console.log("stopAudio: AudioContext was already closed.");
       }
   }

   // 5. Reset state variables (important for next playback)
   gainNode = null; currentAudioBuffer = null;
   playbackStartTime = 0; pauseOffset = 0; totalDuration = 0;
   currentText = ""; currentWords = []; currentSentenceTimings = [];
   currentHighlightIndex = -1; lastSpokenIndex = -1;
   currentHighlightMode = 'none';
   currentAudioDataUrl = null;
   currentAudioFormat = 'mp3'; // Reset format

   // 6. Remove UI elements (Toolbar removal is async)
    // removeFloatingToolbar returns a promise now
    const toolbarRemovalPromise = removeFloatingToolbar();
    removeHighlight(); // Remove text highlight immediately

   try {
       // 7. Wait for async operations (context closing AND toolbar removal)
       await Promise.all([contextClosePromise, toolbarRemovalPromise]);
       //console.log(`%c[Debug] stopAudio EXIT (State set to: ${ttsState})`, "color: red; font-weight: bold;");
       //console.log("stopAudio: All async cleanup finished.");
   } catch (cleanupError) {
        console.error("stopAudio: Error during async cleanup:", cleanupError);
   } finally {
       // 8. Set final state definitively AFTER all cleanup attempts
       ttsState = 'idle';
       //console.log("stopAudio: Final state set to idle.");
   }
   // Return resolved promise indicating stop process finished
   return Promise.resolve();
}


function handleSeek(e) { // Same implementation
    if (!currentAudioBuffer || ttsState === 'idle' || !totalDuration || totalDuration <= 0) { return; }
    const progressContainer = e.currentTarget; const rect = progressContainer.getBoundingClientRect(); const clickX = e.clientX - rect.left;
    const seekRatio = Math.max(0, Math.min(1, clickX / rect.width)); const newTime = seekRatio * totalDuration;
    //console.log(`Seeking to: ${newTime.toFixed(2)}s`);
    const wasPlaying = ttsState === 'playing'; const wasPaused = ttsState === 'paused';
    if (currentSource) { try { currentSource.onended = null; currentSource.stop(); currentSource.disconnect(); } catch(e) {/* ignore */} currentSource = null; }
    if (wasPaused && currentAudioContext && currentAudioContext.state === 'suspended') {
        currentAudioContext.resume().then(() => {
            startSourceNode(newTime);
            if (ttsState === 'playing') { if (!progressAnimationFrame) requestAnimationFrame(updateProgressBarLoop); startHighlightLoop(); updateToolbar(); }
        }).catch(e => console.error("Error resuming context during seek:", e));
    } else {
        startSourceNode(newTime);
        if (wasPlaying && ttsState === 'playing') { if (!progressAnimationFrame) requestAnimationFrame(updateProgressBarLoop); startHighlightLoop(); }
        else if (!wasPlaying && ttsState === 'playing') { requestAnimationFrame(updateProgressBarLoop); startHighlightLoop(); updateToolbar(); }
    }
    updateProgressBar();
}

function handleVolumeChange(e) { /* ... same ... */ if (gainNode && currentAudioContext) { const newVolume = parseFloat(e.target.value); gainNode.gain.setTargetAtTime(newVolume, currentAudioContext.currentTime, 0.01); } }
function handleSpeedChange(e) { /* ... same ... */ currentPlaybackRate = parseFloat(e.target.value); if (currentSource && currentAudioContext) { currentSource.playbackRate.setValueAtTime(currentPlaybackRate, currentAudioContext.currentTime); } }
function syncHighlightToOffset(offset) { /* ... same ... */ if (ttsState === 'idle') return; const dataProvider = currentHighlightMode === 'word' ? currentWords : currentSentenceTimings; let targetIndex = -1; if (dataProvider.length > 0 && totalDuration > 0) { offset = Math.max(0, Math.min(offset, totalDuration)); for (let i = 0; i < dataProvider.length; i++) { const item = dataProvider[i]; if (currentHighlightMode === 'sentence') { if (offset >= item.start && offset < item.end) { targetIndex = i; break; } if (i === dataProvider.length - 1 && offset >= item.end) { targetIndex = i; break; } } else { const wordStartTime = item.start; const nextWordStartTime = (i === dataProvider.length - 1) ? totalDuration + 0.1 : dataProvider[i+1].start; if (offset >= wordStartTime && offset < nextWordStartTime) { targetIndex = i; break; } } } } if (targetIndex !== currentHighlightIndex) { if (targetIndex !== -1) { const itemInfo = dataProvider[targetIndex]; const textToHighlight = currentHighlightMode === 'word' ? itemInfo.text : itemInfo.sentence; if (textToHighlight) { const range = findTextRange(textToHighlight); highlightRange(range); } else { removeHighlight(); } } else { removeHighlight(); } currentHighlightIndex = targetIndex; } lastSpokenIndex = targetIndex; }


/**
 * Generates a sanitized filename for the download.
 * @param {string} text - The original text (used for filename base).
 * @param {string} format - The audio format (e.g., 'mp3', 'wav').
 * @returns {string} A sanitized filename string.
 */
function generateFilename(text, format) {
    // Use first few words, max ~30 chars, sanitize
    const baseName = text
        .substring(0, 50) // Take first 50 chars
        .split(/\s+/)      // Split into words
        .slice(0, 5)       // Take first 5 words
        .join(' ')         // Join with space
        .replace(/[^\w\s-]/g, '') // Remove non-alphanumeric (keep space, hyphen)
        .replace(/\s+/g, '_') // Replace spaces with underscore
        .substring(0, 30);  // Limit length

    const safeBaseName = baseName || 'audio'; // Fallback if text is empty/weird
    return `${safeBaseName}.${format}`;
}

/**
 * Handles the click event for the download button.
 */
function handleDownload() {
    if (!currentAudioDataUrl || ttsState === 'idle') {
        //console.log("Download clicked, but no audio data URL or not active.");
        showTemporaryMessage("No audio ready to download.", true);
        return;
    }

    try {
        const filename = generateFilename(currentText, currentAudioFormat);
        //console.log(`Attempting to download as: ${filename}`);

        const link = document.createElement('a');
        link.href = currentAudioDataUrl;
        link.download = filename;

        // Append, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (error) {
        console.error("Error initiating download:", error);
        showTemporaryMessage("Could not initiate download.", true);
    }
}


// --- Utility ---
function showTemporaryMessage(message, isError = false) { // Same implementation
    let msgDiv = document.getElementById('tts-temp-message');
    if (!msgDiv) {
        msgDiv = document.createElement('div'); msgDiv.id = 'tts-temp-message';
        Object.assign(msgDiv.style, { position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', borderRadius: '5px', zIndex: '2147483647', fontSize: '14px', fontFamily: 'sans-serif', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', opacity: '0', transition: 'opacity 0.5s ease-in-out', textAlign: 'center', maxWidth: '80%' }); document.body.appendChild(msgDiv);
    }
    msgDiv.textContent = message; msgDiv.style.backgroundColor = isError ? 'rgba(217, 83, 79, 0.9)' : 'rgba(92, 184, 92, 0.9)'; msgDiv.style.color = '#fff';
    requestAnimationFrame(() => { msgDiv.style.opacity = '1'; });
    if (msgDiv.timer) clearTimeout(msgDiv.timer);
    msgDiv.timer = setTimeout(() => {
        msgDiv.style.opacity = '0';
        msgDiv.addEventListener('transitionend', () => { if (msgDiv && msgDiv.style.opacity === '0') msgDiv.remove(); }, { once: true });
        setTimeout(() => { if (msgDiv && msgDiv.style.opacity === '0') msgDiv.remove(); }, 600);
    }, 3000);
}



// --- Initial Log ---
//console.log("DeepInfra TTS Content Script Loaded (v1.0)."); // Update version