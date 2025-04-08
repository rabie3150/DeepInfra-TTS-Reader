// options.js

function saveOptions() {
    const apiToken = document.getElementById('api-token').value.trim();
    const status = document.getElementById('status');

    if (!apiToken) {
        status.textContent = 'API Token cannot be empty.';
        status.className = 'error';
        return;
    }

    chrome.storage.local.set({ apiToken: apiToken }, () => {
        if (chrome.runtime.lastError) {
            status.textContent = `Error saving token: ${chrome.runtime.lastError.message}`;
            status.className = 'error';
        } else {
            status.textContent = 'API Token saved successfully!';
            status.className = '';
            setTimeout(() => status.textContent = '', 3000); // Clear message after 3s
        }
    });
}

function restoreOptions() {
    chrome.storage.local.get(['apiToken'], (result) => {
         if (chrome.runtime.lastError) {
             console.error("Error loading options:", chrome.runtime.lastError);
             document.getElementById('status').textContent = 'Error loading saved token.';
             document.getElementById('status').className = 'error';
         } else if (result.apiToken) {
            document.getElementById('api-token').value = result.apiToken;
        }
    });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save-btn').addEventListener('click', saveOptions);