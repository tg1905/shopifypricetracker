(function() {
    'use strict';
    
    // Only run on product pages
    if (!window.location.pathname.includes('/products/')) return;
    
    function extractProductData() {
        let data = null;
        
        // Method 1: Script tags
        const scripts = document.querySelectorAll('script[type="application/json"]');
        for (const s of scripts) {
            try {
                const json = JSON.parse(s.textContent);
                if (json.price || json.variants) {
                    data = {
                        title: json.title,
                        price: json.variants?.[0]?.price || json.price,
                        image: json.featured_image || json.images?.[0],
                        url: window.location.href.split('?')[0]
                    };
                    break;
                }
            } catch (e) {}
        }
        
        // Method 2: JSON-LD
        if (!data) {
            const ld = document.querySelectorAll('script[type="application/ld+json"]');
            for (const s of ld) {
                try {
                    const json = JSON.parse(s.textContent);
                    const items = Array.isArray(json) ? json : [json];
                    for (const item of items) {
                        if (item['@type']?.includes('Product')) {
                            const p = item.offers?.price || item.offers?.[0]?.price;
                            if (p) {
                                data = {
                                    title: item.name,
                                    price: p,
                                    image: Array.isArray(item.image) ? item.image[0] : item.image,
                                    url: window.location.href.split('?')[0]
                                };
                                break;
                            }
                        }
                    }
                } catch (e) {}
            }
        }
        
        // Method 3: DOM
        if (!data) {
            const priceEl = document.querySelector('.price, .product-price, [data-price]');
            if (priceEl) {
                data = {
                    title: document.querySelector('h1, .product-title')?.textContent?.trim() || document.title,
                    price: priceEl.textContent.replace(/[^0-9.]/g, ''),
                    image: document.querySelector('.product-image img')?.src,
                    url: window.location.href.split('?')[0]
                };
            }
        }
        
        return data;
    }
    
    // Extract on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                const data = extractProductData();
                if (data) {
                    chrome.runtime.sendMessage({ 
                        action: 'productDataExtracted', 
                        data: data 
                    });
                }
            }, 1000);
        });
    } else {
        setTimeout(() => {
            const data = extractProductData();
            if (data) {
                chrome.runtime.sendMessage({ 
                    action: 'productDataExtracted', 
                    data: data 
                });
            }
        }, 1000);
    }
})();
