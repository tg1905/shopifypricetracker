document.addEventListener('DOMContentLoaded', async () => {
    const storeUrlInput = document.getElementById('store-url');
    const addStoreBtn = document.getElementById('add-store');
    const trackedList = document.getElementById('tracked-list');
    const historyContainer = document.getElementById('history-container');
    const checkPricesBtn = document.getElementById('check-prices');
    const exportCsvBtn = document.getElementById('export-csv');

    // Load initial data
    renderAll();

    addStoreBtn.addEventListener('click', async () => {
        const rawUrl = storeUrlInput.value.trim();
        if (!rawUrl.includes('/products/')) {
            alert('Please enter a valid Shopify product URL.');
            return;
        }
        
        const url = rawUrl.split('?')[0];
        const stores = await getStorageData('trackedStores') || [];
        
        if (stores.some(s => s.url === url)) {
            alert('This product is already being tracked.');
            return;
        }

        addStoreBtn.disabled = true;
        
        // Add pending store
        stores.push({ 
            url, 
            name: 'Pending extraction...', 
            currentPrice: 0,
            image: null,
            addedAt: new Date().toISOString()
        });
        
        await setStorageData('trackedStores', stores);
        storeUrlInput.value = '';
        renderAll();
        
        // Trigger background check to fill in details
        chrome.runtime.sendMessage({ action: 'checkPrices' });
        showToast('Product added! Updating details...', 'info');
        
        addStoreBtn.disabled = false;
    });

    checkPricesBtn.addEventListener('click', async () => {
        const originalText = checkPricesBtn.textContent;
        checkPricesBtn.disabled = true;
        checkPricesBtn.innerHTML = '<span class="spinner"></span> Checking...';
        showToast('Checking prices...', 'info');
        
        chrome.runtime.sendMessage({ action: 'checkPrices' }, (response) => {
            // Background script will now open tabs, so we just wait
            // We can re-enable the button after a timeout
            setTimeout(() => {
                checkPricesBtn.disabled = false;
                checkPricesBtn.textContent = originalText;
                showToast('Check initiated in background', 'success');
            }, 2000);
        });
    });

    function showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    exportCsvBtn.addEventListener('click', exportToCSV);

    chrome.runtime.onMessage.addListener((message) => {
        // pricesChecked might not be sent anymore, or we can listen for data extraction?
        // Actually background doesn't send 'pricesChecked' in the new code provided by user.
        // But renderAll loads from storage, so if storage updates, we should re-render.
        // We can listen for storage changes.
    });
    
    // Listen for storage changes to update UI automatically
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && (changes.trackedStores || changes.priceHistory)) {
            renderAll();
        }
    });

    async function renderAll() {
        await loadTrackedStores();
        await loadHistory();
    }

    async function loadTrackedStores() {
        const stores = await getStorageData('trackedStores') || [];
        const history = await getStorageData('priceHistory') || [];

        if (stores.length === 0) {
            trackedList.innerHTML = '<p class="empty-msg">No products tracked yet.</p>';
            return;
        }

        trackedList.innerHTML = stores.map((store, index) => {
            // Find last change for this store
            const storeHistory = history.filter(h => h.name === store.name).sort((a,b) => new Date(b.date) - new Date(a.date));
            const lastChange = storeHistory[0];
            const changeHtml = lastChange ? `
                <span class="item-change-badge ${lastChange.change < 0 ? 'badge-drop' : 'badge-rise'}">
                    ${lastChange.change < 0 ? '' : '+'}${lastChange.change}%
                </span>
            ` : '';

            // Handle pending state
            const isPending = store.name === 'Pending extraction...' || store.currentPrice === 0;
            const priceDisplay = isPending ? '⏳ Loading...' : `$${(store.currentPrice / 100).toFixed(2)}`;
            const nameDisplay = isPending ? '⏳ ' + store.name : store.name;

            return `
                <div class="tracked-item">
                    <img src="${store.image || '/assets/icon128.png'}" class="item-img">
                    <div class="item-info">
                        <span class="item-name" title="${store.name}">${nameDisplay}</span>
                        <div class="item-price-row">
                            <span class="item-price">${priceDisplay}</span>
                            ${changeHtml}
                        </div>
                        <span class="item-timestamp">
                            ${isPending ? '🔄 Checking...' : (store.lastChecked ? '✓ ' + new Date(store.lastChecked).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Not checked yet')}
                        </span>
                    </div>
                    <button class="remove-btn" data-index="${index}">&times;</button>
                </div>
            `;
        }).join('');

        // Handle image errors without inline scripts (CSP compliant)
        trackedList.querySelectorAll('.item-img').forEach(img => {
            img.addEventListener('error', () => {
                img.src = '/assets/icon128.png';
            });
        });

        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const index = e.target.dataset.index;
                const stores = await getStorageData('trackedStores');
                stores.splice(index, 1);
                await setStorageData('trackedStores', stores);
            });
        });
    }

    async function loadHistory() {
        const history = await getStorageData('priceHistory') || [];
        if (history.length === 0) {
            historyContainer.innerHTML = '<p class="empty-msg">✓ No price changes detected yet. Prices will be checked every 12 hours.</p>';
            return;
        }

        const sortedHistory = history.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);

        historyContainer.innerHTML = sortedHistory.map(item => {
            const date = new Date(item.date).toLocaleDateString([], { month: 'short', day: 'numeric' });
            const changeClass = item.change < 0 ? 'drop' : 'rise';
            const changeText = item.change < 0 ? `${item.change}%` : `+${item.change}%`;
            return `
                <div class="history-item">
                    <span class="history-date">${date}</span>
                    <span class="history-name">${item.name}</span>
                    <span class="history-change ${changeClass}">${changeText}</span>
                </div>
            `;
        }).join('');
    }


    async function exportToCSV() {
        const history = await getStorageData('priceHistory') || [];
        if (history.length === 0) return alert('No data to export.');

        let csv = 'Date,Product,Old Price,New Price,Change %\n';
        history.forEach(h => {
            csv += `${h.date},"${h.name.replace(/"/g, '""')}",${(h.oldPrice/100).toFixed(2)},${(h.newPrice/100).toFixed(2)},${h.change}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `price_history_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    }

    function getStorageData(key) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => resolve(result[key]));
        });
    }

    function setStorageData(key, value) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [key]: value }, () => resolve());
        });
    }
});
