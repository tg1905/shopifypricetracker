const ALARM_NAME = 'checkPricesAlarm';
const CHECK_INTERVAL_MINUTES = 12 * 60;

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) checkAllPrices();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'productDataExtracted') {
        updateStoreWithData(request.data);
    }
    
    if (request.action === 'checkPrices') {
        // Just open each tracked product URL in background tabs
        // Content script will extract data automatically
        checkAllPrices();
        sendResponse({ status: 'started' });
    }
    
    return true;
});

async function checkAllPrices() {
    const result = await chrome.storage.local.get(['trackedStores']);
    const stores = result.trackedStores || [];
    

    
    // Open each URL in a background tab - content script will handle extraction
    for (const store of stores) {
        chrome.tabs.create({ url: store.url, active: false }, (tab) => {
            const tabId = tab.id;
            
            // Listen for tab to finish loading
            const listener = (updatedTabId, info) => {
                if (updatedTabId === tabId && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    // Wait 2 more seconds for content script to extract
                    setTimeout(() => {
                        chrome.tabs.remove(tabId).catch(() => {});
                    }, 2000);
                }
            };
            
            chrome.tabs.onUpdated.addListener(listener);
            
            // Failsafe: Close after 10 seconds no matter what
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                chrome.tabs.remove(tabId).catch(() => {});
            }, 10000);
        });
    }
}

async function updateStoreWithData(data) {
    if (!data || !data.price) return;
    
    const result = await chrome.storage.local.get(['trackedStores', 'priceHistory']);
    const stores = result.trackedStores || [];
    const history = result.priceHistory || [];
    
    const store = stores.find(s => s.url === data.url);
    if (!store) return;
    
    const newPrice = normalizePrice(data.price);
    
    // Handle first extraction for pending stores
    if (store.name === 'Pending extraction...') {
        store.name = data.title || 'Unknown Product';
        store.image = data.image;
        store.currentPrice = newPrice;
        store.lastChecked = new Date().toISOString();
        
        await chrome.storage.local.set({ trackedStores: stores });

        
        chrome.runtime.sendMessage({ action: 'storeUpdated' });
        return;
    }
    
    if (newPrice !== store.currentPrice) {

        const changePercent = ((newPrice - store.currentPrice) / store.currentPrice) * 100;
        const roundedChange = parseFloat(changePercent.toFixed(2));
        
        history.push({
            date: new Date().toISOString(),
            name: store.name,
            oldPrice: store.currentPrice,
            newPrice: newPrice,
            change: roundedChange
        });
        
        if (roundedChange <= -5) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: '/assets/icon128.png',
                title: 'Price Drop!',
                message: `${store.name} dropped ${Math.abs(roundedChange)}% to $${(newPrice/100).toFixed(2)}!`
            });
        }
        
        store.currentPrice = newPrice;
        store.lastChecked = new Date().toISOString();
        
        await chrome.storage.local.set({ 
            trackedStores: stores,
            priceHistory: history.slice(-100)
        });
    } else {

        store.lastChecked = new Date().toISOString();
        await chrome.storage.local.set({ trackedStores: stores });
    }
}

function normalizePrice(price) {
    let p = typeof price === 'string' ? parseFloat(price.replace(/[^0-9.]/g, '')) : price;
    if (p > 1000 && Number.isInteger(p)) return p; // cents
    return Math.round(p * 100); // dollars to cents
}
